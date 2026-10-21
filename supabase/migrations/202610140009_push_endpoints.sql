create table public.push_endpoints(id uuid primary key default gen_random_uuid(),channel text not null check(channel in ('apns','fcm','webpush')),device_id text not null,fingerprint text not null unique,registration jsonb not null,owner_id uuid not null references public.profiles(id),owner_version int not null default 1 check(owner_version>0),active boolean not null default true,created_at timestamptz not null default public.server_now(),last_seen_at timestamptz not null default public.server_now(),deactivated_at timestamptz);
create unique index one_active_push_per_device on public.push_endpoints(device_id) where active;
alter table public.push_endpoints enable row level security;revoke all on public.push_endpoints from public,anon,authenticated;grant all on public.push_endpoints to service_role;
alter table public.notification_jobs add constraint push_endpoint_binding foreign key(endpoint_id) references public.push_endpoints(id);
create or replace function public.api_register_push_endpoint(p_actor uuid,p_channel text,p_device text,p_fingerprint text,p_registration jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.push_endpoints;
begin
 perform public.require_active_actor(p_actor);perform pg_advisory_xact_lock(hashtextextended('device:'||p_device,0));perform pg_advisory_xact_lock(hashtextextended('fingerprint:'||p_fingerprint,0));
 perform 1 from public.push_endpoints where device_id=p_device or fingerprint=p_fingerprint order by id for update;
 update public.push_endpoints set active=false,deactivated_at=public.server_now(),owner_version=owner_version+1 where device_id=p_device and fingerprint<>p_fingerprint and active;
 select * into p from public.push_endpoints where fingerprint=p_fingerprint for update;
 if found then update public.push_endpoints set owner_id=p_actor,device_id=p_device,registration=p_registration,owner_version=owner_version+case when owner_id<>p_actor or not active or device_id<>p_device or registration<>p_registration then 1 else 0 end,active=true,deactivated_at=null,last_seen_at=public.server_now() where id=p.id returning * into p;
 else insert into public.push_endpoints(channel,device_id,fingerprint,registration,owner_id) values(p_channel,p_device,p_fingerprint,p_registration,p_actor) returning * into p;end if;
 return jsonb_build_object('endpointId',p.id,'ownerVersion',p.owner_version);
end $$;
create or replace function public.api_deactivate_push_endpoint(p_actor uuid,p_endpoint uuid,p_version int) returns void language plpgsql security definer set search_path='' as $$
declare p public.push_endpoints;
begin
 perform public.require_active_actor(p_actor);select * into p from public.push_endpoints where id=p_endpoint for update;if not found then raise exception 'NOT_FOUND';end if;if p.owner_id<>p_actor then raise exception 'FORBIDDEN';end if;
 if p.owner_version is distinct from p_version then raise exception 'STALE_ENDPOINT';end if;if p.active then update public.push_endpoints set active=false,deactivated_at=public.server_now(),owner_version=owner_version+1 where id=p.id;end if;
end $$;
create or replace function public.api_select_push_endpoint(p_user uuid) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('endpointId',id,'channel',channel) from public.push_endpoints where owner_id=p_user and active order by case when channel in ('apns','fcm') then 0 else 1 end,last_seen_at desc,id desc limit 1$$;
create or replace function public.api_expire_push_endpoint(p_endpoint uuid,p_version int) returns void language sql security definer set search_path='' as $$update public.push_endpoints set active=false,owner_version=owner_version+1,deactivated_at=public.server_now() where id=p_endpoint and owner_version=p_version and active$$;
create or replace function public.push_job_binding_current(j public.notification_jobs) returns boolean language sql security definer set search_path='' as $$select j.transport<>'push' or exists(select 1 from public.push_endpoints p where p.id=j.endpoint_id and p.owner_id=j.recipient_id and p.owner_version=j.endpoint_owner_version and p.active)$$;
create or replace function public.api_push_binding_for_job(p_job uuid) returns jsonb language sql security definer set search_path='' as $$select jsonb_build_object('id',p.id,'channel',p.channel,'registration',p.registration,'ownerVersion',p.owner_version) from public.notification_jobs j join public.push_endpoints p on p.id=j.endpoint_id where j.id=p_job and j.status='sending' and j.lease_ends_at>public.server_now() and public.push_job_binding_current(j)$$;

create or replace function public.api_claim_notifications(p_worker uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;token uuid;result jsonb:='[]';p public.push_endpoints;
begin
 update public.notification_job_items set status='unknown' where status='sending' and job_id in (select id from public.notification_jobs where status='sending' and lease_ends_at<=public.server_now());
 update public.notification_jobs set status='unknown',reason='SEND_INTERRUPTED',claim_token=null where status='sending' and lease_ends_at<=public.server_now();
 update public.notification_jobs set status='queued',claim_token=null,lease_ends_at=null where status='claimed' and lease_ends_at<=public.server_now() and not exists(select 1 from public.notification_jobs other where other.recipient_id=public.notification_jobs.recipient_id and other.match_id=public.notification_jobs.match_id and other.transport=public.notification_jobs.transport and other.status='queued');
 for j in select * from public.notification_jobs where (status='queued' or (status='failed' and attempt_count<3 and retry_at<=public.server_now())) and due_at<=public.server_now() order by due_at,id for update skip locked limit 50 loop
  token:=gen_random_uuid();p:=null;
  if j.transport='push' then select * into p from public.push_endpoints where owner_id=j.recipient_id and active order by case when channel in ('apns','fcm') then 0 else 1 end,last_seen_at desc,id desc limit 1;end if;
  update public.notification_jobs set status='claimed',worker_id=p_worker,claim_token=token,lease_ends_at=public.server_now()+interval '60 seconds',attempt_count=attempt_count+1,endpoint_id=p.id,endpoint_owner_version=p.owner_version where id=j.id;
  result:=result||jsonb_build_array(jsonb_build_object('jobId',j.id,'claimToken',token,'leaseEndsAt',public.utc_text(public.server_now()+interval '60 seconds'),'endpointId',p.id,'endpointOwnerVersion',p.owner_version));
 end loop;return result;
end $$;
create or replace function public.api_begin_notification_send(p_job uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;ids uuid[];app_id uuid;expiry timestamptz;
begin
 select * into j from public.notification_jobs where id=p_job for update;if not found or j.status<>'claimed' or j.claim_token is distinct from p_token or j.lease_ends_at<=public.server_now() then return null;end if;
 if j.endpoint_id is not null and not public.push_job_binding_current(j) then update public.notification_jobs set status='suppressed',reason='ENDPOINT_BINDING_CHANGED',claim_token=null,lease_ends_at=null where id=j.id;update public.notification_job_items set status='suppressed' where job_id=j.id;return null;end if;
 update public.notification_job_items i set status='suppressed' where i.job_id=j.id and not public.notification_item_is_current(i);
 select array_agg(distinct n.id),case when count(distinct n.application_id)=1 then min(n.application_id::text)::uuid else null end,min(i.expires_at) into ids,app_id,expiry from public.notification_job_items i join public.notifications n on n.id=i.notification_id where i.job_id=j.id and i.status in ('queued','failed') and public.notification_item_is_current(i);
 if ids is null then update public.notification_jobs set status='suppressed',claim_token=null,lease_ends_at=null where id=j.id;return null;end if;
 update public.notification_jobs set status='sending' where id=j.id;update public.notification_job_items i set status='sending' where i.job_id=j.id and i.notification_id=any(ids) and i.status in ('queued','failed') and public.notification_item_is_current(i);
 return jsonb_build_object('jobId',j.id,'recipientId',j.recipient_id,'transport',j.transport,'endpointId',j.endpoint_id,'noticeIds',to_jsonb(ids),'matchId',j.match_id,'applicationId',app_id,'title','농구 매칭','body','새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.','expiresAt',public.utc_text(expiry));
end $$;
create or replace function public.api_refresh_notification_send(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.notification_jobs;ids uuid[];app_id uuid;expiry timestamptz;
begin
 select * into j from public.notification_jobs where id=p_job for update;if not found or j.status<>'sending' or j.lease_ends_at<=public.server_now() or not public.push_job_binding_current(j) then return null;end if;
 update public.notification_job_items i set status='suppressed' where i.job_id=j.id and i.status='sending' and not public.notification_item_is_current(i);
 select array_agg(distinct n.id),case when count(distinct n.application_id)=1 then min(n.application_id::text)::uuid else null end,min(i.expires_at) into ids,app_id,expiry from public.notification_job_items i join public.notifications n on n.id=i.notification_id where i.job_id=j.id and i.status='sending' and public.notification_item_is_current(i);
 if ids is null then return null;end if;
 return jsonb_build_object('jobId',j.id,'recipientId',j.recipient_id,'transport',j.transport,'endpointId',j.endpoint_id,'noticeIds',to_jsonb(ids),'matchId',j.match_id,'applicationId',app_id,'title','농구 매칭','body','새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.','expiresAt',public.utc_text(expiry));
end $$;
revoke all on function public.api_register_push_endpoint(uuid,text,text,text,jsonb),public.api_deactivate_push_endpoint(uuid,uuid,int),public.api_select_push_endpoint(uuid),public.api_expire_push_endpoint(uuid,int),public.push_job_binding_current(public.notification_jobs),public.api_push_binding_for_job(uuid),public.api_refresh_notification_send(uuid) from public,anon,authenticated;
grant execute on function public.api_register_push_endpoint(uuid,text,text,text,jsonb),public.api_deactivate_push_endpoint(uuid,uuid,int),public.api_select_push_endpoint(uuid),public.api_expire_push_endpoint(uuid,int),public.push_job_binding_current(public.notification_jobs),public.api_push_binding_for_job(uuid),public.api_refresh_notification_send(uuid) to service_role;
