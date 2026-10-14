create or replace function public.after_profile_push_deletion() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.deleted_at is null and new.deleted_at is not null then
  update public.push_endpoints set active=false,deactivated_at=public.server_now(),owner_version=owner_version+1,registration='{}' where owner_id=new.id;
 end if;return new;
end$$;
create trigger profile_push_deletion after update of deleted_at on public.profiles for each row execute function public.after_profile_push_deletion();
create or replace function public.api_account_deletion_candidates() returns jsonb language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',user_id,'authId',auth_id)),'[]') from (select r.user_id,r.auth_id from private.account_deletion_requests r join public.profiles p on p.id=r.user_id where r.status='pending' and p.deleted_at is not null order by r.requested_at limit 20) pending;
$$;
create or replace function public.api_finish_account_deletion(p_actor uuid,p_success boolean) returns void language plpgsql security definer set search_path='' as $$begin
 update private.account_deletion_requests set status=case when p_success then 'completed' else 'pending' end,completed_at=case when p_success then public.server_now() else null end,last_error=case when p_success then null else 'AUTH_UNAVAILABLE' end where user_id=p_actor and status<>'completed';
 if found and p_success then insert into public.activity_records(scope,kind,actor_id,payload) values('audit','account.deletion_completed',p_actor,'{}');end if;
end$$;
revoke all on function public.after_profile_push_deletion(),public.api_account_deletion_candidates() from public,anon,authenticated;
grant execute on function public.api_account_deletion_candidates() to service_role;
