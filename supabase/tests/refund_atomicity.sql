begin;select plan(3);set local role authenticated;
select throws_ok('select * from public.refund_intents','42501',null,'취소 의도 원장은 비공개');
select throws_ok('update public.refund_records set refunded_krw=10000','42501',null,'환불 완료액 직접 변경 금지');
select throws_ok('select public.enqueue_refund_intent(''00000000-0000-4000-a000-000000000001'')','42501',null,'환불 의도는 서버 트랜잭션에서만 기록');
reset role;select * from finish();rollback;
