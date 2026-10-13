-- 초기 서비스의 공유 자료·접근 권한. 돈이 오가는 운영 전환은 별도입니다.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;
revoke create on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public;

create or replace function public.server_now() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;

create or replace function public.valid_preferences(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare d jsonb; k text;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p)<>'object' then return false; end if;
  if (select count(*) from jsonb_object_keys(p))<>10 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if not k=any(array['origin','mode','maxMinutes','dateFrom','dateTo','weekdays','earliestStartMinute','latestStartMinute','latestEndMinute','position']) then return false; end if;
  end loop;
  if coalesce(jsonb_typeof(p->'origin'),'')<>'object' or coalesce(jsonb_typeof(p->'origin'->'lat'),'')<>'number' or coalesce(jsonb_typeof(p->'origin'->'lng'),'')<>'number' then return false; end if;
  if not ((p->'origin'->>'lat')::numeric between -90 and 90 and (p->'origin'->>'lng')::numeric between -180 and 180) then return false; end if;
  if jsonb_typeof(p->'mode')<>'string' or p->>'mode' not in ('subway','car') or jsonb_typeof(p->'maxMinutes')<>'number' then return false; end if;
  if not ((p->>'maxMinutes')::numeric between 1 and 9007199254740991 and (p->>'maxMinutes')::numeric=trunc((p->>'maxMinutes')::numeric)) then return false; end if;
  if jsonb_typeof(p->'dateFrom')<>'string' or jsonb_typeof(p->'dateTo')<>'string' or p->>'dateFrom' !~ '^\d{4}-\d{2}-\d{2}$' or p->>'dateTo' !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  if (p->>'dateFrom')::date>(p->>'dateTo')::date then return false; end if;
  if jsonb_typeof(p->'weekdays')<>'array' or jsonb_array_length(p->'weekdays')=0 then return false; end if;
  for d in select jsonb_array_elements(p->'weekdays') loop
    if jsonb_typeof(d)<>'number' or not (d::numeric between 1 and 7 and d::numeric=trunc(d::numeric)) then return false; end if;
  end loop;
  foreach k in array array['earliestStartMinute','latestStartMinute'] loop
    if jsonb_typeof(p->k)<>'number' or not ((p->>k)::numeric between 0 and 1439 and (p->>k)::numeric=trunc((p->>k)::numeric)) then return false; end if;
  end loop;
  if (p->>'earliestStartMinute')::int>(p->>'latestStartMinute')::int then return false; end if;
  if p->'latestEndMinute'<>'null'::jsonb and (jsonb_typeof(p->'latestEndMinute')<>'number' or not ((p->>'latestEndMinute')::numeric between 0 and 1439 and (p->>'latestEndMinute')::numeric=trunc((p->>'latestEndMinute')::numeric))) then return false; end if;
  if p->'position'<>'null'::jsonb and p->>'position' not in ('guard','forward','center') then return false; end if;
  return coalesce(p ?& array['origin','mode','maxMinutes','dateFrom','dateTo','weekdays','earliestStartMinute','latestStartMinute','latestEndMinute','position'],false);
exception when others then return false;
end $$;

create table public.profiles (
  id uuid primary key,
  auth_id uuid unique references auth.users(id) on delete set null,
  nickname text not null default '농구친구' check(char_length(nickname) between 1 and 80),
  preferences jsonb check(public.valid_preferences(preferences)),
  created_at timestamptz not null default public.server_now(),
  deleted_at timestamptz
);
create table private.operator_users (user_id uuid primary key references public.profiles(id));

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 1 and 80),
  contact_route text not null check(char_length(contact_route) between 1 and 300),
  evidence text not null check(char_length(evidence) between 1 and 2000),
  status text not null default 'pending' check(status in ('pending','approved','needs_info','rejected','suspended')),
  created_by uuid not null references public.profiles(id),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_reason text,
  created_at timestamptz not null default public.server_now()
);
create table public.team_memberships (
  team_id uuid references public.teams(id), user_id uuid references public.profiles(id),
  role text not null check(role in ('captain','secretary','member')), active boolean not null default true,
  primary key(team_id,user_id)
);
create table public.facilities (
  id uuid primary key default gen_random_uuid(), name text not null, address text not null,
  latitude double precision not null check(latitude between -90 and 90),
  longitude double precision not null check(longitude between -180 and 180),
  region text not null check(region in ('seoul','incheon')),
  registration text not null check(registration in ('operator','map_search','manual_pin')),
  registered_by uuid references public.profiles(id), source_url text, evidence text not null,
  location_status text not null default 'unverified' check(location_status in ('unverified','verified')),
  basketball_use_status text not null default 'unverified' check(basketball_use_status in ('unverified','verified')),
  verified_at timestamptz, created_at timestamptz not null default public.server_now()
);
create table public.refund_policies (
  version text primary key, name text not null, environment text not null check(environment='test'), rules jsonb not null
);
insert into public.refund_policies values
 ('test-A-v1','테스트 정책 A','test','{"fullBeforeMinutes":120,"otherwiseRatioBps":0}'),
 ('test-B-v1','테스트 정책 B','test','{"fullBeforeMinutes":1440,"halfBeforeMinutes":120,"otherwiseRatioBps":0}');

create table public.matches (
  id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id),
  facility_id uuid not null references public.facilities(id),
  starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
  data jsonb not null, format_version integer not null default 1,
  recruitment_status text not null default 'open' check(recruitment_status in ('open','closed','cancelled')),
  hidden boolean not null default false, created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default public.server_now()
);
create table public.applications (
  id uuid primary key default gen_random_uuid(), match_id uuid not null references public.matches(id),
  applicant_id uuid not null references public.profiles(id), position text not null check(position in ('guard','forward','center')),
  state text not null default 'pending' check(state in ('pending','awaiting_payment','verifying_payment','confirmed','rejected','expired','cancelled')),
  terms jsonb not null, submitted_at timestamptz not null default public.server_now(),
  accepted_at timestamptz, payment_deadline_at timestamptz
);
create unique index one_active_application on public.applications(match_id,applicant_id)
where state in ('pending','awaiting_payment','verifying_payment','confirmed');
create index match_applications on public.applications(match_id,state);

create table public.activity_records (
  id uuid primary key default gen_random_uuid(), scope text not null check(scope in ('audit','domain_event')),
  kind text not null, match_id uuid references public.matches(id), application_id uuid references public.applications(id),
  actor_id uuid references public.profiles(id), occurred_at timestamptz not null default public.server_now(), payload jsonb not null
);
create table public.command_receipts (
  actor_id uuid references public.profiles(id), command_type text, request_id text check(char_length(request_id) between 1 and 128),
  input_hash text not null, result jsonb, created_at timestamptz not null default public.server_now(),
  primary key(actor_id,command_type,request_id)
);

create or replace function public.handle_new_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into public.profiles(id,auth_id,nickname) values(new.id,new.id,left(coalesce(nullif(new.raw_user_meta_data->>'nickname',''),nullif(new.raw_user_meta_data->>'name',''),'농구친구'),80));
  return new;
end $$;
create trigger create_profile_after_signup after insert on auth.users for each row execute function public.handle_new_profile();

create or replace function public.require_active_actor(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and auth_id is not null and deleted_at is null) then raise exception 'UNAUTHORIZED'; end if;
end $$;
create or replace function public.is_operator(p_actor uuid) returns boolean
language sql security definer stable set search_path='' as $$select exists(select 1 from private.operator_users where user_id=p_actor)$$;
create or replace function public.is_team_manager(p_actor uuid,p_team uuid,p_captain_only boolean default false) returns boolean
language sql security definer stable set search_path='' as $$
select exists(select 1 from public.teams t join public.team_memberships m on m.team_id=t.id
where t.id=p_team and t.status='approved' and m.user_id=p_actor and m.active
and (m.role='captain' or (not p_captain_only and m.role='secretary')))$$;

create or replace function public.begin_command(p_actor uuid,p_command text,p_request text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare h text; r public.command_receipts;
begin
  perform public.require_active_actor(p_actor);
  if p_request is null or char_length(p_request) not between 1 and 128 then raise exception 'INVALID_INPUT'; end if;
  h:=encode(extensions.digest(p_input::text,'sha256'),'hex');
  insert into public.command_receipts(actor_id,command_type,request_id,input_hash) values(p_actor,p_command,p_request,h) on conflict do nothing;
  select * into r from public.command_receipts where actor_id=p_actor and command_type=p_command and request_id=p_request for update;
  if r.input_hash<>h then raise exception 'REQUEST_ID_CONFLICT'; end if;
  return r.result;
end $$;
create or replace function public.finish_command(p_actor uuid,p_command text,p_request text,p_result jsonb) returns void
language sql security definer set search_path='' as $$update public.command_receipts set result=p_result where actor_id=p_actor and command_type=p_command and request_id=p_request$$;

create or replace function public.api_get_preferences(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin perform public.require_active_actor(p_actor); return (select preferences from public.profiles where id=p_actor); end $$;
create or replace function public.api_save_preferences(p_actor uuid,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_actor(p_actor);
  if p_input is null or not public.valid_preferences(p_input) then raise exception 'INVALID_PREFERENCES'; end if;
  update public.profiles set preferences=p_input where id=p_actor;
  return p_input;
end $$;
create or replace function public.api_create_team(p_actor uuid,p_name text,p_contact_route text,p_evidence text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; v_team uuid; result jsonb;
begin
  cached:=public.begin_command(p_actor,'create_team',p_request_id,jsonb_build_object('name',p_name,'contactRoute',p_contact_route,'evidence',p_evidence));
  if cached is not null then return cached; end if;
  insert into public.teams(name,contact_route,evidence,created_by) values(btrim(p_name),p_contact_route,p_evidence,p_actor) returning id into v_team;
  insert into public.team_memberships(team_id,user_id,role) values(v_team,p_actor,'captain');
  insert into public.activity_records(scope,kind,actor_id,payload) values('audit','team.requested',p_actor,jsonb_build_object('teamId',v_team));
  result:=jsonb_build_object('id',v_team,'name',btrim(p_name),'status','pending');
  perform public.finish_command(p_actor,'create_team',p_request_id,result);
  return result;
end $$;
create or replace function public.api_review_team(p_actor uuid,p_team_id uuid,p_decision text,p_reason text,p_request_id text) returns void
language plpgsql security definer set search_path='' as $$
declare cached jsonb;
begin
  perform public.require_active_actor(p_actor);
  if not public.is_operator(p_actor) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved','needs_info','rejected') or char_length(btrim(p_reason)) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
  perform 1 from public.teams where id=p_team_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  cached:=public.begin_command(p_actor,'review_team',p_request_id,jsonb_build_object('teamId',p_team_id,'decision',p_decision,'reason',p_reason));
  if cached is not null then return; end if;
  update public.teams set status=p_decision,reviewed_by=p_actor,reviewed_at=public.server_now(),review_reason=p_reason where id=p_team_id;
  insert into public.activity_records(scope,kind,actor_id,payload) values('audit','team.reviewed',p_actor,jsonb_build_object('teamId',p_team_id,'decision',p_decision,'reason',p_reason));
  perform public.finish_command(p_actor,'review_team',p_request_id,'{}');
end $$;
create or replace function public.api_update_team_member(p_actor uuid,p_team_id uuid,p_user_id uuid,p_role text,p_active boolean,p_request_id text) returns void
language plpgsql security definer set search_path='' as $$
declare cached jsonb;
begin
  perform public.require_active_actor(p_actor);
  perform 1 from public.teams where id=p_team_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not (public.is_operator(p_actor) or public.is_team_manager(p_actor,p_team_id,true)) then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('captain','secretary','member') or p_active is null then raise exception 'INVALID_INPUT'; end if;
  perform public.require_active_actor(p_user_id);
  cached:=public.begin_command(p_actor,'update_member',p_request_id,jsonb_build_object('teamId',p_team_id,'userId',p_user_id,'role',p_role,'active',p_active));
  if cached is not null then return; end if;
  insert into public.team_memberships values(p_team_id,p_user_id,p_role,p_active) on conflict(team_id,user_id) do update set role=excluded.role,active=excluded.active;
  insert into public.activity_records(scope,kind,actor_id,payload) values('audit','team.member_changed',p_actor,jsonb_build_object('teamId',p_team_id,'userId',p_user_id,'role',p_role,'active',p_active));
  perform public.finish_command(p_actor,'update_member',p_request_id,'{}');
end $$;
create or replace function public.api_my_teams(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_actor(p_actor);
  return coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'role',m.role,'active',m.active,'reviewReason',t.review_reason)) from public.teams t join public.team_memberships m on m.team_id=t.id where m.user_id=p_actor),'[]'::jsonb);
end $$;
create or replace function public.api_profile(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.require_active_actor(p_actor);
  return (select jsonb_build_object('userId',id,'nickname',nickname,'isOperator',public.is_operator(id)) from public.profiles where id=p_actor);
end $$;

create view public.public_teams with(security_barrier=true) as select id,name,status,reviewed_at from public.teams where status='approved';

alter table public.profiles enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.facilities enable row level security;
alter table public.refund_policies enable row level security;
alter table public.matches enable row level security;
alter table public.applications enable row level security;
alter table public.activity_records enable row level security;
alter table public.command_receipts enable row level security;

revoke all on public.profiles,public.teams,public.team_memberships,public.facilities,public.refund_policies,public.matches,public.applications,public.activity_records,public.command_receipts from anon,authenticated;
grant all on public.profiles,public.teams,public.team_memberships,public.facilities,public.refund_policies,public.matches,public.applications,public.activity_records,public.command_receipts to service_role;
grant all on private.operator_users to service_role;
grant select on public.profiles,public.team_memberships,public.applications to authenticated;
grant update(nickname,preferences) on public.profiles to authenticated;
grant select(id,name,address,latitude,longitude,region,registration,location_status,basketball_use_status,verified_at,source_url) on public.facilities to anon,authenticated;
grant select on public.public_teams,public.refund_policies,public.matches to anon,authenticated;

create policy own_profile_read on public.profiles for select to authenticated using(auth_id=auth.uid() and deleted_at is null);
create policy own_profile_update on public.profiles for update to authenticated using(auth_id=auth.uid() and deleted_at is null) with check(auth_id=auth.uid() and deleted_at is null);
create policy own_membership_read on public.team_memberships for select to authenticated using(user_id=auth.uid());
create policy own_application_read on public.applications for select to authenticated using(applicant_id=auth.uid());
create policy facility_public_read on public.facilities for select to anon,authenticated using(true);
create policy policies_public_read on public.refund_policies for select to anon,authenticated using(true);
create policy matches_public_read on public.matches for select to anon,authenticated using(not hidden and exists(select 1 from public.public_teams t where t.id=team_id));

revoke execute on function public.server_now(),public.valid_preferences(jsonb),public.handle_new_profile(),public.require_active_actor(uuid),public.is_operator(uuid),public.is_team_manager(uuid,uuid,boolean),public.begin_command(uuid,text,text,jsonb),public.finish_command(uuid,text,text,jsonb),public.api_get_preferences(uuid),public.api_save_preferences(uuid,jsonb),public.api_create_team(uuid,text,text,text,text),public.api_review_team(uuid,uuid,text,text,text),public.api_update_team_member(uuid,uuid,uuid,text,boolean,text),public.api_my_teams(uuid),public.api_profile(uuid) from public,anon,authenticated;
grant execute on function public.server_now(),public.valid_preferences(jsonb) to authenticated,service_role;
grant execute on function public.require_active_actor(uuid),public.is_operator(uuid),public.is_team_manager(uuid,uuid,boolean),public.begin_command(uuid,text,text,jsonb),public.finish_command(uuid,text,text,jsonb),public.api_get_preferences(uuid),public.api_save_preferences(uuid,jsonb),public.api_create_team(uuid,text,text,text,text),public.api_review_team(uuid,uuid,text,text,text),public.api_update_team_member(uuid,uuid,uuid,text,boolean,text),public.api_my_teams(uuid),public.api_profile(uuid) to service_role;
