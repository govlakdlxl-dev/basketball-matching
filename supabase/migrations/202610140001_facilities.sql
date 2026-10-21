-- 공개 응답에는 증빙·등록자 개인 ID를 포함하지 않습니다.
create or replace function public.facility_json(f public.facilities) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('id',f.id,'name',f.name,'address',f.address,'point',jsonb_build_object('lat',f.latitude,'lng',f.longitude),'region',f.region,'registration',f.registration,'sourceUrl',f.source_url,'locationStatus',f.location_status,'basketballUseStatus',f.basketball_use_status,'verifiedAt',f.verified_at)
$$;
create or replace function public.api_list_facilities() returns jsonb
language sql security definer set search_path='' as $$
 select coalesce(jsonb_agg(public.facility_json(f) order by f.created_at,f.id),'[]'::jsonb) from public.facilities f
$$;
create or replace function public.api_save_facility(p_actor uuid,p_input jsonb,p_request_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cached jsonb; f public.facilities; result jsonb;
begin
 perform public.require_active_actor(p_actor);
 if not (public.is_operator(p_actor) or exists(select 1 from public.team_memberships m where m.user_id=p_actor and public.is_team_manager(p_actor,m.team_id))) then raise exception 'FORBIDDEN'; end if;
 if p_input->>'registration'='operator' and not public.is_operator(p_actor) then raise exception 'FORBIDDEN'; end if;
 if coalesce(char_length(btrim(p_input->>'name')),0) not between 1 and 160 or coalesce(char_length(btrim(p_input->>'address')),0) not between 1 and 300 or coalesce(char_length(btrim(p_input->>'evidence')),0) not between 1 and 2000 then raise exception 'INVALID_INPUT'; end if;
 cached:=public.begin_command(p_actor,'save_facility',p_request_id,p_input);
 if cached is not null then return cached; end if;
 insert into public.facilities(name,address,latitude,longitude,region,registration,registered_by,source_url,evidence)
 values(p_input->>'name',p_input->>'address',(p_input->'point'->>'lat')::double precision,(p_input->'point'->>'lng')::double precision,p_input->>'region',p_input->>'registration',p_actor,nullif(p_input->>'sourceUrl',''),p_input->>'evidence') returning * into f;
 result:=public.facility_json(f);
 insert into public.activity_records(scope,kind,actor_id,payload) values('audit','facility.registered',p_actor,jsonb_build_object('facilityId',f.id));
 perform public.finish_command(p_actor,'save_facility',p_request_id,result); return result;
end $$;
revoke all on function public.facility_json(public.facilities),public.api_list_facilities(),public.api_save_facility(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.facility_json(public.facilities),public.api_list_facilities(),public.api_save_facility(uuid,jsonb,text) to service_role;

insert into public.facilities(id,name,address,latitude,longitude,region,registration,registered_by,source_url,evidence,location_status,basketball_use_status,verified_at) values
 ('b0000000-0000-4000-a000-000000000001','서울교육문화센터 실내체육관(농구장)','서울특별시 성동구 천호대로78길 15-48(용답동)',37.56179,127.05666,'seoul','operator',null,'https://yeyak.seoul.go.kr/web/reservation/selectReservView.do?rsv_svc_id=S250116161456124384','공식 예약 페이지의 이름·주소·실내 농구 사용·지도 좌표 확인. 예약 가능·팀 대관·실제 모집은 미확인. 상세 출처 data/verified-facilities.json.','verified','verified','2026-10-14T00:00:00Z'),
 ('b0000000-0000-4000-a000-000000000002','인천삼산월드체육관 보조경기장','인천광역시 부평구 체육관로 60',37.50765921247,126.73734851146,'incheon','operator',null,'https://www.insiseol.or.kr/sport/samsan/facility/auxiliary.jsp','인천시설공단 보조경기장·시설현황·오시는 길에서 실내 농구·이름·주소·건물 좌표 확인. 예약 가능·팀 대관·실제 모집은 미확인. 상세 출처 data/verified-facilities.json.','verified','verified','2026-10-14T00:00:00Z')
 on conflict(id) do nothing;
