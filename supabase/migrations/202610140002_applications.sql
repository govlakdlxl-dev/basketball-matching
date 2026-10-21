-- 시각은 UTC ISO 밀리초 문자열로 반환합니다. 슬롯 전이는 모집글→신청 순으로 잠급니다.
create or replace function public.utc_text(t timestamptz) returns text
language sql immutable set search_path='' as $$select to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')$$;
create or replace function public.application_json(a public.applications) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',a.id,'matchId',a.match_id,'applicantId',a.applicant_id,'position',a.position,'state',a.state,'submittedAt',public.utc_text(a.submitted_at),'acceptedAt',public.utc_text(a.accepted_at),'paymentDeadlineAt',public.utc_text(a.payment_deadline_at),'terms',a.terms)
$$;
create or replace function public.match_roster(p_match uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; pos text; slots jsonb:='{}'; target int; confirmed int; held int; guest_target int:=0; all_confirmed int:=0; all_held int:=0; awaiting int; verifying int; projected int;
begin
 select * into m from public.matches where id=p_match;
 if not found then raise exception 'NOT_FOUND'; end if;
 foreach pos in array array['guard','forward','center'] loop
  target:=(m.data->'guestSlots'->>pos)::int;
  select count(*) filter(where state='confirmed')::int,count(*) filter(where state in ('awaiting_payment','verifying_payment'))::int into confirmed,held from public.applications where match_id=p_match and position=pos;
  slots:=slots || jsonb_build_object(pos,jsonb_build_object('target',target,'confirmed',confirmed,'held',held,'available',greatest(0,target-confirmed-held)));
  guest_target:=guest_target+target;all_confirmed:=all_confirmed+confirmed;all_held:=all_held+held;
 end loop;
 select count(*) filter(where state='awaiting_payment')::int,count(*) filter(where state='verifying_payment')::int into awaiting,verifying from public.applications where match_id=p_match;
 projected:=(m.data->>'existingPlanned')::int+all_confirmed;
 return jsonb_build_object('matchId',m.id,'existingPlanned',(m.data->>'existingPlanned')::int,'confirmedGuests',all_confirmed,'awaitingPayment',awaiting,'verifyingPayment',verifying,'availableGuests',greatest(0,guest_target-all_confirmed-all_held),'projectedPlayers',projected,'guestTargetShortage',greatest(0,guest_target-all_confirmed),'minimumPlayerShortage',greatest(0,2*(m.data->>'playersPerTeam')::int-projected),'positionSlots',slots);
end $$;
create or replace function public.expire_match_unpaid(p_match uuid) returns int
language plpgsql security definer set search_path='' as $$
declare a public.applications; n int:=0; v_now timestamptz:=public.server_now();
begin
 perform 1 from public.matches where id=p_match for update;
 for a in select * from public.applications where match_id=p_match and state='awaiting_payment' and payment_deadline_at<=v_now order by id for update loop
  update public.applications set state='expired' where id=a.id;
  insert into public.activity_records(scope,kind,match_id,application_id,payload) values('domain_event','application.expired',p_match,a.id,jsonb_build_object('deadlineAt',public.utc_text(a.payment_deadline_at)));
  n:=n+1;
 end loop;
 if n>0 then insert into public.activity_records(scope,kind,match_id,payload) values('domain_event','roster.changed',p_match,'{}'); end if;
 return n;
end $$;
create or replace function public.api_expire_unpaid() returns int
language plpgsql security definer set search_path='' as $$
declare row record; n int:=0;
begin
 for row in select distinct match_id from public.applications where state='awaiting_payment' and payment_deadline_at<=public.server_now() order by match_id loop n:=n+public.expire_match_unpaid(row.match_id); end loop;
 return n;
end $$;
create or replace function public.match_json(m public.matches) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.facilities;
begin
 select * into f from public.facilities where id=m.facility_id;
 return m.data || jsonb_build_object('id',m.id,'teamId',m.team_id,'teamName',(select name from public.teams where id=m.team_id),'facilityId',m.facility_id,'facility',public.facility_json(f),'startsAt',public.utc_text(m.starts_at),'endsAt',public.utc_text(m.ends_at),'recruitmentStatus',m.recruitment_status,'formatVersion',m.format_version,'roster',public.match_roster(m.id));
end $$;
create or replace function public.match_terms(m public.matches) returns jsonb
language plpgsql security definer set search_path='' as $$
declare f public.facilities; fee bigint:=(m.data->>'baseFeeKrw')::bigint;
begin
 select * into f from public.facilities where id=m.facility_id;
 return jsonb_build_object('facility',jsonb_build_object('id',f.id,'name',f.name,'address',f.address,'point',jsonb_build_object('lat',f.latitude,'lng',f.longitude)),'startsAt',public.utc_text(m.starts_at),'endsAt',public.utc_text(m.ends_at),'playersPerTeam',(m.data->>'playersPerTeam')::int,'formatVersion',m.format_version,'policy',m.data->'policy','pricing',jsonb_build_object('baseFeeKrw',fee,'platformRateBps',0,'platformFeeKrw',0,'participantFeeKrw',0,'teamFeeKrw',0,'paymentAmountKrw',fee,'teamBasisKrw',fee,'currency','KRW','purpose','initial_test_order','pgCost',jsonb_build_object('status','unconfirmed','amountKrw',null,'bearer',null,'reason','견적과 부담 방식을 확인하지 않았습니다.')));
end $$;
create or replace function public.api_publish_match(p_actor uuid,p_input jsonb,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; cached jsonb; result jsonb; p_team uuid:=(p_input->>'teamId')::uuid; target int;
begin
 perform public.require_active_actor(p_actor);
 if not public.is_team_manager(p_actor,p_team) then raise exception 'FORBIDDEN'; end if;
 if (p_input->>'startsAt')::timestamptz<=public.server_now() then raise exception 'MATCH_STARTED'; end if;
 if (p_input->>'endsAt')::timestamptz<=(p_input->>'startsAt')::timestamptz or (p_input->>'playersPerTeam')::int not in (3,4,5) or (p_input->>'teamCount')::int<2 or (p_input->>'existingPlanned')::int<0 or (p_input->>'baseFeeKrw')::numeric<0 then raise exception 'INVALID_INPUT'; end if;
 target:=(p_input->'guestSlots'->>'guard')::int+(p_input->'guestSlots'->>'forward')::int+(p_input->'guestSlots'->>'center')::int;
 if target<1 or (p_input->'guestSlots'->>'guard')::int<0 or (p_input->'guestSlots'->>'forward')::int<0 or (p_input->'guestSlots'->>'center')::int<0 or target+(p_input->>'existingPlanned')::int<(p_input->>'playersPerTeam')::int*(p_input->>'teamCount')::int then raise exception 'INVALID_INPUT'; end if;
 if not exists(select 1 from public.refund_policies where version=p_input->'policy'->>'version') then raise exception 'INVALID_INPUT'; end if;
 cached:=public.begin_command(p_actor,'publish_match',p_request_id,p_input);if cached is not null then return cached; end if;
 insert into public.matches(team_id,facility_id,starts_at,ends_at,data,created_by) values(p_team,(p_input->>'facilityId')::uuid,(p_input->>'startsAt')::timestamptz,(p_input->>'endsAt')::timestamptz,p_input,p_actor) returning * into m;
 insert into public.activity_records(scope,kind,match_id,actor_id,payload) values('audit','match.published',m.id,p_actor,'{}');
 result:=public.match_json(m);perform public.finish_command(p_actor,'publish_match',p_request_id,result);return result;
end $$;
create or replace function public.api_get_match(p_match uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches;
begin
 select m1.* into m from public.matches m1 join public.teams t on t.id=m1.team_id where m1.id=p_match and not m1.hidden and t.status='approved';
 if not found then raise exception 'NOT_FOUND'; end if;
 perform public.expire_match_unpaid(m.id);select * into m from public.matches where id=p_match;return public.match_json(m);
end $$;
create or replace function public.api_list_matches() returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; result jsonb:='[]';
begin
 for m in select m1.* from public.matches m1 join public.teams t on t.id=m1.team_id where not m1.hidden and t.status='approved' and m1.starts_at>public.server_now() order by m1.starts_at,m1.id limit 200 loop
  perform public.expire_match_unpaid(m.id);result:=result || jsonb_build_array(public.match_json(m));
 end loop;return result;
end $$;
create or replace function public.api_submit_application(p_actor uuid,p_match uuid,p_position text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; a public.applications; result jsonb; cached jsonb;
begin
 perform public.require_active_actor(p_actor);select * into m from public.matches where id=p_match for update;
 if not found then raise exception 'NOT_FOUND'; end if;
 if m.hidden or not exists(select 1 from public.teams where id=m.team_id and status='approved') then raise exception 'NOT_FOUND'; end if;
 perform public.expire_match_unpaid(p_match);
 cached:=public.begin_command(p_actor,'submit_application',p_request_id,jsonb_build_object('matchId',p_match,'position',p_position));if cached is not null then return cached; end if;
 if m.recruitment_status<>'open' or m.starts_at<=public.server_now() then raise exception 'MATCH_STARTED'; end if;
 if p_position not in ('guard','forward','center') then raise exception 'INVALID_INPUT'; end if;
 if (m.data->'guestSlots'->>p_position)::int=0 then raise exception 'NO_POSITION'; end if;
 select * into a from public.applications where match_id=p_match and applicant_id=p_actor and state in ('pending','awaiting_payment','verifying_payment','confirmed');
 if found then
  if a.position<>p_position then raise exception 'ACTIVE_APPLICATION_EXISTS'; end if;
 else
  insert into public.applications(match_id,applicant_id,position,terms) values(p_match,p_actor,p_position,public.match_terms(m)) returning * into a;
  insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('domain_event','application.submitted',m.id,a.id,p_actor,'{}');
 end if;
 result:=public.application_json(a);perform public.finish_command(p_actor,'submit_application',p_request_id,result);return result;
end $$;
create or replace function public.format_is_acknowledged(p_application uuid,p_match uuid) returns boolean
language sql security definer set search_path='' as $$select exists(select 1 from public.applications a join public.matches m on m.id=a.match_id where a.id=p_application and m.id=p_match and (a.terms->>'formatVersion')::int=m.format_version)$$;
revoke all on function public.format_is_acknowledged(uuid,uuid) from public,anon,authenticated;
grant execute on function public.format_is_acknowledged(uuid,uuid) to service_role;
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
create or replace function public.api_reject_application(p_actor uuid,p_application uuid,p_reason text,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches; a public.applications; v_match uuid; cached jsonb; result jsonb;
begin
 perform public.require_active_actor(p_actor);select match_id into v_match from public.applications where id=p_application;if not found then raise exception 'NOT_FOUND'; end if;
 select * into m from public.matches where id=v_match for update;
 if not public.is_team_manager(p_actor,m.team_id) then raise exception 'FORBIDDEN'; end if;
 select * into a from public.applications where id=p_application for update;
 cached:=public.begin_command(p_actor,'reject_application',p_request_id,jsonb_build_object('applicationId',p_application,'reason',p_reason));if cached is not null then return cached; end if;
 if a.state<>'pending' then raise exception 'INVALID_STATE'; end if;
 if coalesce(char_length(btrim(p_reason)),0) not between 1 and 500 then raise exception 'INVALID_INPUT'; end if;
 update public.applications set state='rejected' where id=a.id returning * into a;
 insert into public.activity_records(scope,kind,match_id,application_id,actor_id,payload) values('domain_event','application.rejected',m.id,a.id,p_actor,jsonb_build_object('reason',p_reason));
 result:=public.application_json(a);perform public.finish_command(p_actor,'reject_application',p_request_id,result);return result;
end $$;
create or replace function public.api_my_applications(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);perform public.api_expire_unpaid();
 return coalesce((select jsonb_agg(public.application_json(a) order by a.submitted_at desc) from public.applications a where applicant_id=p_actor),'[]');
end $$;
create or replace function public.api_team_applications(p_actor uuid,p_match uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches;
begin
 perform public.require_active_actor(p_actor);select * into m from public.matches where id=p_match;if not found then raise exception 'NOT_FOUND'; end if;
 if not public.is_team_manager(p_actor,m.team_id) then raise exception 'FORBIDDEN'; end if;
 perform public.expire_match_unpaid(p_match);
 return coalesce((select jsonb_agg(public.application_json(a) || jsonb_build_object('nickname',p.nickname) order by a.submitted_at) from public.applications a join public.profiles p on p.id=a.applicant_id where a.match_id=p_match),'[]');
end $$;
create or replace function public.api_payment_context(p_actor uuid,p_application uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.applications; m public.matches;
begin
 perform public.require_active_actor(p_actor);select * into a from public.applications where id=p_application;
 if not found then raise exception 'NOT_FOUND'; end if;if a.applicant_id<>p_actor then raise exception 'FORBIDDEN'; end if;
 perform public.expire_match_unpaid(a.match_id);select * into a from public.applications where id=p_application;select * into m from public.matches where id=a.match_id;
 return jsonb_build_object('application',public.application_json(a),'teamId',m.team_id,'recruitmentStatus',m.recruitment_status);
end $$;

-- 신규 RPC는 service_role만 실행합니다. HTTP 본인 확인과 현재 DB 역할을 함께 검사합니다.
revoke all on function public.utc_text(timestamptz),public.application_json(public.applications),public.match_roster(uuid),public.expire_match_unpaid(uuid),public.api_expire_unpaid(),public.match_json(public.matches),public.match_terms(public.matches),public.api_publish_match(uuid,jsonb,text),public.api_get_match(uuid),public.api_list_matches(),public.api_submit_application(uuid,uuid,text,text),public.api_accept_application(uuid,uuid,text),public.api_reject_application(uuid,uuid,text,text),public.api_my_applications(uuid),public.api_team_applications(uuid,uuid),public.api_payment_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.utc_text(timestamptz),public.application_json(public.applications),public.match_roster(uuid),public.expire_match_unpaid(uuid),public.api_expire_unpaid(),public.match_json(public.matches),public.match_terms(public.matches),public.api_publish_match(uuid,jsonb,text),public.api_get_match(uuid),public.api_list_matches(),public.api_submit_application(uuid,uuid,text,text),public.api_accept_application(uuid,uuid,text),public.api_reject_application(uuid,uuid,text,text),public.api_my_applications(uuid),public.api_team_applications(uuid,uuid),public.api_payment_context(uuid,uuid) to service_role;

create or replace function public.api_my_hosting(p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.require_active_actor(p_actor);perform public.api_expire_unpaid();
 return coalesce((select jsonb_agg(public.match_json(m) order by m.starts_at desc) from public.matches m where m.created_by=p_actor or public.is_team_manager(p_actor,m.team_id)),'[]');
end $$;
create or replace function public.api_match_notification_context(p_match uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare m public.matches;
begin
 select * into m from public.matches where id=p_match;if not found then raise exception 'NOT_FOUND'; end if;
 return jsonb_build_object('match',jsonb_build_object('id',m.id,'startsAt',public.utc_text(m.starts_at),'recruitmentStatus',m.recruitment_status),'roster',public.match_roster(m.id),'applications',coalesce((select jsonb_agg(public.application_json(a)) from public.applications a where match_id=p_match),'[]'),'activeCaptainIds',coalesce((select jsonb_agg(tm.user_id) from public.team_memberships tm where tm.team_id=m.team_id and public.is_team_manager(tm.user_id,m.team_id)),'[]'));
end $$;
revoke all on function public.api_my_hosting(uuid),public.api_match_notification_context(uuid) from public,anon,authenticated;
grant execute on function public.api_my_hosting(uuid),public.api_match_notification_context(uuid) to service_role;
