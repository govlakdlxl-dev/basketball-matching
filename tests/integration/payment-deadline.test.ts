import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import type {ApplicationRecord,MatchSummary,TestOrder,ApprovalReceipt} from '@basket/core/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});
afterAll(async()=>{await db?.reset();});
async function accepted(fee=10000){
 await db.setLocalDatabaseTime('2026-10-20T10:00:00Z');
 const match=await (await db.request('captain','/api/matches','POST',{teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:'2026-10-20T11:00:00Z',endsAt:'2026-10-20T13:00:00Z',playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:fee,policy:{version:'test-B-v1'},meetingPoint:'입구',rotationDescription:'교대',guestComposition:'개인 참여',captainCoordination:'주장 조율',reservationNote:'로컬 테스트',expectedPlayingMinutes:60,requestId:crypto.randomUUID()})).json() as MatchSummary;
 const app=await (await db.request('memberA',`/api/matches/${match.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 return await (await db.request('captain',`/api/applications/${app.id}/accept`,'POST',{requestId:crypto.randomUUID()})).json() as ApplicationRecord;
}
const create=(applicationId:string,requestId:string=crypto.randomUUID(),extra={})=>db.request('memberA','/api/test-orders','POST',{applicationId,requestId,...extra});
const approve=(orderId:string,requestId:string=crypto.randomUUID(),paymentKey='test_payment_key_123')=>db.request('memberA',`/api/test-orders/${orderId}/approval`,'POST',{requestId,paymentKey});
test('서버 보존 금액만 사용하고 같은 신청의 주문은 하나다',async()=>{
 const a=await accepted();const r=await create(a.id,'same-order');expect(r.status).toBe(200);const order=await r.json() as TestOrder;
 expect(order.terms.pricing.platformRateBps).toBe(0);expect(order.terms.pricing.paymentAmountKrw).toBe(10000);expect(order.status).toBe('created');
 const again=await (await create(a.id)).json() as TestOrder;expect(again.id).toBe(order.id);
 expect((await db.sql`select count(*)::int n from public.test_orders where application_id=${a.id}`)[0]?.n).toBe(1);
 expect((await create(a.id,crypto.randomUUID(),{amount:1,status:'paid'})).status).toBe(400);
 expect((await db.request('memberB','/api/test-orders','POST',{applicationId:a.id,requestId:crypto.randomUUID()})).status).toBe(403);
 expect((await db.request('memberB',`/api/test-orders/${order.id}`)).status).toBe(403);
});
test('무료 경기·계산 전용 가격·동일 멱등 키의 다른 입력은 거부한다',async()=>{
 const free=await accepted(0);expect((await create(free.id)).status).toBe(409);
 const first=await accepted();expect((await create(first.id,'conflicting-input')).status).toBe(200);
 const second=await accepted();expect((await create(second.id,'conflicting-input')).status).toBe(409);
 await db.sql`update public.applications set terms=jsonb_set(terms,'{pricing,purpose}','"calculator_only"') where id=${second.id}`;
 expect((await create(second.id)).status).toBe(409);
});
test('기한 1ms 전에 접수한 승인만 자리를 보류하고 재시도는 최초 접수를 유지한다',async()=>{
 const a=await accepted(),order=await (await create(a.id)).json() as TestOrder;
 await db.setLocalDatabaseTime('2026-10-20T10:29:59.999Z');
 const response=await approve(order.id,'same-approval');expect(response.status).toBe(200);const receipt=await response.json() as ApprovalReceipt;
 expect(receipt.receivedAt).toBe('2026-10-20T10:29:59.999Z');
 await db.setLocalDatabaseTime('2026-10-20T10:31:00Z');expect(await (await approve(order.id,'same-approval')).json()).toEqual(receipt);
 expect((await approve(order.id,'same-approval','different_payment_key')).status).toBe(409);
 const current=await (await db.request('memberA',`/api/matches/${a.matchId}`)).json() as MatchSummary;
 expect(current.roster.verifyingPayment).toBe(1);expect(current.roster.availableGuests).toBe(0);
 expect((await db.sql`select count(*)::int n from public.approval_attempts where order_id=${order.id}`)[0]?.n).toBe(1);
});
test.each(['2026-10-20T10:30:00.000Z','2026-10-20T10:30:00.001Z'])('서버 기한과 같거나 늦으면 거부한다 %s',async time=>{
 const a=await accepted(),order=await (await create(a.id)).json() as TestOrder;await db.setLocalDatabaseTime(time);
 const r=await approve(order.id);expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'PAYMENT_DEADLINE_EXPIRED'});
 const match=await (await db.request('memberA',`/api/matches/${a.matchId}`)).json() as MatchSummary;expect(match.roster.availableGuests).toBe(1);
});
test('기기 시각·금액 위조로 접수 시각과 주문 가격을 바꿀 수 없다',async()=>{
 const a=await accepted(),order=await (await create(a.id)).json() as TestOrder;
 expect((await db.request('memberA',`/api/test-orders/${order.id}/approval`,'POST',{paymentKey:'test_payment_key_123',requestId:crypto.randomUUID(),receivedAt:'2020-01-01T00:00:00Z',amount:1})).status).toBe(400);
 expect((await db.request('memberB',`/api/test-orders/${order.id}/approval`,'POST',{paymentKey:'test_payment_key_123',requestId:crypto.randomUUID()})).status).toBe(403);
});
