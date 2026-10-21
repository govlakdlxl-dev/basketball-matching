alter table public.test_orders add column provider text check(provider in ('fake','toss_test')),add column provider_evidence jsonb;
alter table public.approval_attempts add column lease_token uuid,add column dispatch_count int not null default 0;
create table private.fake_pg_payments(order_id uuid primary key references public.test_orders(id),evidence jsonb not null);
revoke all on private.fake_pg_payments from public,anon,authenticated;grant all on private.fake_pg_payments to service_role;
create or replace function public.api_fake_pg_get(p_order uuid) returns jsonb language sql security definer set search_path='' as $$select evidence from private.fake_pg_payments where order_id=p_order$$;
create or replace function public.api_fake_pg_set(p_order uuid,p_evidence jsonb) returns void language sql security definer set search_path='' as $$insert into private.fake_pg_payments values(p_order,p_evidence) on conflict(order_id) do update set evidence=excluded.evidence$$;
create or replace function public.api_payment_attempt(p_order uuid) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('attemptId',id,'status',status) from public.approval_attempts where order_id=p_order$$;
create or replace function public.api_claim_approval(p_attempt uuid,p_provider text,p_lookup boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.test_orders;a public.applications;r public.approval_attempts;v_order uuid;token uuid:=gen_random_uuid();lookup boolean;
begin
 select order_id into v_order from public.approval_attempts where id=p_attempt;if not found then raise exception 'NOT_FOUND';end if;select * into o from public.test_orders where id=v_order;
 perform 1 from public.matches where id=o.match_id for update;select * into a from public.applications where id=o.application_id for update;select * into o from public.test_orders where id=v_order for update;select * into r from public.approval_attempts where id=p_attempt for update;
 if r.status in ('paid','failed','needs_review') or r.lease_until>public.server_now() then return null;end if;
 if p_provider not in ('fake','toss_test') then raise exception 'INVALID_INPUT';end if;
 if o.provider is not null and o.provider<>p_provider then update public.test_orders set status='needs_review' where id=o.id;update public.approval_attempts set status='needs_review',error_code='PROVIDER_CHANGED' where id=r.id;return null;end if;
 lookup:=p_lookup or r.dispatch_count>0;update public.test_orders set provider=p_provider where id=o.id;
 update public.approval_attempts set lease_token=token,lease_until=public.server_now()+interval '2 minutes',dispatch_count=dispatch_count+1 where id=r.id;
 return jsonb_build_object('attemptId',r.id,'orderId',o.id,'paymentKey',r.payment_key,'amountKrw',o.payment_amount_krw,'requestId',r.pg_request_id,'leaseToken',token,'lookup',lookup,'retryAllowed',public.server_now()<r.received_at+interval '14 days');
end $$;
create or replace function public.api_apply_payment_result(p_attempt uuid,p_lease uuid,p_result jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare o public.test_orders;a public.applications;m public.matches;r public.approval_attempts;v_order uuid;e jsonb;s text;code text;valid boolean;
begin
 select order_id into v_order from public.approval_attempts where id=p_attempt;if not found then raise exception 'NOT_FOUND';end if;select * into o from public.test_orders where id=v_order;
 select * into m from public.matches where id=o.match_id for update;select * into a from public.applications where id=o.application_id for update;select * into o from public.test_orders where id=v_order for update;select * into r from public.approval_attempts where id=p_attempt for update;
 if r.lease_token is distinct from p_lease or r.status in ('paid','failed','needs_review') then return o.status;end if;
 if p_result->>'kind'='confirmed' then
  e:=p_result->'evidence';valid:=coalesce(e->>'environment'='test' and e->>'orderId'=o.id::text and e->>'paymentKey'=r.payment_key and e->>'currency'='KRW' and (e->>'paymentAmountKrw')::numeric=o.payment_amount_krw and e->'approved'='true'::jsonb and (e->>'refundedKrw')::numeric between 0 and o.payment_amount_krw,false);
  if not valid then s:='needs_review';code:='EVIDENCE_MISMATCH';
  elsif r.received_at>=o.payment_deadline_at or a.state<>'verifying_payment' or m.recruitment_status<>'open' or m.hidden or public.server_now()>=m.starts_at or not public.format_is_acknowledged(a.id,m.id) or not exists(select 1 from public.teams where id=m.team_id and status='approved') or (e->>'refundedKrw')::numeric>0 then s:='needs_review';code:='PARTICIPATION_CHANGED';
  else
   s:='paid';update public.applications set state='confirmed' where id=a.id;
   insert into public.activity_records(scope,kind,match_id,application_id,payload) values('domain_event','payment.confirmed',m.id,a.id,jsonb_build_object('orderId',o.id,'source','test_pg'));
   insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');
  end if;
 elsif p_result->>'kind'='definitive_failure' then
  s:='failed';code:=p_result->>'code';if a.state='verifying_payment' then update public.applications set state='rejected' where id=a.id;insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');end if;
 else s:='unknown';code:=p_result->>'reason';end if;
 update public.test_orders set status=s,provider_evidence=coalesce(e,provider_evidence) where id=o.id;
 update public.approval_attempts set status=s,evidence=coalesce(e,evidence),error_code=code,lease_until=null,lease_token=null,updated_at=public.server_now() where id=r.id;
 insert into public.activity_records(scope,kind,match_id,application_id,payload) values('audit','payment.result_applied',m.id,a.id,jsonb_build_object('orderId',o.id,'status',s,'reason',code));return s;
end $$;
create or replace function public.api_payment_candidates() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('attemptId',r.id,'orderId',r.order_id)),'[]') from (select * from public.approval_attempts where status in ('approval_pending','unknown') and (lease_until is null or lease_until<=public.server_now()) order by updated_at limit 50) r
$$;
revoke all on function public.api_fake_pg_get(uuid),public.api_fake_pg_set(uuid,jsonb),public.api_payment_attempt(uuid),public.api_claim_approval(uuid,text,boolean),public.api_apply_payment_result(uuid,uuid,jsonb),public.api_payment_candidates() from public,anon,authenticated;
grant execute on function public.api_fake_pg_get(uuid),public.api_fake_pg_set(uuid,jsonb),public.api_payment_attempt(uuid),public.api_claim_approval(uuid,text,boolean),public.api_apply_payment_result(uuid,uuid,jsonb),public.api_payment_candidates() to service_role;
