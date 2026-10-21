begin;select plan(3);set local role authenticated;
select throws_ok('insert into public.notifications(recipient_id,logical_key,kind,match_id,text) values(''00000000-0000-4000-a000-000000000001'',''forged'',''payment.confirmed'',''00000000-0000-4000-a000-000000000001'',''확정'')','42501',null,'회원이 결제 확정 알림을 위조하지 못한다');
select throws_ok('update public.notification_jobs set status=''provider_accepted''','42501',null,'발송 결과는 서버만 기록한다');
select throws_ok('select public.api_claim_notifications(''00000000-0000-4000-a000-000000000001'')','42501',null,'claim은 서버 전용');
reset role;select * from finish();rollback;
