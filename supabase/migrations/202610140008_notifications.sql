create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id),logical_key text not null,kind text not null,match_id uuid not null references public.matches(id),application_id uuid references public.applications(id),text text not null,created_at timestamptz not null default public.server_now(),read_at timestamptz,is_actionable boolean not null default false,target_version int,unique(recipient_id,logical_key));
create table public.notification_reminder_windows(recipient_id uuid not null references public.profiles(id),logical_key text not null,match_id uuid not null references public.matches(id),kind text not null check(kind in ('payment','captain_pending','captain_shortage')),anchor_at timestamptz not null,ends_at timestamptz not null,closed_at timestamptz,primary key(recipient_id,logical_key),check(ends_at>anchor_at));
create table public.notification_event_receipts(event_id uuid primary key references public.activity_records(id),processed_at timestamptz not null default public.server_now());
create table public.notification_jobs(id uuid primary key default gen_random_uuid(),recipient_id uuid not null references public.profiles(id),match_id uuid not null references public.matches(id),transport text not null check(transport in ('push','alimtalk')),status text not null default 'queued' check(status in ('queued','claimed','sending','provider_accepted','failed','unknown','suppressed','setup_required')),due_at timestamptz not null,claim_token uuid,worker_id uuid,lease_ends_at timestamptz,endpoint_id uuid,endpoint_owner_version int,attempt_count int not null default 0,provider_message_id text,reason text,retry_at timestamptz);
create unique index one_queued_notification_group on public.notification_jobs(recipient_id,match_id,transport) where status='queued';
create table public.notification_job_items(job_id uuid not null references public.notification_jobs(id),notification_id uuid not null references public.notifications(id),milestone text not null,transport text not null,expires_at timestamptz,due_at timestamptz not null,status text not null default 'queued',primary key(notification_id,milestone,transport));
alter table public.notifications enable row level security;alter table public.notification_reminder_windows enable row level security;alter table public.notification_event_receipts enable row level security;alter table public.notification_jobs enable row level security;alter table public.notification_job_items enable row level security;
revoke all on public.notifications,public.notification_reminder_windows,public.notification_event_receipts,public.notification_jobs,public.notification_job_items from public,anon,authenticated;grant all on public.notifications,public.notification_reminder_windows,public.notification_event_receipts,public.notification_jobs,public.notification_job_items to service_role;

create or replace function public.notice_is_current(n public.notifications,p_action boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare m public.matches;a public.applications;r jsonb;f public.format_notices;h public.match_host_reports;open boolean;
begin
 if not exists(select 1 from public.profiles where id=n.recipient_id and deleted_at is null and auth_id is not null) then return false;end if;
 select * into m from public.matches where id=n.match_id;select * into a from public.applications where id=n.application_id;
 open:=m.recruitment_status='open' and not m.hidden and m.starts_at>public.server_now() and exists(select 1 from public.teams where id=m.team_id and status='approved');
 case n.kind
 when 'application.accepted' then return coalesce(open and a.applicant_id=n.recipient_id and a.state='awaiting_payment' and a.payment_deadline_at>public.server_now(),false);
 when 'payment.confirmed' then return coalesce(not p_action and a.applicant_id=n.recipient_id and a.state='confirmed' and m.recruitment_status<>'cancelled' and m.ends_at>public.server_now(),false);
 when 'match.cancelled' then return not p_action and m.recruitment_status='cancelled' and exists(select 1 from public.applications where match_id=m.id and applicant_id=n.recipient_id);
 when 'captain.pending' then return open and public.is_team_manager(n.recipient_id,m.team_id) and exists(select 1 from public.applications where match_id=m.id and state='pending');
 when 'captain.shortage' then r:=public.match_roster(m.id);return open and public.is_team_manager(n.recipient_id,m.team_id) and public.server_now()>=m.starts_at-interval '30 minutes' and ((r->>'minimumPlayerShortage')::int>0 or (r->>'guestTargetShortage')::int>0);
 when 'format.changed' then
  select * into f from public.format_notices where id=split_part(n.logical_key,':',2)::uuid;
  return coalesce(a.applicant_id=n.recipient_id and a.id=any(f.affected_application_ids) and f.version=m.format_version and m.recruitment_status<>'cancelled' and (not p_action or public.server_now()<m.starts_at) and not exists(select 1 from public.cancellation_receipts where application_id=a.id and format_change_id=f.id and cause='format_change_declined'),false);
 when 'match.proceeding_reported' then
  select * into h from public.match_host_reports where id=split_part(n.logical_key,':',2)::uuid;
  return coalesce(not p_action and a.applicant_id=n.recipient_id and a.state in ('pending','awaiting_payment','verifying_payment','confirmed') and a.submitted_at<=h.reported_at and m.recruitment_status<>'cancelled',false);
 else return false;end case;
end $$;
create or replace function public.inbox_json(n public.notifications) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('id',n.id,'logicalKey',n.logical_key,'kind',n.kind,'matchId',n.match_id,'applicationId',n.application_id,'text',n.text,'createdAt',public.utc_text(n.created_at),'readAt',public.utc_text(n.read_at),'isActionable',public.notice_is_current(n,true))$$;
create or replace function public.close_notification_windows(p_match uuid) returns void language plpgsql security definer set search_path='' as $$
declare m public.matches;r jsonb;
begin
 select * into m from public.matches where id=p_match;r:=public.match_roster(p_match);
 update public.notification_reminder_windows w set closed_at=public.server_now() where w.match_id=p_match and w.closed_at is null and (
 m.recruitment_status<>'open' or m.hidden or m.starts_at<=public.server_now() or not exists(select 1 from public.teams where id=m.team_id and status='approved') or
 (w.kind='payment' and not exists(select 1 from public.applications a where w.logical_key='application:'||a.id::text||':payment' and a.state='awaiting_payment' and a.payment_deadline_at>public.server_now())) or
 (w.kind in ('captain_pending','captain_shortage') and not public.is_team_manager(w.recipient_id,m.team_id)) or
 (w.kind='captain_pending' and not exists(select 1 from public.applications where match_id=p_match and state='pending')) or
 (w.kind='captain_shortage' and (r->>'minimumPlayerShortage')::int=0 and (r->>'guestTargetShortage')::int=0));
end $$;
create or replace function public.after_application_notification_windows() returns trigger language plpgsql security definer set search_path='' as $$begin perform public.close_notification_windows(new.match_id);return new;end$$;
create trigger application_notification_windows after insert or update of state on public.applications for each row execute function public.after_application_notification_windows();
create or replace function public.api_notification_windows(p_match uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin perform public.close_notification_windows(p_match);return coalesce((select jsonb_agg(jsonb_build_object('logicalKey',w.logical_key,'recipientId',w.recipient_id,'matchId',w.match_id,'kind',w.kind,'anchorAt',public.utc_text(w.anchor_at),'endsAt',public.utc_text(w.ends_at))) from public.notification_reminder_windows w where w.match_id=p_match and w.closed_at is null),'[]');end$$;
create or replace function public.api_persist_notification_plan(p_event uuid,p_plan jsonb) returns void language plpgsql security definer set search_path='' as $$
declare n jsonb;w jsonb;d jsonb;k text;notice_id uuid;job_id uuid;recipient uuid;v_match uuid;
begin
 if p_event is not null then insert into public.notification_event_receipts(event_id) values(p_event) on conflict do nothing;if not found then return;end if;end if;
 for n in select * from jsonb_array_elements(p_plan->'notices') loop
  if not exists(select 1 from public.profiles where id=(n->>'recipientId')::uuid and deleted_at is null) then continue;end if;
  insert into public.notifications(recipient_id,logical_key,kind,match_id,application_id,text,is_actionable,target_version) values((n->>'recipientId')::uuid,n->>'logicalKey',n->>'kind',(n->>'matchId')::uuid,(n->>'applicationId')::uuid,n->>'text',(n->>'isActionable')::boolean,(n->>'targetVersion')::int) on conflict(recipient_id,logical_key) do update set text=excluded.text,is_actionable=excluded.is_actionable,target_version=excluded.target_version;
 end loop;
 for w in select * from jsonb_array_elements(p_plan->'windows') loop
  insert into public.notification_reminder_windows(recipient_id,logical_key,match_id,kind,anchor_at,ends_at) values((w->>'recipientId')::uuid,w->>'logicalKey',(w->>'matchId')::uuid,w->>'kind',(w->>'anchorAt')::timestamptz,(w->>'endsAt')::timestamptz) on conflict do nothing;
 end loop;
 for d in select * from jsonb_array_elements(p_plan->'deliveries') loop
  recipient:=(d->>'recipientId')::uuid;v_match:=(d->>'matchId')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(recipient::text||v_match::text||(d->>'transport'),0));
  for k in select jsonb_array_elements_text(d->'logicalKeys') loop
   select id into notice_id from public.notifications where recipient_id=recipient and logical_key=k;if not found then continue;end if;
   if exists(select 1 from public.notification_job_items where notification_id=notice_id and milestone=d->>'milestone' and transport=d->>'transport') then continue;end if;
   select j.id into job_id from public.notification_jobs j where j.recipient_id=recipient and j.match_id=v_match and j.transport=d->>'transport' and j.status='queued' for update;
   if not found then insert into public.notification_jobs(recipient_id,match_id,transport,due_at) values(recipient,v_match,d->>'transport',(d->>'dueAt')::timestamptz) returning id into job_id;end if;
   insert into public.notification_job_items(job_id,notification_id,milestone,transport,expires_at,due_at) values(job_id,notice_id,d->>'milestone',d->>'transport',(d->>'expiresAt')::timestamptz,(d->>'dueAt')::timestamptz) on conflict do nothing;
  end loop;
 end loop;
end $$;
create or replace function public.notification_item_is_current(i public.notification_job_items) returns boolean language plpgsql security definer set search_path='' as $$
declare n public.notifications;w public.notification_reminder_windows;expected timestamptz;
begin
 if i.expires_at is not null and public.server_now()>=i.expires_at then return false;end if;select * into n from public.notifications where id=i.notification_id;if not public.notice_is_current(n) then return false;end if;
 if i.milestone like 'repeat:%' then
  select * into w from public.notification_reminder_windows where recipient_id=n.recipient_id and logical_key=n.logical_key and closed_at is null;if not found then return false;end if;
  expected:=w.anchor_at+floor(extract(epoch from(public.server_now()-w.anchor_at))/300)*interval '5 minutes';
  if expected>=w.ends_at or substring(i.milestone from 8)::timestamptz<>expected then return false;end if;
 end if;return true;
end $$;
create or replace function public.api_claim_notifications(p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;token uuid;result jsonb:='[]';
begin
 update public.notification_job_items set status='unknown' where status='sending' and job_id in (select id from public.notification_jobs where status='sending' and lease_ends_at<=public.server_now());
 update public.notification_jobs set status='unknown',reason='SEND_INTERRUPTED',claim_token=null where status='sending' and lease_ends_at<=public.server_now();
 update public.notification_jobs set status='queued',claim_token=null,lease_ends_at=null where status='claimed' and lease_ends_at<=public.server_now() and not exists(select 1 from public.notification_jobs other where other.recipient_id=public.notification_jobs.recipient_id and other.match_id=public.notification_jobs.match_id and other.transport=public.notification_jobs.transport and other.status='queued');
 for j in select * from public.notification_jobs where (status='queued' or (status='failed' and attempt_count<3 and retry_at<=public.server_now())) and due_at<=public.server_now() order by due_at,id for update skip locked limit 50 loop
  token:=gen_random_uuid();update public.notification_jobs set status='claimed',worker_id=p_worker,claim_token=token,lease_ends_at=public.server_now()+interval '60 seconds',attempt_count=attempt_count+1 where id=j.id;
  result:=result||jsonb_build_array(jsonb_build_object('jobId',j.id,'claimToken',token,'leaseEndsAt',public.utc_text(public.server_now()+interval '60 seconds'),'endpointId',j.endpoint_id,'endpointOwnerVersion',j.endpoint_owner_version));
 end loop;return result;
end $$;
create or replace function public.api_begin_notification_send(p_job uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;ids uuid[];app_id uuid;expiry timestamptz;
begin
 select * into j from public.notification_jobs where id=p_job for update;if not found or j.status<>'claimed' or j.claim_token is distinct from p_token or j.lease_ends_at<=public.server_now() then return null;end if;
 update public.notification_job_items i set status='suppressed' where i.job_id=j.id and not public.notification_item_is_current(i);
 select array_agg(distinct n.id),case when count(distinct n.application_id)=1 then min(n.application_id::text)::uuid else null end,min(i.expires_at) into ids,app_id,expiry from public.notification_job_items i join public.notifications n on n.id=i.notification_id where i.job_id=j.id and i.status in ('queued','failed') and public.notification_item_is_current(i);
 if ids is null then update public.notification_jobs set status='suppressed',claim_token=null,lease_ends_at=null where id=j.id;return null;end if;
 update public.notification_jobs set status='sending' where id=j.id;update public.notification_job_items i set status='sending' where i.job_id=j.id and i.notification_id=any(ids) and i.status in ('queued','failed') and public.notification_item_is_current(i);
 return jsonb_build_object('jobId',j.id,'recipientId',j.recipient_id,'transport',j.transport,'endpointId',j.endpoint_id,'noticeIds',to_jsonb(ids),'matchId',j.match_id,'applicationId',app_id,'title','농구 매칭 안내','body','새로운 경기 안내가 있습니다. 앱이나 웹에서 현재 상태를 확인해 주세요.','expiresAt',public.utc_text(expiry));
end $$;
create or replace function public.api_finish_notification_send(p_job uuid,p_token uuid,p_result jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;s text:=p_result->>'status';
begin
 select * into j from public.notification_jobs where id=p_job for update;if not found or j.status<>'sending' or j.claim_token is distinct from p_token then return;end if;
 if s not in ('provider_accepted','failed','unknown','suppressed','setup_required') then raise exception 'INVALID_INPUT';end if;
 update public.notification_job_items set status=s where job_id=j.id and status='sending';
 update public.notification_jobs set status=s,provider_message_id=p_result->>'providerMessageId',reason=p_result->>'reason',claim_token=null,lease_ends_at=null,retry_at=case when s='failed' then public.server_now()+interval '1 minute' else null end where id=j.id;
end $$;
create or replace function public.api_list_inbox(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin perform public.require_active_actor(p_actor);return coalesce((select jsonb_agg(public.inbox_json(n) order by n.created_at desc) from public.notifications n where recipient_id=p_actor),'[]');end$$;
create or replace function public.api_get_inbox_notice(p_actor uuid,p_notice uuid) returns jsonb language plpgsql security definer set search_path='' as $$declare n public.notifications;begin perform public.require_active_actor(p_actor);select * into n from public.notifications where id=p_notice;if not found then raise exception 'NOT_FOUND';end if;if n.recipient_id<>p_actor then raise exception 'FORBIDDEN';end if;return public.inbox_json(n);end$$;
create or replace function public.api_read_inbox_notice(p_actor uuid,p_notice uuid) returns void language plpgsql security definer set search_path='' as $$begin perform public.api_get_inbox_notice(p_actor,p_notice);update public.notifications set read_at=coalesce(read_at,public.server_now()) where id=p_notice;end$$;
revoke all on function public.notice_is_current(public.notifications,boolean),public.inbox_json(public.notifications),public.close_notification_windows(uuid),public.after_application_notification_windows(),public.api_notification_windows(uuid),public.api_persist_notification_plan(uuid,jsonb),public.notification_item_is_current(public.notification_job_items),public.api_claim_notifications(uuid),public.api_begin_notification_send(uuid,uuid),public.api_finish_notification_send(uuid,uuid,jsonb),public.api_list_inbox(uuid),public.api_get_inbox_notice(uuid,uuid),public.api_read_inbox_notice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.notice_is_current(public.notifications,boolean),public.inbox_json(public.notifications),public.close_notification_windows(uuid),public.after_application_notification_windows(),public.api_notification_windows(uuid),public.api_persist_notification_plan(uuid,jsonb),public.notification_item_is_current(public.notification_job_items),public.api_claim_notifications(uuid),public.api_begin_notification_send(uuid,uuid),public.api_finish_notification_send(uuid,uuid,jsonb),public.api_list_inbox(uuid),public.api_get_inbox_notice(uuid,uuid),public.api_read_inbox_notice(uuid,uuid) to service_role;
