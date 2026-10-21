begin;
select plan(4);
set local role authenticated;
select throws_ok('select public.api_accept_application(''00000000-0000-4000-a000-000000000001'',''00000000-0000-4000-a000-000000000001'',''forged'')','42501',null,'클라이언트는 내부 수락 RPC를 직접 실행할 수 없다');
select throws_ok('update public.applications set state=''confirmed''','42501',null,'클라이언트가 참가 확정을 직접 변경할 수 없다');
select throws_ok('update public.matches set data=''{}''','42501',null,'클라이언트가 모집 조건을 직접 덮어쓸 수 없다');
select throws_ok('select public.api_match_notification_context(''00000000-0000-4000-a000-000000000001'')','42501',null,'다른 회원의 내부 알림 맥락은 공개하지 않는다');
reset role;
select * from finish();rollback;
