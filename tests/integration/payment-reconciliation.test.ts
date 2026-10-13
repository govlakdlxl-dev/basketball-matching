import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createPaymentWorker} from '../../apps/server/src/features/payments/worker';
import {createFakePgAdapter} from '../../apps/server/src/features/payments/fake-pg';
import type {ApplicationRecord,TestOrder,ApprovalReceipt,MatchSummary} from '@basket/core/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});
afterAll(async()=>{await db?.reset();});
async function setup(){
 await db.setLocalDatabaseTime('2026-10-20T10:00:00Z');
 const m=await (await db.request('captain','/api/matches','POST',{teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:'2026-10-20T11:00:00Z',endsAt:'2026-10-20T13:00:00Z',playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:10000,policy:{version:'test-B-v1'},meetingPoint:'입구',rotationDescription:'교대',guestComposition:'개인',captainCoordination:'주장',reservationNote:'테스트',expectedPlayingMinutes:60,requestId:crypto.randomUUID()})).json() as MatchSummary;
 const a=await (await db.request('memberA',`/api/matches/${m.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()});
 const order=await (await db.request('memberA','/api/test-orders','POST',{applicationId:a.id,requestId:crypto.randomUUID()})).json() as TestOrder;
 const receipt=await (await db.request('memberA',`/api/test-orders/${order.id}/approval`,'POST',{paymentKey:'fake_'+crypto.randomUUID(),requestId:crypto.randomUUID()})).json() as ApprovalReceipt;
 return {a,m,order,receipt};
}
async function state(id:string){return (await db.sql`select state from public.applications where id=${id}`)[0]?.state;}
test('응답 유실은 자리 보류, 기한 이후 조회 성공만 참가 확정한다',async()=>{
 const s=await setup(),worker=createPaymentWorker(createDatabase(db.env),createFakePgAdapter('timeout_then_success'));
 expect(await worker.processApproval(s.receipt.attemptId)).toBe('unknown');expect(await state(s.a.id)).toBe('verifying_payment');
 await db.setLocalDatabaseTime('2026-10-20T10:40:00Z');expect(await worker.reconcilePayment(s.order.id)).toBe('paid');expect(await state(s.a.id)).toBe('confirmed');
 expect(await worker.reconcilePayment(s.order.id)).toBe('paid');
 expect((await db.sql`select count(*)::int n from public.activity_records where application_id=${s.a.id} and kind='payment.confirmed'`)[0]?.n).toBe(1);
});
test('명확한 거절은 실패로 처리하고 자리를 반환한다',async()=>{
 const s=await setup(),worker=createPaymentWorker(createDatabase(db.env),createFakePgAdapter('declined'));
 expect(await worker.processApproval(s.receipt.attemptId)).toBe('failed');expect(await state(s.a.id)).toBe('rejected');
 const m=await (await db.request('memberA',`/api/matches/${s.m.id}`)).json() as MatchSummary;expect(m.roster.availableGuests).toBe(1);
});
test('PG의 주문·금액 불일치는 자동 확정하지 않는다',async()=>{
 const s=await setup(),worker=createPaymentWorker(createDatabase(db.env),createFakePgAdapter('mismatch'));
 expect(await worker.processApproval(s.receipt.attemptId)).toBe('needs_review');expect(await state(s.a.id)).toBe('verifying_payment');
});
test('경기 취소 후 늦은 승인은 취소된 신청을 되살리지 않는다',async()=>{
 const s=await setup();await db.request('captain',`/api/matches/${s.m.id}/cancel`,'POST',{requestId:crypto.randomUUID()});
 const worker=createPaymentWorker(createDatabase(db.env),createFakePgAdapter('success'));
 expect(await worker.processApproval(s.receipt.attemptId)).toBe('paid');expect(await state(s.a.id)).toBe('cancelled');
});
test('작업 두 개가 동시에 실행돼도 외부 승인 호출은 한 번이다',async()=>{
 const s=await setup(),base=createFakePgAdapter('success');let count=0;
 const adapter={...base,approve:async(input:Parameters<typeof base.approve>[0])=>{count++;return base.approve(input);}};
 const worker=createPaymentWorker(createDatabase(db.env),adapter);await Promise.all([worker.processApproval(s.receipt.attemptId),worker.processApproval(s.receipt.attemptId)]);
 expect(count).toBe(1);expect(await state(s.a.id)).toBe('confirmed');
});
test('외부 호출 전 Worker가 중단되면 조회 후 같은 멱등 시도를 복구한다',async()=>{
 const s=await setup(),database=createDatabase(db.env);await database.rpc('api_claim_approval',{p_attempt:s.receipt.attemptId,p_provider:'fake',p_lookup:false});
 await db.setLocalDatabaseTime('2026-10-20T10:03:00Z');const base=createFakePgAdapter('success');let approvals=0,lookups=0;
 const pg={...base,approve:async(i:Parameters<typeof base.approve>[0])=>{approvals++;return base.approve(i);},lookup:async(i:Parameters<typeof base.lookup>[0])=>{lookups++;return base.lookup(i);}};
 expect(await createPaymentWorker(database,pg).processApproval(s.receipt.attemptId)).toBe('paid');expect(lookups).toBe(1);expect(approvals).toBe(1);
});
test('서버 보장 기간이 지난 불명확 승인은 새 POST로 재전송하지 않는다',async()=>{
 const s=await setup(),database=createDatabase(db.env);await database.rpc('api_claim_approval',{p_attempt:s.receipt.attemptId,p_provider:'fake',p_lookup:false});
 await db.setLocalDatabaseTime('2026-11-04T10:00:00Z');const base=createFakePgAdapter('success');let approvals=0;
 const pg={...base,approve:async(i:Parameters<typeof base.approve>[0])=>{approvals++;return base.approve(i);}};
 expect(await createPaymentWorker(database,pg).processApproval(s.receipt.attemptId)).toBe('unknown');expect(approvals).toBe(0);
});
