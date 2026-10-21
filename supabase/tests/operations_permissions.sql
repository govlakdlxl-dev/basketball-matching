begin;
select plan(4);
set local role authenticated;
select throws_ok('select * from public.cancellation_receipts','42501',null,'다른 회원의 취소 기록은 직접 조회하지 못한다');
select throws_ok('insert into public.format_acknowledgements(notice_id,application_id) values(null,null)','42501',null,'변경 확인을 직접 위조하지 못한다');
select throws_ok('select public.api_operator_dashboard(''00000000-0000-4000-a000-000000000001'')','42501',null,'운영 자료는 클라이언트 RPC에서 직접 읽지 못한다');
select throws_ok('select * from private.account_deletion_requests','42501',null,'탈퇴 처리 중 개인정보는 서버만 접근한다');
reset role;
select * from finish();rollback;
