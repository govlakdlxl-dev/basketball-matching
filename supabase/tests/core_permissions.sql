begin;
select plan(13);

insert into auth.users(id) values
 ('00000000-0000-4000-a000-000000000001'),
 ('00000000-0000-4000-a000-000000000002');

set local role anon;
select throws_ok('select preferences from public.profiles', '42501', null, '비회원은 개인 조건을 읽지 못한다');
reset role;

select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',true);
set local role authenticated;
select lives_ok('select preferences from public.profiles', '회원의 조건 조회가 가능하다');
select is((select count(*)::int from public.profiles), 1, '본인 프로필만 조회된다');
select is((select count(*)::int from public.profiles where id='00000000-0000-4000-a000-000000000002'), 0, '다른 회원 프로필은 보이지 않는다');
select throws_ok('update public.profiles set role=''operator''', '42703', null, '프로필 role 입력으로 승격할 수 없다');
select throws_ok('delete from public.profiles', '42501', null, '직접 삭제로 처리 기록을 끊지 못한다');
select throws_ok('update public.team_memberships set role=''captain''', '42501', null, '직접 담당자 역할을 변경하지 못한다');
select throws_ok('select * from private.operator_users', '42501', null, '운영자 권한 자료는 비공개다');
select throws_ok('select public.api_get_preferences(''00000000-0000-4000-a000-000000000002'')', '42501', null, '다른 actor를 넣은 내부 RPC는 직접 실행 불가다');
select ok(not public.valid_preferences('{"origin":{"lat":37,"lng":126},"mode":null,"maxMinutes":30,"dateFrom":"2026-10-13","dateTo":"2026-10-20","weekdays":[1],"earliestStartMinute":1080,"latestStartMinute":1380,"latestEndMinute":null,"position":null}'), 'NULL 이동수단은 조건으로 저장하지 않는다');
select ok(not public.valid_preferences('{"origin":{"lng":126},"mode":"subway","maxMinutes":30,"dateFrom":"2026-10-13","dateTo":"2026-10-20","weekdays":[1],"earliestStartMinute":1080,"latestStartMinute":1380,"latestEndMinute":null,"position":null}'), '위도가 없는 좌표는 저장하지 않는다');
select ok(not public.valid_preferences('{"origin":{"lat":37,"lng":126},"mode":"subway","maxMinutes":30,"dateFrom":null,"dateTo":"2026-10-20","weekdays":[1],"earliestStartMinute":1080,"latestStartMinute":1380,"latestEndMinute":null,"position":null}'), 'NULL 날짜는 저장하지 않는다');
reset role;
select is((select count(*)::int from public.profiles where id in ('00000000-0000-4000-a000-000000000001','00000000-0000-4000-a000-000000000002')), 2, '검증 회원마다 공유 DB 프로필이 생성된다');

select * from finish();
rollback;
