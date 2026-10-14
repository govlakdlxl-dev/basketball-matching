import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import {createDatabase} from '../../apps/server/src/infra/database';
import {createPushEndpoints} from '../../apps/server/src/features/notifications/endpoints';
import {validateWebPushEndpoint} from '../../apps/server/src/features/notifications/push-policy';
import {acceptedPayment} from './fixtures/payments';
import {createNotificationRepository} from '../../apps/server/src/features/notifications/repository';
import {createNotificationDispatcher} from '../../apps/server/src/features/notifications/dispatch';
import {createNotificationSnapshots} from '../../apps/server/src/features/notifications/snapshot';
import {planNotifications} from '@basket/core/notifications/planner';
import type {DeliveryPort} from '@basket/core/notifications/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;});afterAll(async()=>{await db?.reset();});
const native=(deviceId=crypto.randomUUID())=>({channel:'apns',registration:{token:'ab'.repeat(32)},deviceId});
async function register(member:'memberA'|'memberB',input:unknown){const r=await db.request(member,'/api/push-endpoints','POST',input);expect(r.status).toBe(200);return await r.json() as {endpointId:string;ownerVersion:number};}
test('동일 endpoint는 ID를 유지하고 계정 교체 후 이전 해지는 새 소유자를 끄지 않는다',async()=>{
 const input=native(),a=await register('memberA',input),b=await register('memberB',input);expect(b.endpointId).toBe(a.endpointId);expect(b.ownerVersion).toBe(a.ownerVersion+1);expect((await db.request('memberA',`/api/push-endpoints/${a.endpointId}`,'DELETE',{ownerVersion:a.ownerVersion})).status).toBe(403);
 expect((await db.sql`select owner_id,active from public.push_endpoints where id=${b.endpointId}`)[0]).toMatchObject({owner_id:db.memberB.userId,active:true});
});
test('동일 회원 재등록도 과거 소유 버전 해지와 이전 lease를 보호한다',async()=>{
 const input=native(),a=await register('memberA',input);expect((await db.request('memberA',`/api/push-endpoints/${a.endpointId}`,'DELETE',{ownerVersion:a.ownerVersion})).status).toBe(200);const again=await register('memberA',input);expect(again.endpointId).toBe(a.endpointId);expect(again.ownerVersion).toBeGreaterThan(a.ownerVersion);
 expect((await db.request('memberA',`/api/push-endpoints/${a.endpointId}`,'DELETE',{ownerVersion:a.ownerVersion})).status).toBe(409);expect((await db.sql`select active from public.push_endpoints where id=${a.endpointId}`)[0]?.active).toBe(true);
});
test('기기 토큰 교체는 이전 연결을 해지하고 앱이 웹보다 우선한다',async()=>{
 const deviceId=crypto.randomUUID(),a=await register('memberA',{channel:'fcm',registration:{token:'test_fcm_'+crypto.randomUUID()},deviceId}),b=await register('memberA',{channel:'fcm',registration:{token:'test_fcm_'+crypto.randomUUID()},deviceId});expect(b.endpointId).not.toBe(a.endpointId);expect((await db.sql`select active from public.push_endpoints where id=${a.endpointId}`)[0]?.active).toBe(false);
 const key=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),raw=new Uint8Array(await crypto.subtle.exportKey('raw',key.publicKey)),b64=(v:Uint8Array)=>Buffer.from(v).toString('base64url');
 await register('memberA',{channel:'webpush',registration:{endpoint:'https://fcm.googleapis.com/wp/test-token',p256dh:b64(raw),auth:b64(crypto.getRandomValues(new Uint8Array(16)))},deviceId:crypto.randomUUID()});
 const selected=await createPushEndpoints(createDatabase(db.env)).selectPushEndpoint(db.memberA.userId);expect(selected?.channel).toBe('fcm');expect(selected?.endpointId).toBe(b.endpointId);
 const forged=await db.request('memberA','/api/push-endpoints','POST',{...native(),ownerId:db.memberB.userId});expect(forged.status).toBe(400);
});
test.each(['https://127.0.0.1/push','http://fcm.googleapis.com/push','https://user@fcm.googleapis.com/push','https://example.com/push','https://fcm.googleapis.com:444/push','https://[::1]/push','https://fcm.googleapis.com.evil.example/push'])('지원하지 않는 주소를 거부한다 %s',url=>{expect(()=>validateWebPushEndpoint(url,['fcm.googleapis.com'])).toThrow('INVALID_PUSH_ENDPOINT');});
test('등록 응답·선택 조회는 token·구독 비밀을 노출하지 않는다',async()=>{
 const a=await register('memberA',native());expect(Object.keys(a).sort()).toEqual(['endpointId','ownerVersion']);const selected=await createPushEndpoints(createDatabase(db.env)).selectPushEndpoint(db.memberA.userId);expect(JSON.stringify(selected)).not.toContain('token');expect(JSON.stringify(selected)).not.toContain('registration');
});
test('claim 뒤 기기 소유자 변경은 옛 버전의 전송을 억제한다',async()=>{
 const s=await acceptedPayment(db,10000,false),registration=native(),endpoint=await register('memberA',registration),database=createDatabase(db.env),repo=createNotificationRepository(database),snapshot=await createNotificationSnapshots(database).loadNotificationSnapshot(s.m.id),plan=planNotifications(null,snapshot,'2026-10-20T10:05:00Z');await db.setLocalDatabaseTime('2026-10-20T10:05:00Z');await repo.persistNotificationPlan(null,plan);const claims=await repo.claimNotificationJobs(crypto.randomUUID(),'2026-10-20T10:05:00Z');expect(claims[0]?.endpointId).toBe(endpoint.endpointId);await register('memberB',registration);let sends=0;const fake:DeliveryPort={send:async()=>{sends++;return {status:'provider_accepted',providerMessageId:'fake',reason:null};}};expect((await createNotificationDispatcher(database).dispatchNotificationJob(claims[0]!,fake)).status).toBe('suppressed');expect(sends).toBe(0);
});
