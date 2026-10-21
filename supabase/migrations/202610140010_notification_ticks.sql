create or replace function public.api_notification_tick_input() returns jsonb language sql security definer set search_path='' as $$
 with events as (select a.* from public.activity_records a where a.scope='domain_event' and a.match_id is not null and not exists(select 1 from public.notification_event_receipts r where r.event_id=a.id) order by a.occurred_at,a.id limit 100),
 candidates as (select match_id id from events union select match_id from public.notification_reminder_windows where closed_at is null and ends_at>public.server_now() union select id from public.matches where recruitment_status='open' and starts_at>public.server_now() and starts_at<=public.server_now()+interval '30 minutes')
 select jsonb_build_object('now',public.utc_text(public.server_now()),'events',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'matchId',match_id,'applicationId',application_id,'occurredAt',public.utc_text(occurred_at),'payload',payload)) from events),'[]'),'matchIds',coalesce((select jsonb_agg(id) from candidates),'[]'));
$$;
create or replace function public.api_consume_notification_event(p_event uuid,p_plan jsonb) returns boolean language plpgsql security definer set search_path='' as $$begin
 insert into public.notification_event_receipts(event_id) values(p_event) on conflict do nothing;if not found then return false;end if;
 perform public.api_persist_notification_plan(null,p_plan);return true;
end$$;
create table if not exists private.scheduled_job_runs(id uuid primary key default gen_random_uuid(),stage text not null,started_at timestamptz not null default public.server_now(),status text not null check(status in ('completed','failed')),counts jsonb not null default '{}');
create or replace function public.api_record_job_run(p_stage text,p_status text,p_counts jsonb) returns void language plpgsql security definer set search_path='' as $$begin
 if p_stage not in ('expire','payment','refund','notifications','account_deletion') or p_status not in ('completed','failed') then raise exception 'INVALID_INPUT';end if;
 insert into private.scheduled_job_runs(stage,status,counts) values(p_stage,p_status,p_counts);
 delete from private.scheduled_job_runs where started_at<public.server_now()-interval '14 days';
end$$;
revoke all on function public.api_notification_tick_input(),public.api_consume_notification_event(uuid,jsonb),public.api_record_job_run(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.api_notification_tick_input(),public.api_consume_notification_event(uuid,jsonb),public.api_record_job_run(text,text,jsonb) to service_role;

create or replace function public.api_claim_notifications(p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;token uuid;result jsonb:='[]';p public.push_endpoints;
begin
 update public.notification_job_items set status='unknown' where status='sending' and job_id in (select id from public.notification_jobs where status='sending' and lease_ends_at<=public.server_now());
 update public.notification_jobs set status='unknown',reason='SEND_INTERRUPTED',claim_token=null where status='sending' and lease_ends_at<=public.server_now();
 update public.notification_jobs set status='queued',claim_token=null,lease_ends_at=null where status='claimed' and lease_ends_at<=public.server_now() and not exists(select 1 from public.notification_jobs other where other.recipient_id=public.notification_jobs.recipient_id and other.match_id=public.notification_jobs.match_id and other.transport=public.notification_jobs.transport and other.status='queued');
 for j in select * from public.notification_jobs where (status='queued' or (status='failed' and attempt_count<3 and retry_at<=public.server_now())) and due_at<=public.server_now() order by due_at,id for update skip locked limit 16 loop
  token:=gen_random_uuid();p:=null;
  if j.transport='push' then select * into p from public.push_endpoints where owner_id=j.recipient_id and active order by case when channel in ('apns','fcm') then 0 else 1 end,last_seen_at desc,id desc limit 1;end if;
  update public.notification_jobs set status='claimed',worker_id=p_worker,claim_token=token,lease_ends_at=public.server_now()+interval '60 seconds',attempt_count=attempt_count+1,endpoint_id=p.id,endpoint_owner_version=p.owner_version where id=j.id;
  result:=result||jsonb_build_array(jsonb_build_object('jobId',j.id,'claimToken',token,'leaseEndsAt',public.utc_text(public.server_now()+interval '60 seconds'),'endpointId',p.id,'endpointOwnerVersion',p.owner_version));
 end loop;return result;
end $$;
