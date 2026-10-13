create table public.format_notices (
 id uuid primary key default gen_random_uuid(), match_id uuid not null references public.matches(id), version int not null,
 previous_players int not null check(previous_players in (3,4,5)), current_players int not null check(current_players in (3,4,5)),
 actor_id uuid not null references public.profiles(id), announced_at timestamptz not null default public.server_now(), reason text not null,
 affected_application_ids uuid[] not null, unique(match_id,version)
);
create table public.format_acknowledgements (
 notice_id uuid references public.format_notices(id),application_id uuid references public.applications(id),acknowledged_at timestamptz not null default public.server_now(),primary key(notice_id,application_id)
);
create table public.cancellation_receipts (
 id uuid primary key default gen_random_uuid(),application_id uuid not null references public.applications(id),match_id uuid not null references public.matches(id),
 actor_id uuid references public.profiles(id),received_at timestamptz not null default public.server_now(),cause text not null check(cause in ('personal','host_cancelled','format_change_declined')),
 format_change_id uuid references public.format_notices(id),terms jsonb not null,
 check((cause='format_change_declined')=(format_change_id is not null))
);
create unique index one_cancellation_reason on public.cancellation_receipts(application_id,cause,coalesce(format_change_id,'00000000-0000-0000-0000-000000000000'));
create table public.match_host_reports (id uuid primary key default gen_random_uuid(),match_id uuid not null references public.matches(id),reported_by uuid not null references public.profiles(id),reported_at timestamptz not null default public.server_now(),reason text not null);
create table public.issues (id uuid primary key default gen_random_uuid(),reporter_id uuid not null references public.profiles(id),match_id uuid references public.matches(id),facility_id uuid references public.facilities(id),text text not null,created_at timestamptz not null default public.server_now(),status text not null default 'open');
create table private.account_deletion_requests (user_id uuid primary key references public.profiles(id),auth_id uuid not null,requested_at timestamptz not null default public.server_now(),status text not null default 'pending',completed_at timestamptz,last_error text);
alter table public.format_notices enable row level security;
alter table public.format_acknowledgements enable row level security;
alter table public.cancellation_receipts enable row level security;
alter table public.match_host_reports enable row level security;
alter table public.issues enable row level security;
revoke all on public.format_notices,public.format_acknowledgements,public.cancellation_receipts,public.match_host_reports,public.issues,private.account_deletion_requests from public,anon,authenticated;
grant all on public.format_notices,public.format_acknowledgements,public.cancellation_receipts,public.match_host_reports,public.issues,private.account_deletion_requests to service_role;

create or replace function public.require_active_actor(p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where id=p_actor and auth_id is not null and deleted_at is null for key share;
 if not found then raise exception 'UNAUTHORIZED'; end if;
end $$;

create or replace function public.api_operator_dashboard(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);if not public.is_operator(p_actor) then raise exception 'FORBIDDEN'; end if;
 return jsonb_build_object('teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'status',t.status,'contactRoute',t.contact_route,'evidence',t.evidence) order by t.created_at desc) from public.teams t),'[]'),'issues',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'matchId',i.match_id,'facilityId',i.facility_id,'text',i.text,'status',i.status) order by i.created_at desc) from public.issues i),'[]'),'matches',coalesce((select jsonb_agg(public.match_json(m) order by m.starts_at desc) from public.matches m),'[]'));
end $$;
revoke all on function public.api_operator_dashboard(uuid) from public,anon,authenticated;
grant execute on function public.api_operator_dashboard(uuid) to service_role;

create or replace function public.api_match_notification_context(p_match uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches;
begin
 select * into m from public.matches where id=p_match;if not found then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('match',jsonb_build_object('id',m.id,'startsAt',public.utc_text(m.starts_at),'recruitmentStatus',m.recruitment_status),'roster',public.match_roster(m.id),'applications',coalesce((select jsonb_agg(public.application_json(a)) from public.applications a where match_id=p_match),'[]'),'activeCaptainIds',coalesce((select jsonb_agg(tm.user_id) from public.team_memberships tm where tm.team_id=m.team_id and public.is_team_manager(tm.user_id,m.team_id)),'[]'),'formatNotices',coalesce((select jsonb_agg(public.format_notice_json(n,true)) from public.format_notices n where n.match_id=m.id),'[]'),'cancellations',coalesce((select jsonb_agg(public.cancellation_json(r)) from public.cancellation_receipts r where r.match_id=m.id),'[]'),'hostReports',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'reportedBy',r.reported_by,'reportedAt',public.utc_text(r.reported_at),'reason',r.reason)) from public.match_host_reports r where r.match_id=m.id),'[]'));
end $$;

-- 공개 모집에는 대상 회원 ID와 등록자의 비공개 증빙을 포함하지 않습니다.
create or replace function public.match_json(m public.matches) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.facilities;
begin
 select * into f from public.facilities where id=m.facility_id;
 return m.data || jsonb_build_object('id',m.id,'teamId',m.team_id,'teamName',(select name from public.teams where id=m.team_id),'facilityId',m.facility_id,'facility',public.facility_json(f),'startsAt',public.utc_text(m.starts_at),'endsAt',public.utc_text(m.ends_at),'recruitmentStatus',m.recruitment_status,'formatVersion',m.format_version,'roster',public.match_roster(m.id),'formatNotices',coalesce((select jsonb_agg(public.format_notice_json(n) order by n.announced_at desc) from public.format_notices n where n.match_id=m.id),'[]'),'hostReports',coalesce((select jsonb_agg(jsonb_build_object('reportedAt',public.utc_text(r.reported_at),'reason',r.reason,'source','host_report') order by r.reported_at desc) from public.match_host_reports r where r.match_id=m.id),'[]'));
end $$;

create or replace function public.format_notice_json(n public.format_notices,p_private boolean default false) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',n.id,'matchId',n.match_id,'version',n.version,'previousPlayersPerTeam',n.previous_players,'currentPlayersPerTeam',n.current_players,'announcedAt',public.utc_text(n.announced_at),'reason',n.reason) || case when p_private then jsonb_build_object('actorId',n.actor_id,'affectedApplicationIds',n.affected_application_ids) else '{}'::jsonb end
$$;
create or replace function public.cancellation_json(r public.cancellation_receipts) returns jsonb
language sql immutable set search_path='' as $$select jsonb_build_object('id',r.id,'applicationId',r.application_id,'matchId',r.match_id,'receivedAt',public.utc_text(r.received_at),'cause',r.cause,'formatChangeId',r.format_change_id,'terms',r.terms)$$;
create or replace function public.record_cancellation(p_actor uuid,p_application uuid,p_cause text,p_notice uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.applications; r public.cancellation_receipts;
begin
 select * into a from public.applications where id=p_application for update;
 insert into public.cancellation_receipts(application_id,match_id,actor_id,cause,format_change_id,terms) values(a.id,a.match_id,p_actor,p_cause,p_notice,a.terms) on conflict do nothing;
 select * into r from public.cancellation_receipts where application_id=a.id and cause=p_cause and format_change_id is not distinct from p_notice;
 update public.applications set state='cancelled' where id=a.id;
 insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('domain_event','application.cancelled',a.match_id,a.id,p_actor,jsonb_build_object('receiptId',r.id,'cause',p_cause));
 return public.cancellation_json(r);
end $$;
create or replace function public.api_cancel_application(p_actor uuid,p_application uuid,p_cause text,p_notice uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.applications; m public.matches; n public.format_notices; v_match uuid; cached jsonb; result jsonb;
begin
 perform public.require_active_actor(p_actor);select match_id into v_match from public.applications where id=p_application;if not found then raise exception 'NOT_FOUND'; end if;
 select * into m from public.matches where id=v_match for update;select * into a from public.applications where id=p_application for update;
 if a.applicant_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 cached:=public.begin_command(p_actor,'cancel_application',p_request_id,jsonb_build_object('applicationId',p_application,'cause',p_cause,'formatChangeId',p_notice));if cached is not null then return cached; end if;
 if p_cause not in ('personal','format_change_declined') or (p_cause='personal' and p_notice is not null) then raise exception 'INVALID_INPUT'; end if;
 if p_cause='format_change_declined' then
  select * into n from public.format_notices where id=p_notice and match_id=m.id;
  if not found or not a.id=any(n.affected_application_ids) then raise exception 'INVALID_INPUT'; end if;
  if public.server_now()>=m.starts_at then raise exception 'LATE_CHANGE_NEEDS_REVIEW'; end if;
 end if;
 if a.state not in ('pending','awaiting_payment','verifying_payment','confirmed','cancelled') then raise exception 'INVALID_STATE'; end if;
 result:=public.record_cancellation(p_actor,a.id,p_cause,p_notice);
 insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');
 perform public.finish_command(p_actor,'cancel_application',p_request_id,result);return result;
end $$;
create or replace function public.api_cancel_match(p_actor uuid,p_match uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; a public.applications; cached jsonb; result jsonb:='[]';
begin
 perform public.require_active_actor(p_actor);select * into m from public.matches where id=p_match for update;if not found then raise exception 'NOT_FOUND'; end if;
 if not (public.is_operator(p_actor) or public.is_team_manager(p_actor,m.team_id)) then raise exception 'FORBIDDEN'; end if;
 cached:=public.begin_command(p_actor,'cancel_match',p_request_id,jsonb_build_object('matchId',p_match));if cached is not null then return cached; end if;
 update public.matches set recruitment_status='cancelled' where id=m.id;
 for a in select * from public.applications where match_id=m.id order by id for update loop
  result:=result || jsonb_build_array(public.record_cancellation(p_actor,a.id,'host_cancelled',null));
 end loop;
 insert into public.activity_records(scope,kind,match_id,actor_id,payload) values('domain_event','match.cancelled',m.id,p_actor,'{}');
 insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');
 perform public.finish_command(p_actor,'cancel_match',p_request_id,result);return result;
end $$;
create or replace function public.api_announce_format(p_actor uuid,p_match uuid,p_players int,p_reason text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; n public.format_notices; cached jsonb; result jsonb; affected uuid[];
begin
 perform public.require_active_actor(p_actor);select * into m from public.matches where id=p_match for update;if not found then raise exception 'NOT_FOUND'; end if;
 if not (public.is_operator(p_actor) or public.is_team_manager(p_actor,m.team_id)) then raise exception 'FORBIDDEN'; end if;
 cached:=public.begin_command(p_actor,'announce_format',p_request_id,jsonb_build_object('matchId',p_match,'playersPerTeam',p_players,'reason',p_reason));if cached is not null then return cached; end if;
 if p_players not in (3,4,5) or p_players=(m.data->>'playersPerTeam')::int or coalesce(char_length(btrim(p_reason)),0) not between 1 and 1000 or m.recruitment_status='cancelled' then raise exception 'INVALID_INPUT'; end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into affected from public.applications where match_id=m.id and state in ('pending','awaiting_payment','verifying_payment','confirmed');
 insert into public.format_notices(match_id,version,previous_players,current_players,actor_id,reason,affected_application_ids) values(m.id,m.format_version+1,(m.data->>'playersPerTeam')::int,p_players,p_actor,p_reason,affected) returning * into n;
 update public.matches set format_version=n.version,data=jsonb_set(data,'{playersPerTeam}',to_jsonb(p_players)) where id=m.id;
 insert into public.activity_records(scope,kind,match_id,actor_id,payload) values('domain_event','format.changed',m.id,p_actor,jsonb_build_object('noticeId',n.id,'version',n.version));
 insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');
 result:=public.format_notice_json(n,true);perform public.finish_command(p_actor,'announce_format',p_request_id,result);return result;
end $$;
create or replace function public.api_acknowledge_format(p_actor uuid,p_application uuid,p_notice uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.applications; n public.format_notices; m public.matches; v_match uuid; result jsonb; cached jsonb;
begin
 perform public.require_active_actor(p_actor);select match_id into v_match from public.applications where id=p_application;if not found then raise exception 'NOT_FOUND'; end if;
 select * into m from public.matches where id=v_match for update;select * into a from public.applications where id=p_application for update;
 if a.applicant_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 select * into n from public.format_notices where id=p_notice and match_id=m.id and version=m.format_version;
 if not found or not a.id=any(n.affected_application_ids) or a.state not in ('pending','awaiting_payment','verifying_payment','confirmed') then raise exception 'INVALID_INPUT'; end if;
 if public.server_now()>=m.starts_at then raise exception 'LATE_CHANGE_NEEDS_REVIEW'; end if;
 cached:=public.begin_command(p_actor,'acknowledge_format',p_request_id,jsonb_build_object('applicationId',a.id,'noticeId',n.id));if cached is not null then return cached; end if;
 insert into public.format_acknowledgements(notice_id,application_id) values(n.id,a.id) on conflict do nothing;
 insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('audit','format.acknowledged',m.id,a.id,p_actor,jsonb_build_object('noticeId',n.id));
 result:=jsonb_build_object('noticeId',n.id,'applicationId',a.id,'acknowledged',true);perform public.finish_command(p_actor,'acknowledge_format',p_request_id,result);return result;
end $$;
create or replace function public.format_is_acknowledged(p_application uuid,p_match uuid) returns boolean
language sql security definer set search_path='' as $$
 select exists(select 1 from public.applications a join public.matches m on m.id=a.match_id where a.id=p_application and m.id=p_match and ((a.terms->>'formatVersion')::int=m.format_version or exists(select 1 from public.format_notices n join public.format_acknowledgements ack on ack.notice_id=n.id where n.match_id=m.id and n.version=m.format_version and ack.application_id=a.id)))
$$;
create or replace function public.api_my_format_notices(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);
 return coalesce((select jsonb_agg(jsonb_build_object('applicationId',a.id,'notice',public.format_notice_json(n),'acknowledged',exists(select 1 from public.format_acknowledgements ack where ack.notice_id=n.id and ack.application_id=a.id)) order by n.announced_at desc) from public.applications a join public.format_notices n on n.match_id=a.match_id and a.id=any(n.affected_application_ids) where a.applicant_id=p_actor),'[]');
end $$;
create or replace function public.api_report_proceeding(p_actor uuid,p_match uuid,p_reason text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; r public.match_host_reports; cached jsonb; result jsonb;
begin
 perform public.require_active_actor(p_actor);select * into m from public.matches where id=p_match for update;if not found then raise exception 'NOT_FOUND'; end if;
 if not (public.is_operator(p_actor) or public.is_team_manager(p_actor,m.team_id)) then raise exception 'FORBIDDEN'; end if;
 if m.recruitment_status='cancelled' or coalesce(char_length(btrim(p_reason)),0) not between 1 and 1000 then raise exception 'INVALID_INPUT'; end if;
 cached:=public.begin_command(p_actor,'report_proceeding',p_request_id,jsonb_build_object('matchId',p_match,'reason',p_reason));if cached is not null then return cached; end if;
 insert into public.match_host_reports(match_id,reported_by,reason) values(m.id,p_actor,p_reason) returning * into r;
 result:=jsonb_build_object('matchId',m.id,'reportedBy',r.reported_by,'reportedAt',public.utc_text(r.reported_at),'source','host_report');
 insert into public.activity_records(scope,kind,match_id,actor_id,payload) values('domain_event','match.proceeding_reported',m.id,p_actor,jsonb_build_object('reportId',r.id,'source','host_report'));
 perform public.finish_command(p_actor,'report_proceeding',p_request_id,result);return result;
end $$;
create or replace function public.api_report_issue(p_actor uuid,p_match uuid,p_facility uuid,p_text text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; id uuid; result jsonb;
begin
 perform public.require_active_actor(p_actor);if coalesce(char_length(btrim(p_text)),0) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
 cached:=public.begin_command(p_actor,'report_issue',p_request_id,jsonb_build_object('matchId',p_match,'facilityId',p_facility,'text',p_text));if cached is not null then return cached; end if;
 insert into public.issues(reporter_id,match_id,facility_id,text) values(p_actor,p_match,p_facility,p_text) returning issues.id into id;
 result:=jsonb_build_object('issueId',id);perform public.finish_command(p_actor,'report_issue',p_request_id,result);return result;
end $$;
create or replace function public.api_moderate_match(p_actor uuid,p_match uuid,p_action text,p_reason text,p_request_id text) returns void
language plpgsql security definer set search_path='' as $$
declare cached jsonb;
begin
 perform public.require_active_actor(p_actor);if not public.is_operator(p_actor) then raise exception 'FORBIDDEN'; end if;
 perform 1 from public.matches where id=p_match for update;if not found then raise exception 'NOT_FOUND'; end if;
 if p_action not in ('hide','stop_recruitment') or coalesce(char_length(btrim(p_reason)),0) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
 cached:=public.begin_command(p_actor,'moderate_match',p_request_id,jsonb_build_object('matchId',p_match,'action',p_action,'reason',p_reason));if cached is not null then return; end if;
 update public.matches set hidden=case when p_action='hide' then true else hidden end,recruitment_status=case when p_action='stop_recruitment' then 'closed' else recruitment_status end where id=p_match;
 insert into public.activity_records(scope,kind,match_id,actor_id,payload) values('audit','match.moderated',p_match,p_actor,jsonb_build_object('action',p_action,'reason',p_reason));
 perform public.finish_command(p_actor,'moderate_match',p_request_id,'{}');
end $$;
create or replace function public.api_prepare_account_deletion(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.profiles; team record; unresolved boolean:=false;
begin
 perform public.require_active_actor(p_actor);select * into p from public.profiles where id=p_actor for update;
 if exists(select 1 from public.applications a join public.matches m on m.id=a.match_id where a.applicant_id=p_actor and a.state in ('pending','awaiting_payment','verifying_payment','confirmed') and m.ends_at>public.server_now()) then return jsonb_build_object('status','needs_resolution'); end if;
 if exists(select 1 from public.team_memberships tm join public.matches m on m.team_id=tm.team_id where tm.user_id=p_actor and tm.active and tm.role in ('captain','secretary') and m.ends_at>public.server_now() and m.recruitment_status<>'cancelled' and not exists(select 1 from public.team_memberships other where other.team_id=tm.team_id and other.user_id<>p_actor and other.active and other.role in ('captain','secretary'))) then return jsonb_build_object('status','needs_resolution'); end if;
 if to_regclass('public.test_orders') is not null then execute 'select exists(select 1 from public.test_orders where owner_id=$1 and status in (''approval_pending'',''unknown'',''needs_review''))' into unresolved using p_actor; end if;
 if unresolved then return jsonb_build_object('status','needs_resolution'); end if;
 update public.profiles set deleted_at=public.server_now(),preferences=null,nickname='탈퇴한 회원' where id=p_actor;
 update public.team_memberships set active=false where user_id=p_actor;
 insert into private.account_deletion_requests(user_id,auth_id) values(p_actor,p.auth_id) on conflict do nothing;
 insert into public.activity_records(scope,kind,actor_id,payload) values('audit','account.deletion_requested',p_actor,'{}');
 return jsonb_build_object('status','ready','authId',p.auth_id);
end $$;
create or replace function public.api_finish_account_deletion(p_actor uuid,p_success boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 update private.account_deletion_requests set status=case when p_success then 'completed' else 'pending' end,completed_at=case when p_success then public.server_now() else null end,last_error=case when p_success then null else 'AUTH_UNAVAILABLE' end where user_id=p_actor;
 if p_success then insert into public.activity_records(scope,kind,actor_id,payload) values('audit','account.deletion_completed',p_actor,'{}'); end if;
end $$;

-- 이 마이그레이션의 함수를 외부 클라이언트에 직접 열지 않습니다.
revoke all on function public.format_notice_json(public.format_notices,boolean),public.cancellation_json(public.cancellation_receipts),public.record_cancellation(uuid,uuid,text,uuid),public.api_cancel_application(uuid,uuid,text,uuid,text),public.api_cancel_match(uuid,uuid,text),public.api_announce_format(uuid,uuid,int,text,text),public.api_acknowledge_format(uuid,uuid,uuid,text),public.format_is_acknowledged(uuid,uuid),public.api_my_format_notices(uuid),public.api_report_proceeding(uuid,uuid,text,text),public.api_report_issue(uuid,uuid,uuid,text,text),public.api_moderate_match(uuid,uuid,text,text,text),public.api_prepare_account_deletion(uuid),public.api_finish_account_deletion(uuid,boolean) from public,anon,authenticated;
grant execute on function public.format_notice_json(public.format_notices,boolean),public.cancellation_json(public.cancellation_receipts),public.record_cancellation(uuid,uuid,text,uuid),public.api_cancel_application(uuid,uuid,text,uuid,text),public.api_cancel_match(uuid,uuid,text),public.api_announce_format(uuid,uuid,int,text,text),public.api_acknowledge_format(uuid,uuid,uuid,text),public.format_is_acknowledged(uuid,uuid),public.api_my_format_notices(uuid),public.api_report_proceeding(uuid,uuid,text,text),public.api_report_issue(uuid,uuid,uuid,text,text),public.api_moderate_match(uuid,uuid,text,text,text),public.api_prepare_account_deletion(uuid),public.api_finish_account_deletion(uuid,boolean) to service_role;

-- 변경 확인 기록을 사용하는 기존 수락 함수 갱신
create or replace function public.api_accept_application(p_actor uuid,p_application uuid,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; a public.applications; match_id uuid; cached jsonb; result jsonb; roster jsonb; v_now timestamptz;
begin
 perform public.require_active_actor(p_actor);select a1.match_id into match_id from public.applications a1 where a1.id=p_application;
 if not found then raise exception 'NOT_FOUND'; end if;
 select * into m from public.matches where id=match_id for update;
 if not public.is_team_manager(p_actor,m.team_id) then raise exception 'FORBIDDEN'; end if;
 perform public.expire_match_unpaid(m.id);select * into a from public.applications where id=p_application for update;
 cached:=public.begin_command(p_actor,'accept_application',p_request_id,jsonb_build_object('applicationId',p_application));if cached is not null then return cached; end if;
 v_now:=public.server_now();
 if m.hidden or m.recruitment_status<>'open' or m.starts_at<=v_now then raise exception 'MATCH_STARTED'; end if;
 if a.state<>'pending' then raise exception 'INVALID_STATE'; end if;
 if not public.format_is_acknowledged(a.id,m.id) then raise exception 'FORMAT_CHANGED'; end if;
 roster:=public.match_roster(m.id);
 if (roster->>'availableGuests')::int<=0 or (roster->'positionSlots'->a.position->>'available')::int<=0 then raise exception 'CAPACITY_FULL'; end if;
 if (a.terms->'pricing'->>'paymentAmountKrw')::bigint=0 then
  update public.applications set state='confirmed',accepted_at=v_now where id=a.id returning * into a;
  insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('domain_event','payment.confirmed',m.id,a.id,p_actor,jsonb_build_object('source','free_acceptance'));
 else
  update public.applications set state='awaiting_payment',accepted_at=v_now,payment_deadline_at=least(v_now+interval '30 minutes',m.starts_at) where id=a.id returning * into a;
 end if;
 insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('domain_event','application.accepted',m.id,a.id,p_actor,jsonb_build_object('paymentDeadlineAt',public.utc_text(a.payment_deadline_at)));
 insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',m.id,'{}');
 result:=public.application_json(a);perform public.finish_command(p_actor,'accept_application',p_request_id,result);return result;
end $$;
