import {beforeAll,afterAll,test,expect,vi} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {acceptedPayment} from './fixtures/payments';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createNotificationTick} from '../../apps/server/src/jobs/notifications';
import {DisabledAlimtalkAdapter} from '../../apps/server/src/features/notifications/ports/disabled-alimtalk';
import worker from '../../apps/server/src/index';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});afterAll(async()=>{await db?.reset();});
test('결제 설정 단계의 오류가 정기 알림 단계를 막지 않는다',async()=>{
 await worker.scheduled({}, {...db.env,TEST_PG_MODE:'unsupported',TOSS_TEST_SECRET_KEY:'test_invalid'});
 const rows=await db.sql`select stage,status from private.scheduled_job_runs order by started_at desc limit 4`;
 expect(rows).toEqual(expect.arrayContaining([{stage:'payment',status:'failed'},{stage:'refund',status:'failed'},{stage:'notifications',status:'completed'}]));
});
test('동시 정기 작업은 최초 안내를 중복 발송하지 않고 미설정 알림톡을 구분한다',async()=>{
 const s=await acceptedPayment(db,10000,false),send=vi.fn(async()=>({status:'provider_accepted' as const,providerMessageId:'test',reason:null}));
 const tick=createNotificationTick(createDatabase(db.env),{send},new DisabledAlimtalkAdapter());
 const reports=await Promise.all([tick.runNotificationTick('2026-10-20T10:00:00Z',crypto.randomUUID()),tick.runNotificationTick('2026-10-20T10:00:00Z',crypto.randomUUID())]);
 expect(send).toHaveBeenCalledTimes(1); // 이미 수락된 신청의 주장 미처리 안내는 억제됩니다.
 expect(reports.reduce((n,r)=>n+r.setupRequired,0)).toBe(1);
 expect((await db.sql`select count(*)::int n from public.notifications where match_id=${s.m.id} and kind='application.accepted'`)[0]?.n).toBe(1);
});
test('명확한 실패는 재검사 후 재시도하고 취소된 신청의 반복은 멈춘다',async()=>{
 const s=await acceptedPayment(db,10000,false),send=vi.fn().mockResolvedValueOnce({status:'failed',providerMessageId:null,reason:'TEST_RETRY'}).mockResolvedValue({status:'provider_accepted',providerMessageId:'test',reason:null}),tick=createNotificationTick(createDatabase(db.env),{send},new DisabledAlimtalkAdapter());
 await tick.runNotificationTick('2026-10-20T10:00:00Z',crypto.randomUUID());await db.setLocalDatabaseTime('2026-10-20T10:01:00Z');await tick.runNotificationTick('2026-10-20T10:01:00Z',crypto.randomUUID());expect(send.mock.calls.length).toBeGreaterThanOrEqual(2);
 await db.request('memberA',`/api/applications/${s.a.id}/cancel`,'POST',{cause:'personal',requestId:crypto.randomUUID()});await db.setLocalDatabaseTime('2026-10-20T10:05:00Z');await tick.runNotificationTick('2026-10-20T10:05:00Z',crypto.randomUUID());
 expect((await db.sql`select count(*)::int n from public.notification_job_items i join public.notifications n on n.id=i.notification_id where n.application_id=${s.a.id} and i.milestone like 'repeat:%'`)[0]?.n).toBe(0);
});
test('지연 tick은 최신 5분 안내만 보내며 미설정 알림톡을 반복 성공으로 기록하지 않는다',async()=>{
 const s=await acceptedPayment(db,10000,false);const send=vi.fn(async()=>({status:'provider_accepted' as const,providerMessageId:'test',reason:null})),tick=createNotificationTick(createDatabase(db.env),{send},new DisabledAlimtalkAdapter());
 await tick.runNotificationTick('2026-10-20T10:00:00Z',crypto.randomUUID());send.mockClear();await db.setLocalDatabaseTime('2026-10-20T10:16:00Z');
 const report=await tick.runNotificationTick('1999-01-01T00:00:00Z',crypto.randomUUID());expect(report.setupRequired).toBe(0);expect(send).toHaveBeenCalled();
 const items=await db.sql`select i.milestone from public.notification_job_items i join public.notifications n on n.id=i.notification_id where n.match_id=${s.m.id} and i.milestone like 'repeat:%'`;expect(items.every(i=>String(i.milestone).endsWith('10:15:00Z'))).toBe(true);
});
