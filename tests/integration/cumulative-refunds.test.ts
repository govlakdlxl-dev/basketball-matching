import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {acceptedPayment} from './fixtures/payments';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createPaymentWorker,configuredTestPg} from '../../apps/server/src/features/payments/worker';
import {createFakePgAdapter} from '../../apps/server/src/features/payments/fake-pg';
import {createRefundWorker} from '../../apps/server/src/features/refunds/worker';
import type {TestPgAdapter} from '../../apps/server/src/features/payments/pg-port';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});afterAll(async()=>{await db?.reset();});
async function paid(pg:TestPgAdapter=createFakePgAdapter('success')){const s=await acceptedPayment(db);expect(await createPaymentWorker(createDatabase(db.env),pg).processApproval(s.receipt!.attemptId)).toBe('paid');return {...s,pg};}
async function personal(applicationId:string){await db.setLocalDatabaseTime('2026-10-21T08:00:00Z');const r=await db.request('memberA',`/api/applications/${applicationId}/cancel`,'POST',{cause:'personal',formatChangeId:null,requestId:crypto.randomUUID()});expect(r.status).toBe(200);return r.json();}
const host=(matchId:string)=>db.request('captain',`/api/matches/${matchId}/cancel`,'POST',{requestId:crypto.randomUUID()});
test('개인 50% 완료 뒤 팀 취소는 잔액만 환불하고 중복 접수는 총액을 넘지 않는다',async()=>{
 const base=createFakePgAdapter('success'),amounts:number[]=[],pg={...base,refund:async(i:Parameters<typeof base.refund>[0])=>{amounts.push(i.additionalKrw);return base.refund(i);}},s=await paid(pg),worker=createRefundWorker(createDatabase(db.env),pg);
 await personal(s.a.id);expect((await worker.processNextRefund(s.order!.id)).completed.refundedKrw).toBe(5000);
 await host(s.m.id);await host(s.m.id);expect((await worker.processNextRefund(s.order!.id)).completed.refundedKrw).toBe(10000);expect((await worker.processNextRefund(s.order!.id)).status).toBe('completed');expect(amounts).toEqual([5000,5000]);
 expect((await db.request('memberB',`/api/test-orders/${s.order!.id}/refund`)).status).toBe(403);
});
test('환불 성공 응답 유실은 조회 증거로 한 번만 원장에 반영한다',async()=>{
 const base=createFakePgAdapter('success');let calls=0;const pg={...base,refund:async(i:Parameters<typeof base.refund>[0])=>{calls++;await base.refund(i);return {kind:'unknown' as const,reason:'RESPONSE_LOST'};}};
 const s=await paid(pg),worker=createRefundWorker(createDatabase(db.env),pg);await personal(s.a.id);
 expect((await worker.processNextRefund(s.order!.id)).status).toBe('unknown');expect((await worker.processNextRefund(s.order!.id)).completed.refundedKrw).toBe(5000);expect(calls).toBe(1);
 expect((await db.sql`select count(*)::int n from public.test_ledger_entries where order_id=${s.order!.id} and kind='refund'`)[0]?.n).toBe(1);
});
test('부분 환불 처리 중 전액 상향은 진행 작업 하나를 유지한다',async()=>{
 const base=createFakePgAdapter('success');let resolve!:(value:Awaited<ReturnType<typeof base.refund>>)=>void;let entered!:()=>void;const started=new Promise<void>(r=>{entered=r;});let first=true;const amounts:number[]=[];
 const pg={...base,refund:async(i:Parameters<typeof base.refund>[0])=>{amounts.push(i.additionalKrw);const result=await base.refund(i);if(!first)return result;first=false;entered();return new Promise<Awaited<ReturnType<typeof base.refund>>>(r=>{resolve=r;setTimeout(()=>resolve(result),2000);});}};
 const s=await paid(pg),worker=createRefundWorker(createDatabase(db.env),pg);await personal(s.a.id);const processing=worker.processNextRefund(s.order!.id);await started;await host(s.m.id);
 expect((await db.sql`select count(*)::int n from public.refund_attempts where order_id=${s.order!.id} and status in ('processing','unknown')`)[0]?.n).toBe(1);
 await processing;expect((await worker.processNextRefund(s.order!.id)).completed.refundedKrw).toBe(10000);expect(amounts).toEqual([5000,5000]);
});
test('공지 대상의 개인 일부 환불 뒤 변경 불참은 전액 목표이며 공지 전 취소는 제외한다',async()=>{
 const s=await paid(),worker=createRefundWorker(createDatabase(db.env),s.pg);
 const notice=await (await db.request('captain',`/api/matches/${s.m.id}/format-notices`,'POST',{playersPerTeam:4,reason:'인원에 따른 변경',requestId:crypto.randomUUID()})).json() as {id:string;affectedApplicationIds:string[]};
 expect(notice.affectedApplicationIds).toContain(s.a.id);await personal(s.a.id);await worker.processNextRefund(s.order!.id);
 expect((await db.request('memberA',`/api/applications/${s.a.id}/cancel`,'POST',{cause:'format_change_declined',formatChangeId:notice.id,requestId:crypto.randomUUID()})).status).toBe(200);
 expect((await worker.processNextRefund(s.order!.id)).completed.refundedKrw).toBe(10000);
 const before=await paid();await personal(before.a.id);const excluded=await (await db.request('captain',`/api/matches/${before.m.id}/format-notices`,'POST',{playersPerTeam:4,reason:'변경',requestId:crypto.randomUUID()})).json() as {id:string;affectedApplicationIds:string[]};expect(excluded.affectedApplicationIds).not.toContain(before.a.id);
 expect((await db.request('memberA',`/api/applications/${before.a.id}/cancel`,'POST',{cause:'format_change_declined',formatChangeId:excluded.id,requestId:crypto.randomUUID()})).status).toBe(400);
});
test('환불 의도 기록 실패는 취소·자리 반환·접수 전체를 되돌린다',async()=>{
 const s=await paid();await db.sql.unsafe("create function public.test_refund_failure() returns trigger language plpgsql as $$begin raise exception 'REFUND_INTENT_WRITE_FAILED';end$$;create trigger test_refund_failure before insert on public.refund_intents for each row execute function public.test_refund_failure()");
 try{const r=await db.request('memberA',`/api/applications/${s.a.id}/cancel`,'POST',{cause:'personal',formatChangeId:null,requestId:crypto.randomUUID()});expect(r.status).toBe(503);expect((await db.sql`select state from public.applications where id=${s.a.id}`)[0]?.state).toBe('confirmed');expect((await db.sql`select count(*)::int n from public.cancellation_receipts where application_id=${s.a.id}`)[0]?.n).toBe(0);}finally{await db.sql.unsafe('drop trigger test_refund_failure on public.refund_intents;drop function public.test_refund_failure()');}
});
test('환불 확정 실패는 신청을 취소로 유지하고 탈퇴 전 해결을 요구한다',async()=>{
 const base=createFakePgAdapter('success'),pg={...base,refund:async()=>({kind:'definitive_failure' as const,code:'DECLINED_REFUND'})},s=await paid(pg);await personal(s.a.id);
 expect((await createRefundWorker(createDatabase(db.env),pg).processNextRefund(s.order!.id)).status).toBe('failed');expect((await db.sql`select state from public.applications where id=${s.a.id}`)[0]?.state).toBe('cancelled');
 expect(await (await db.request('memberA','/api/me/deletion','POST',{})).json()).toMatchObject({status:'needs_resolution'});
});
test('Worker 재시작 후 가짜 PG 조회와 미결제 의도는 보존된다',async()=>{
 const database=createDatabase(db.env),env={...db.env,TEST_PG_MODE:'fake',ALLOW_LOCAL_TEST_PG:'true'},s=await paid(configuredTestPg(database,env)!);await personal(s.a.id);
 expect((await createRefundWorker(database,configuredTestPg(database,env)).processNextRefund(s.order!.id)).completed.refundedKrw).toBe(5000);
 const unpaid=await acceptedPayment(db);await personal(unpaid.a.id);let calls=0;const base=createFakePgAdapter('success'),pg={...base,refund:async(i:Parameters<typeof base.refund>[0])=>{calls++;return base.refund(i);}};
 await createRefundWorker(database,pg).processNextRefund(unpaid.order!.id);expect(calls).toBe(0);
 const payment=createPaymentWorker(database,pg);expect(await payment.processApproval(unpaid.receipt!.attemptId)).toBe('paid');expect((await db.sql`select state from public.applications where id=${unpaid.a.id}`)[0]?.state).toBe('cancelled');
 expect((await createRefundWorker(database,pg).processNextRefund(unpaid.order!.id)).completed.refundedKrw).toBe(5000);
});
test('누적 목표와 모순되는 제공자 완료액은 원장을 일부 변경하지 않는다',async()=>{
 const s=await paid();await personal(s.a.id);const request=crypto.randomUUID();
 await db.sql`insert into public.refund_attempts(order_id,request_id,additional_krw,platform_krw,team_krw) values(${s.order!.id},${request},5000,0,5000)`;
 await db.sql`update public.refund_records set target_refunded_krw=0,target_team_krw=0 where order_id=${s.order!.id}`;
 const evidence=await s.pg.lookup({orderId:s.order!.id,paymentKey:s.receipt!.attemptId});if(evidence.kind!=='confirmed')throw new Error('FIXTURE_EVIDENCE');
 const pg={...s.pg,lookup:async()=>({kind:'confirmed' as const,evidence:{...evidence.evidence,refundedKrw:5000,refunds:[{providerRefundId:'unexpected_'+request,requestId:request,amountKrw:5000}]}})};
 expect((await createRefundWorker(createDatabase(db.env),pg).processNextRefund(s.order!.id)).status).toBe('needs_review');
 expect((await db.sql`select count(*)::int n from public.test_ledger_entries where order_id=${s.order!.id} and kind='refund'`)[0]?.n).toBe(0);
});
test('운영자 테스트 원장은 PG 비용 미확인을 보존하고 일반 회원 조회는 거부한다',async()=>{
 const s=await paid();expect((await db.request('memberA','/api/operator/test-ledger')).status).toBe(403);
 const r=await db.request('operator','/api/operator/test-ledger');expect(r.status).toBe(200);const rows=await r.json() as {orderId:string;teamBasisKrw:number;pgCost:{amountKrw:null}}[];
 expect(rows.find(row=>row.orderId===s.order!.id)).toMatchObject({teamBasisKrw:10000,pgCost:{amountKrw:null}});
});
