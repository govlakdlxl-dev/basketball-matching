import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {acceptedPayment} from './fixtures/payments';
import worker from '../../apps/server/src/index';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();db.env.TEST_PG_MODE='fake';db.env.ALLOW_LOCAL_TEST_PG='true';await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});afterAll(async()=>{await db?.reset();});
async function checkout(){const s=await acceptedPayment(db);await db.sql`delete from public.approval_attempts where order_id=${s.order!.id}`;await db.sql`update public.applications set state='awaiting_payment' where id=${s.a.id}`;await db.sql`update public.test_orders set status='created' where id=${s.order!.id}`;const r=await db.request('memberA',`/api/test-orders/${s.order!.id}/checkout`,'POST',{requestId:crypto.randomUUID()});expect(r.status).toBe(200);return {...s,checkout:await r.json() as {returnToken:string;nonce:string;orderId:string;amountKrw:number;provider:string}};}
function publicReturn(body:unknown){return worker.fetch(new Request('https://basket.test/api/payments/return',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),db.env);}
test('복귀는 로그인 세션 없이 주문에 한정된 토큰으로 승인 접수하고 같은 결과를 재사용한다',async()=>{
 const s=await checkout();expect(s.checkout.provider).toBe('fake');expect(s.checkout.amountKrw).toBe(10000);
 const body={token:s.checkout.returnToken,orderId:s.order!.id,paymentKey:'fake_return_'+crypto.randomUUID(),amount:10000};const r=await publicReturn(body);expect(r.status).toBe(200);const result=await r.json();expect(await (await publicReturn(body)).json()).toEqual(result);
 expect((await db.sql`select count(*)::int n from public.approval_attempts where order_id=${s.order!.id}`)[0]?.n).toBe(1);
 expect((await publicReturn({...body,paymentKey:'different_payment_key'})).status).toBe(409);
});
test('위조 주문·금액·토큰과 기한 만료 복귀는 거부한다',async()=>{
 const s=await checkout(),body={token:s.checkout.returnToken,orderId:s.order!.id,paymentKey:'fake_return_'+crypto.randomUUID(),amount:10000};
 expect((await publicReturn({...body,orderId:crypto.randomUUID()})).status).toBe(400);expect((await publicReturn({...body,amount:1})).status).toBe(400);expect((await publicReturn({...body,token:'unknown_token_123'})).status).toBe(404);
 await db.setLocalDatabaseTime('2026-10-20T10:30:00Z');expect((await publicReturn(body)).status).toBe(409);
});
