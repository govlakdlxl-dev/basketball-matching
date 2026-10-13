import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {acceptedPayment} from './fixtures/payments';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createNotificationSnapshots} from '../../apps/server/src/features/notifications/snapshot';
import {createNotificationRepository} from '../../apps/server/src/features/notifications/repository';
import {createNotificationDispatcher} from '../../apps/server/src/features/notifications/dispatch';
import {planNotifications} from '@basket/core/notifications/planner';
import {createPaymentWorker} from '../../apps/server/src/features/payments/worker';
import {createFakePgAdapter} from '../../apps/server/src/features/payments/fake-pg';
import type {DomainEvent} from '@basket/core/contracts';
import type {DeliveryPort,InboxNotice} from '@basket/core/notifications/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});afterAll(async()=>{await db?.reset();});
async function domain(matchId:string,kind:string,appId?:string):Promise<DomainEvent>{const rows=await db.sql`select id,kind,match_id,application_id,occurred_at,payload from public.activity_records where scope='domain_event' and match_id=${matchId} and kind=${kind} order by occurred_at desc`;const row=rows.find(r=>!appId||r.application_id===appId);if(!row)throw new Error('EVENT_FIXTURE');return {id:row.id as string,kind:row.kind as DomainEvent['kind'],matchId:row.match_id as string,applicationId:row.application_id as string|null,occurredAt:new Date(row.occurred_at as string).toISOString(),payload:row.payload as Record<string,unknown>};}
async function planned(){const s=await acceptedPayment(db,10000,false),database=createDatabase(db.env),e=await domain(s.m.id,'application.accepted',s.a.id),snapshot=await createNotificationSnapshots(database).loadNotificationSnapshot(s.m.id),plan=planNotifications(e,snapshot,'2026-10-20T10:00:00Z');plan.deliveries=plan.deliveries.filter(d=>d.transport==='push');return {...s,database,e,plan,repo:createNotificationRepository(database)};}
const port=()=>({send:vi.fn(async()=>({status:'provider_accepted' as const,providerMessageId:'test-message',reason:null}))});
test('같은 이벤트·milestone의 알림함과 전송 항목은 하나이며 동시 claim도 한 번이다',async()=>{
 const s=await planned();await s.repo.persistNotificationPlan(s.e.id,s.plan);await s.repo.persistNotificationPlan(s.e.id,s.plan);
 expect((await db.sql`select count(*)::int n from public.notifications where match_id=${s.m.id}`)[0]?.n).toBe(1);expect((await db.sql`select count(*)::int n from public.notification_job_items where notification_id in (select id from public.notifications where match_id=${s.m.id})`)[0]?.n).toBe(1);
 const claims=(await Promise.all([s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:00:00Z'),s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:00:00Z')])).flat();expect(claims).toHaveLength(1);
 const fake=port();expect((await createNotificationDispatcher(s.database).dispatchNotificationJob(claims[0]!,fake)).status).toBe('provider_accepted');
 const inbox=await (await db.request('memberA','/api/notifications/inbox')).json() as InboxNotice[];const own=inbox.find(n=>n.matchId===s.m.id)!;expect(own.readAt).toBeNull();expect((await db.request('memberB',`/api/notifications/${own.id}`)).status).toBe(403);expect((await db.request('memberB',`/api/notifications/${own.id}/read`,'POST',{})).status).toBe(403);expect((await db.request('memberA',`/api/notifications/${own.id}/read`,'POST',{})).status).toBe(200);
});
test('claim 이후 결제가 완료되면 전송을 억제한다',async()=>{
 const s=await planned();await s.repo.persistNotificationPlan(s.e.id,s.plan);const claims=await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:00:00Z');
 const receipt=await (await db.request('memberA',`/api/test-orders/${s.order!.id}/approval`,'POST',{paymentKey:'fake_'+crypto.randomUUID(),requestId:crypto.randomUUID()})).json() as {attemptId:string};await createPaymentWorker(s.database,createFakePgAdapter('success')).processApproval(receipt.attemptId);
 const fake=port();expect((await createNotificationDispatcher(s.database).dispatchNotificationJob(claims[0]!,fake)).status).toBe('suppressed');expect(fake.send).not.toHaveBeenCalled();
});
test('claim 뒤 담당자 권한 회수는 전송하지 않고 pending·shortage는 한 작업으로 묶는다',async()=>{
 const s=await acceptedPayment(db,10000,false);const a=await (await db.request('memberB',`/api/matches/${s.m.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as {id:string};await db.setLocalDatabaseTime('2026-10-21T10:31:00Z');
 const database=createDatabase(db.env),repo=createNotificationRepository(database),snapshot=await createNotificationSnapshots(database).loadNotificationSnapshot(s.m.id),plan=planNotifications(null,snapshot,'2026-10-21T10:31:00Z');await repo.persistNotificationPlan(null,plan);
 expect(plan.notices.filter(n=>n.recipientId===db.captain.userId).map(n=>n.kind).sort()).toEqual(['captain.pending','captain.shortage']);
 const claims=await repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-21T10:31:00Z');expect(claims).toHaveLength(1);await db.sql`update public.team_memberships set active=false where user_id=${db.captain.userId} and team_id=${db.teamId}`;
 const fake=port();expect((await createNotificationDispatcher(database).dispatchNotificationJob(claims[0]!,fake)).status).toBe('suppressed');expect(fake.send).not.toHaveBeenCalled();await db.sql`update public.team_memberships set active=true where user_id=${db.captain.userId} and team_id=${db.teamId}`;
});
test('불명확한 전송과 sending 중단은 같은 milestone을 자동 재전송하지 않는다',async()=>{
 const s=await planned();await s.repo.persistNotificationPlan(s.e.id,s.plan);const claim=(await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:00:00Z'))[0]!;
 const fake:DeliveryPort={send:async()=>({status:'unknown',providerMessageId:null,reason:'LOST_RESPONSE'})};expect((await createNotificationDispatcher(s.database).dispatchNotificationJob(claim,fake)).status).toBe('unknown');await db.setLocalDatabaseTime('2026-10-20T10:02:00Z');expect(await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:02:00Z')).toHaveLength(0);
});
test('지난 반복은 보내지 않고 재처리로 알림 읽음과 anchor를 덮어쓰지 않는다',async()=>{
 const s=await planned();await s.repo.persistNotificationPlan(s.e.id,s.plan);const notice=(await db.sql`select id from public.notifications where match_id=${s.m.id}`)[0]!;await db.request('memberA',`/api/notifications/${notice.id}/read`,'POST',{});const readAt=(await db.sql`select read_at from public.notifications where id=${notice.id}`)[0]!.read_at;const original=await createNotificationSnapshots(s.database).loadNotificationSnapshot(s.m.id);await db.setLocalDatabaseTime('2026-10-20T10:05:00Z');const repeat=planNotifications(null,original,'2026-10-20T10:05:00Z');await s.repo.persistNotificationPlan(null,repeat);expect((await db.sql`select read_at from public.notifications where id=${notice.id}`)[0]!.read_at).toEqual(readAt);
 await db.setLocalDatabaseTime('2026-10-20T10:16:00Z');const claim=(await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:16:00Z'))[0]!;const fake=port();await createNotificationDispatcher(s.database).dispatchNotificationJob(claim,fake);
 expect((await db.sql`select count(*)::int n from public.notification_job_items i join public.notifications n on n.id=i.notification_id where n.match_id=${s.m.id} and i.milestone like 'repeat:%' and i.status='suppressed'`)[0]?.n).toBe(1);
 const after=await createNotificationSnapshots(s.database).loadNotificationSnapshot(s.m.id);expect(after.windows[0]?.anchorAt).toBe(original.windows[0]?.anchorAt);
});
test('전송 시작 기록 뒤 Worker가 중단되면 lease가 끝나도 재전송하지 않는다',async()=>{
 const s=await planned();await s.repo.persistNotificationPlan(s.e.id,s.plan);const claim=(await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:00:00Z'))[0]!;expect(await s.repo.beginSend(claim)).not.toBeNull();await db.setLocalDatabaseTime('2026-10-20T10:01:01Z');expect(await s.repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:01:01Z')).toHaveLength(0);expect((await db.sql`select status from public.notification_jobs where id=${claim.jobId}`)[0]?.status).toBe('unknown');
});
