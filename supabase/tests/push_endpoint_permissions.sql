begin;select plan(3);set local role authenticated;
select throws_ok('select registration from public.push_endpoints','42501',null,'등록 비밀은 비공개');
select throws_ok('update public.push_endpoints set owner_id=''00000000-0000-4000-a000-000000000001''','42501',null,'소유권을 클라이언트가 직접 바꾸지 못한다');
select throws_ok('select public.api_select_push_endpoint(''00000000-0000-4000-a000-000000000001'')','42501',null,'다른 회원의 전달 경로는 서버 전용');
reset role;select * from finish();rollback;
