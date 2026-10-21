begin;
select plan(3);
set local role authenticated;
select throws_ok('select * from public.test_orders','42501',null,'주문과 PG 자료의 직접 조회를 막는다');
select throws_ok('update public.test_orders set status=''paid''','42501',null,'결제 확정을 클라이언트가 바꾸지 못한다');
select throws_ok('select public.api_accept_approval(''00000000-0000-4000-a000-000000000001'',''00000000-0000-4000-a000-000000000001'',''key'',''request'')','42501',null,'내부 승인 접수는 서버만 호출한다');
reset role;
select * from finish();rollback;
