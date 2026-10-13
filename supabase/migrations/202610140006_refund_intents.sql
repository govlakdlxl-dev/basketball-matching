alter table public.test_orders add column payment_approved boolean not null default false;
create table public.refund_intents(id uuid primary key default gen_random_uuid(),receipt_id uuid not null unique references public.cancellation_receipts(id),application_id uuid not null references public.applications(id),ratio_bps int not null check(ratio_bps in (0,5000,10000)),created_at timestamptz not null default public.server_now());
create table public.refund_records(
 id uuid primary key default gen_random_uuid(),order_id uuid not null unique references public.test_orders(id),ratio_bps int not null default 0 check(ratio_bps in (0,5000,10000)),
 target_refunded_krw bigint not null default 0,target_platform_krw bigint not null default 0,target_team_krw bigint not null default 0,
 refunded_krw bigint not null default 0,platform_returned_krw bigint not null default 0,team_deducted_krw bigint not null default 0,
 status text not null default 'queued' check(status in ('not_required','queued','processing','completed','failed','unknown','needs_review')),lease_token uuid,lease_until timestamptz,
 check(target_refunded_krw=target_platform_krw+target_team_krw and refunded_krw=platform_returned_krw+team_deducted_krw and refunded_krw>=0 and target_refunded_krw>=refunded_krw)
);
create table public.refund_attempts(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.test_orders(id),request_id uuid not null unique default gen_random_uuid(),additional_krw bigint not null check(additional_krw>0),platform_krw bigint not null,team_krw bigint not null,
 status text not null default 'processing' check(status in ('processing','unknown','completed','failed','needs_review')),created_at timestamptz not null default public.server_now(),error_code text,
 check(additional_krw=platform_krw+team_krw and platform_krw>=0 and team_krw>=0)
);
create unique index one_unresolved_refund on public.refund_attempts(order_id) where status in ('processing','unknown');
create table public.test_ledger_entries(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.test_orders(id),kind text not null check(kind in ('approval','refund')),provider text not null,provider_refund_id text,request_id uuid,
 refunded_krw bigint not null,platform_returned_krw bigint not null,team_deducted_krw bigint not null,recorded_at timestamptz not null default public.server_now(),
 check(refunded_krw=platform_returned_krw+team_deducted_krw and refunded_krw>=0 and platform_returned_krw>=0 and team_deducted_krw>=0),unique(provider,provider_refund_id),unique(request_id)
);
create unique index one_approval_ledger on public.test_ledger_entries(order_id) where kind='approval';
alter table public.refund_intents enable row level security;alter table public.refund_records enable row level security;alter table public.refund_attempts enable row level security;alter table public.test_ledger_entries enable row level security;
revoke all on public.refund_intents,public.refund_records,public.refund_attempts,public.test_ledger_entries from public,anon,authenticated;
grant all on public.refund_intents,public.refund_records,public.refund_attempts,public.test_ledger_entries to service_role;

create or replace function public.refund_json(r public.refund_records) returns jsonb language sql security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'orderId',r.order_id,'receiptIds',coalesce((select jsonb_agg(i.receipt_id order by i.created_at) from public.refund_intents i join public.test_orders o on o.application_id=i.application_id where o.id=r.order_id),'[]'),'ratioBps',r.ratio_bps,'target',jsonb_build_object('refundedKrw',r.target_refunded_krw,'platformReturnedKrw',r.target_platform_krw,'teamDeductedKrw',r.target_team_krw),'completed',jsonb_build_object('refundedKrw',r.refunded_krw,'platformReturnedKrw',r.platform_returned_krw,'teamDeductedKrw',r.team_deducted_krw),'status',r.status)
$$;
create or replace function public.refresh_refund_target(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.test_orders;r public.refund_records;ratio int;total bigint;platform bigint;next_status text;
begin
 select * into o from public.test_orders where id=p_order for update;
 select max(ratio_bps) into ratio from public.refund_intents where application_id=o.application_id;if ratio is null then return;end if;
 insert into public.refund_records(order_id) values(o.id) on conflict do nothing;select * into r from public.refund_records where order_id=o.id for update;
 ratio:=greatest(ratio,r.ratio_bps);total:=floor(o.payment_amount_krw::numeric*ratio/10000);platform:=floor((o.terms->'pricing'->>'platformFeeKrw')::numeric*ratio/10000);
 next_status:=case when r.status in ('processing','unknown','failed','needs_review') then r.status when total=0 then 'not_required' when total<=r.refunded_krw then 'completed' when not o.payment_approved and not exists(select 1 from public.approval_attempts where order_id=o.id) then 'not_required' else 'queued' end;
 update public.refund_records set ratio_bps=ratio,target_refunded_krw=greatest(total,r.refunded_krw),target_platform_krw=greatest(platform,r.platform_returned_krw),target_team_krw=greatest(total-platform,r.team_deducted_krw),status=next_status where id=r.id;
end $$;
create or replace function public.enqueue_refund_intent(p_receipt_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare receipt public.cancellation_receipts;ratio int;intent uuid;o public.test_orders;
begin
 select * into receipt from public.cancellation_receipts where id=p_receipt_id;if not found then raise exception 'NOT_FOUND';end if;
 if receipt.cause in ('host_cancelled','format_change_declined') then ratio:=10000;
 elsif receipt.terms->'policy'->>'version'='test-A-v1' then ratio:=case when (receipt.terms->>'startsAt')::timestamptz-receipt.received_at>=interval '2 hours' then 10000 else 0 end;
 elsif receipt.terms->'policy'->>'version'='test-B-v1' then ratio:=case when (receipt.terms->>'startsAt')::timestamptz-receipt.received_at>=interval '24 hours' then 10000 when (receipt.terms->>'startsAt')::timestamptz-receipt.received_at>=interval '2 hours' then 5000 else 0 end;
 else raise exception 'INVALID_POLICY';end if;
 insert into public.refund_intents(receipt_id,application_id,ratio_bps) values(receipt.id,receipt.application_id,ratio) on conflict(receipt_id) do nothing;
 select id into intent from public.refund_intents where receipt_id=receipt.id;
 select * into o from public.test_orders where application_id=receipt.application_id for update;if found then perform public.refresh_refund_target(o.id);end if;return intent;
end $$;
create or replace function public.after_cancellation_intent() returns trigger language plpgsql security definer set search_path='' as $$begin perform public.enqueue_refund_intent(new.id);return new;end$$;
create trigger cancellation_refund_intent after insert on public.cancellation_receipts for each row execute function public.after_cancellation_intent();
create or replace function public.after_order_refund_target() returns trigger language plpgsql security definer set search_path='' as $$begin perform public.refresh_refund_target(new.id);return new;end$$;
create trigger order_refund_target after insert or update of payment_approved on public.test_orders for each row execute function public.after_order_refund_target();
create or replace function public.lock_refund_order(p_order uuid) returns void language plpgsql security definer set search_path='' as $$
declare o public.test_orders;
begin select * into o from public.test_orders where id=p_order;if not found then raise exception 'NOT_FOUND';end if;perform 1 from public.matches where id=o.match_id for update;perform 1 from public.applications where id=o.application_id for update;perform 1 from public.test_orders where id=o.id for update;perform 1 from public.refund_records where order_id=o.id for update;end $$;
create or replace function public.api_get_refund_record(p_actor uuid,p_order uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.test_orders;r public.refund_records;
begin
 if p_actor is not null then perform public.require_active_actor(p_actor);end if;select * into o from public.test_orders where id=p_order;if not found then raise exception 'NOT_FOUND';end if;
 if p_actor is not null and o.owner_id<>p_actor then raise exception 'FORBIDDEN';end if;select * into r from public.refund_records where order_id=p_order;return case when found then public.refund_json(r) else null end;
end $$;
create or replace function public.api_claim_refund(p_order uuid,p_provider text) returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.test_orders;r public.refund_records;a public.approval_attempts;token uuid:=gen_random_uuid();
begin
 perform public.lock_refund_order(p_order);select * into o from public.test_orders where id=p_order;select * into r from public.refund_records where order_id=p_order;
 if not found or not o.payment_approved or r.status in ('completed','not_required','failed','needs_review') or r.lease_until>public.server_now() then return null;end if;
 if o.provider<>p_provider then update public.refund_records set status='needs_review' where id=r.id;return null;end if;
 select * into a from public.approval_attempts where order_id=p_order;
 update public.refund_records set lease_token=token,lease_until=public.server_now()+interval '2 minutes',status='processing' where id=r.id;
 return jsonb_build_object('orderId',o.id,'paymentKey',a.payment_key,'leaseToken',token);
end $$;

-- 한 번의 미해결 요청에 대응하는 제공자 취소 증거만 완료 원장에 넣습니다.
create or replace function public.reconcile_refund_evidence(p_order uuid,e jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare o public.test_orders;r public.refund_records;a public.refund_attempts;p public.approval_attempts;item jsonb;entry public.test_ledger_entries;new_count int:=0;new_item jsonb;sum_amount numeric:=0;ids text[]:='{}';total bigint;platform bigint;team bigint;
begin
 select * into o from public.test_orders where id=p_order;select * into r from public.refund_records where order_id=p_order;select * into p from public.approval_attempts where order_id=p_order;
 if not coalesce(e->>'environment'='test' and e->>'orderId'=o.id::text and e->>'paymentKey'=p.payment_key and e->>'currency'='KRW' and e->'approved'='true'::jsonb and (e->>'paymentAmountKrw')::numeric=o.payment_amount_krw and (e->>'refundedKrw')::numeric between 0 and o.payment_amount_krw and jsonb_typeof(e->'refunds')='array',false) then return false;end if;
 for item in select * from jsonb_array_elements(e->'refunds') loop
  if coalesce(item->>'providerRefundId','')='' or (item->>'providerRefundId')=any(ids) or (item->>'amountKrw')::numeric<=0 or (item->>'amountKrw')::numeric<>floor((item->>'amountKrw')::numeric) then return false;end if;
  ids:=array_append(ids,item->>'providerRefundId');sum_amount:=sum_amount+(item->>'amountKrw')::numeric;
  select * into entry from public.test_ledger_entries where provider=o.provider and provider_refund_id=item->>'providerRefundId';
  if found then if entry.order_id<>o.id or entry.refunded_krw<>(item->>'amountKrw')::numeric then return false;end if;
  else new_count:=new_count+1;new_item:=item;end if;
 end loop;
 if sum_amount<>(e->>'refundedKrw')::numeric or sum_amount>r.target_refunded_krw or exists(select 1 from public.test_ledger_entries where order_id=o.id and kind='refund' and not provider_refund_id=any(ids)) then return false;end if;
 select * into a from public.refund_attempts where order_id=o.id and status in ('processing','unknown') for update;
 if new_count>0 then
  if new_count<>1 or a.id is null or (new_item->>'amountKrw')::numeric<>a.additional_krw or (new_item->>'requestId' is not null and new_item->>'requestId'<>a.request_id::text) then return false;end if;
  insert into public.test_ledger_entries(order_id,kind,provider,provider_refund_id,request_id,refunded_krw,platform_returned_krw,team_deducted_krw) values(o.id,'refund',o.provider,new_item->>'providerRefundId',a.request_id,a.additional_krw,a.platform_krw,a.team_krw);
  update public.refund_attempts set status='completed',error_code=null where id=a.id;
 end if;
 select coalesce(sum(refunded_krw),0),coalesce(sum(platform_returned_krw),0),coalesce(sum(team_deducted_krw),0) into total,platform,team from public.test_ledger_entries where order_id=o.id and kind='refund';
 if total<>sum_amount or total>r.target_refunded_krw then return false;end if;
 update public.refund_records set refunded_krw=total,platform_returned_krw=platform,team_deducted_krw=team where id=r.id;
 update public.test_orders set provider_evidence=e where id=o.id;return true;
end $$;
create or replace function public.api_prepare_refund(p_order uuid,p_lease uuid,p_evidence jsonb,p_idempotent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.refund_records;a public.refund_attempts;
begin
 perform public.lock_refund_order(p_order);select * into r from public.refund_records where order_id=p_order;if r.lease_token is distinct from p_lease then return null;end if;
 if not public.reconcile_refund_evidence(p_order,p_evidence) then update public.refund_records set status='needs_review',lease_token=null,lease_until=null where id=r.id;return null;end if;
 select * into r from public.refund_records where order_id=p_order;select * into a from public.refund_attempts where order_id=p_order and status in ('processing','unknown') for update;
 if found then
  if not p_idempotent or public.server_now()>=a.created_at+interval '14 days' then update public.refund_records set status='needs_review',lease_token=null,lease_until=null where id=r.id;return null;end if;
 else
  if r.target_refunded_krw<=r.refunded_krw then update public.refund_records set status=case when r.target_refunded_krw=0 then 'not_required' else 'completed' end,lease_token=null,lease_until=null where id=r.id;return null;end if;
  insert into public.refund_attempts(order_id,additional_krw,platform_krw,team_krw) values(p_order,r.target_refunded_krw-r.refunded_krw,r.target_platform_krw-r.platform_returned_krw,r.target_team_krw-r.team_deducted_krw) returning * into a;
 end if;
 update public.refund_attempts set status='processing' where id=a.id;
 return jsonb_build_object('attemptId',a.id,'requestId',a.request_id,'additionalKrw',a.additional_krw);
end $$;
create or replace function public.api_finish_refund(p_order uuid,p_lease uuid,p_attempt uuid,p_result jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.refund_records;a public.refund_attempts;s text;
begin
 perform public.lock_refund_order(p_order);select * into r from public.refund_records where order_id=p_order;if r.lease_token is distinct from p_lease then return public.refund_json(r);end if;
 if p_result->>'kind'='confirmed' then
  if not public.reconcile_refund_evidence(p_order,p_result->'evidence') then s:='needs_review';
  else select * into r from public.refund_records where order_id=p_order;select * into a from public.refund_attempts where id=p_attempt;
   s:=case when a.status='completed' then case when r.refunded_krw>=r.target_refunded_krw then 'completed' else 'queued' end else 'unknown' end;
  end if;
 elsif p_result->>'kind'='definitive_failure' then s:='failed';else s:='unknown';end if;
 if p_attempt is not null then update public.refund_attempts set status=case when status='completed' then status when s='queued' then 'completed' else s end,error_code=coalesce(p_result->>'code',p_result->>'reason') where id=p_attempt and order_id=p_order;end if;
 update public.refund_records set status=s,lease_token=null,lease_until=null where id=r.id returning * into r;return public.refund_json(r);
end $$;
create or replace function public.api_refund_candidates() returns jsonb language sql security definer set search_path='' as $$select coalesce(jsonb_agg(r.order_id),'[]') from (select r1.* from public.refund_records r1 join public.test_orders o on o.id=r1.order_id where o.payment_approved and r1.status in ('queued','processing','unknown') and (r1.lease_until is null or r1.lease_until<=public.server_now()) order by r1.id limit 50) r$$;

-- 유효 PG 승인 증거와 참가 상태를 분리합니다. 취소된 신청의 승인은 환불 의도로 이어집니다.
create or replace function public.api_apply_payment_result(p_attempt uuid,p_lease uuid,p_result jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare o public.test_orders;a public.applications;m public.matches;r public.approval_attempts;v_order uuid;e jsonb;s text;code text;valid boolean:=false;
begin
 select order_id into v_order from public.approval_attempts where id=p_attempt;if not found then raise exception 'NOT_FOUND';end if;select * into o from public.test_orders where id=v_order;
 select * into m from public.matches where id=o.match_id for update;select * into a from public.applications where id=o.application_id for update;select * into o from public.test_orders where id=v_order for update;select * into r from public.approval_attempts where id=p_attempt for update;
 if r.lease_token is distinct from p_lease or r.status in ('paid','failed','needs_review') then return o.status;end if;
 if p_result->>'kind'='confirmed' then
  e:=p_result->'evidence';valid:=coalesce(e->>'environment'='test' and e->>'orderId'=o.id::text and e->>'paymentKey'=r.payment_key and e->>'currency'='KRW' and (e->>'paymentAmountKrw')::numeric=o.payment_amount_krw and e->'approved'='true'::jsonb and (e->>'refundedKrw')::numeric between 0 and o.payment_amount_krw,false);
  if not valid then s:='needs_review';code:='EVIDENCE_MISMATCH';
  elsif a.state='cancelled' and r.received_at<o.payment_deadline_at and exists(select 1 from public.refund_intents where application_id=a.id) then s:='paid';code:='CANCELLED_REFUND_INTENT';
  elsif r.received_at>=o.payment_deadline_at or a.state<>'verifying_payment' or m.recruitment_status<>'open' or m.hidden or public.server_now()>=m.starts_at or not public.format_is_acknowledged(a.id,m.id) or not exists(select 1 from public.teams where id=m.team_id and status='approved') or (e->>'refundedKrw')::numeric>0 then s:='needs_review';code:='PARTICIPATION_CHANGED';
  else s:='paid';update public.applications set state='confirmed' where id=a.id;
   insert into public.activity_records(scope,kind,match_id,application_id,payload) values('domain_event','payment.confirmed',m.id,a.id,jsonb_build_object('orderId',o.id,'source','test_pg'));
   insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');end if;
 elsif p_result->>'kind'='definitive_failure' then s:='failed';code:=p_result->>'code';if a.state='verifying_payment' then update public.applications set state='rejected' where id=a.id;insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');end if;
 else s:='unknown';code:=p_result->>'reason';end if;
 update public.test_orders set status=s,provider_evidence=coalesce(e,provider_evidence),payment_approved=valid where id=o.id;
 if valid then insert into public.test_ledger_entries(order_id,kind,provider,refunded_krw,platform_returned_krw,team_deducted_krw) values(o.id,'approval',o.provider,0,0,0) on conflict do nothing;end if;
 update public.approval_attempts set status=s,evidence=coalesce(e,evidence),error_code=code,lease_until=null,lease_token=null,updated_at=public.server_now() where id=r.id;
 insert into public.activity_records(scope,kind,match_id,application_id,payload) values('audit','payment.result_applied',m.id,a.id,jsonb_build_object('orderId',o.id,'status',s,'reason',code));return s;
end $$;

-- 탈퇴 뒤 처리할 미해결 금융 작업을 남기지 않습니다.
create or replace function public.api_prepare_account_deletion(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.profiles;
begin
 perform public.require_active_actor(p_actor);select * into p from public.profiles where id=p_actor for update;
 if exists(select 1 from public.applications a join public.matches m on m.id=a.match_id where a.applicant_id=p_actor and a.state in ('pending','awaiting_payment','verifying_payment','confirmed') and m.ends_at>public.server_now()) or exists(select 1 from public.test_orders o left join public.refund_records r on r.order_id=o.id where o.owner_id=p_actor and (o.status in ('approval_pending','unknown','needs_review') or r.status in ('queued','processing','failed','unknown','needs_review'))) then return jsonb_build_object('status','needs_resolution');end if;
 if exists(select 1 from public.team_memberships tm join public.matches m on m.team_id=tm.team_id where tm.user_id=p_actor and tm.active and tm.role in ('captain','secretary') and m.ends_at>public.server_now() and m.recruitment_status<>'cancelled' and not exists(select 1 from public.team_memberships other where other.team_id=tm.team_id and other.user_id<>p_actor and other.active and other.role in ('captain','secretary'))) then return jsonb_build_object('status','needs_resolution');end if;
 update public.profiles set deleted_at=public.server_now(),preferences=null,nickname='탈퇴한 회원' where id=p_actor;update public.team_memberships set active=false where user_id=p_actor;
 insert into private.account_deletion_requests(user_id,auth_id) values(p_actor,p.auth_id) on conflict do nothing;insert into public.activity_records(scope,kind,actor_id,payload) values('audit','account.deletion_requested',p_actor,'{}');return jsonb_build_object('status','ready','authId',p.auth_id);
end $$;

revoke all on function public.refund_json(public.refund_records),public.refresh_refund_target(uuid),public.enqueue_refund_intent(uuid),public.after_cancellation_intent(),public.after_order_refund_target(),public.lock_refund_order(uuid),public.api_get_refund_record(uuid,uuid),public.api_claim_refund(uuid,text),public.reconcile_refund_evidence(uuid,jsonb),public.api_prepare_refund(uuid,uuid,jsonb,boolean),public.api_finish_refund(uuid,uuid,uuid,jsonb),public.api_refund_candidates() from public,anon,authenticated;
grant execute on function public.refund_json(public.refund_records),public.refresh_refund_target(uuid),public.enqueue_refund_intent(uuid),public.after_cancellation_intent(),public.after_order_refund_target(),public.lock_refund_order(uuid),public.api_get_refund_record(uuid,uuid),public.api_claim_refund(uuid,text),public.reconcile_refund_evidence(uuid,jsonb),public.api_prepare_refund(uuid,uuid,jsonb,boolean),public.api_finish_refund(uuid,uuid,uuid,jsonb),public.api_refund_candidates() to service_role;
