begin;select plan(2);set local role authenticated;
select throws_ok('select public.api_claim_approval(''00000000-0000-4000-a000-000000000001'',''fake'',false)','42501',null,'PG 작업 확보는 서버 전용');
select throws_ok('select public.api_apply_payment_result(''00000000-0000-4000-a000-000000000001'',''00000000-0000-4000-a000-000000000001'',''{}'')','42501',null,'클라이언트 성공 응답으로 참가 확정 불가');
reset role;select * from finish();rollback;
