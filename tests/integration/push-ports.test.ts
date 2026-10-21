import {test,expect,vi} from 'vitest';
import {ApnsPushPort} from '../../apps/server/src/features/notifications/ports/apns';
import {FcmPushPort} from '../../apps/server/src/features/notifications/ports/fcm';
import {WebPushPort} from '../../apps/server/src/features/notifications/ports/webpush';
import {validatePushRegistration} from '../../apps/server/src/features/notifications/push-policy';
import type {EndpointAccess,PrivatePushEndpoint} from '../../apps/server/src/features/notifications/endpoints';
import type {DeliveryEnvelope} from '@basket/core/notifications/contracts';
const e:DeliveryEnvelope={jobId:'c0000000-0000-4000-a000-000000000001',recipientId:'user',transport:'push',endpointId:'endpoint',noticeIds:['d0000000-0000-4000-a000-000000000001'],matchId:'match',applicationId:null,title:'연락처·위치를 싣지 말 것',body:'비공개 상세',expiresAt:null};
const access=(binding:PrivatePushEndpoint):EndpointAccess=>({load:async()=>binding,refresh:async(envelope)=>envelope,expire:vi.fn(async()=>{})});
async function rsa(){const key=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']),raw=await crypto.subtle.exportKey('pkcs8',key.privateKey);return {project_id:'test-project',client_email:'test@test-project.iam.gserviceaccount.com',private_key:'-----BEGIN PRIVATE KEY-----\n'+Buffer.from(raw).toString('base64')+'\n-----END PRIVATE KEY-----'};}
test('자격 없음과 미검증 APNs HTTP/2 transport는 발송 성공을 만들지 않는다',async()=>{
 const a=access({id:'endpoint',channel:'apns',registration:{token:'ab'.repeat(32)},ownerVersion:1}),fetcher=vi.fn();
 expect((await new ApnsPushPort(null,a).send(e)).status).toBe('setup_required');expect((await new FcmPushPort(null,a,fetcher).send(e)).status).toBe('setup_required');expect((await new WebPushPort(null,a,fetcher).send(e)).status).toBe('setup_required');expect(fetcher).not.toHaveBeenCalled();
});
test('APNs 토큰의 길이를 고정하지 않고 짝수 hex 형식을 확인한다',async()=>{expect(await validatePushRegistration('apns',{token:'ab'.repeat(64)})).toEqual({token:'ab'.repeat(64)});await expect(validatePushRegistration('apns',{token:'abc'})).rejects.toThrow();});
test('FCM은 OAuth 토큰 교환 뒤 문자열 data와 명시 TTL을 전송한다',async()=>{
 const calls:{url:string;init:RequestInit|undefined}[]=[],fetcher=vi.fn(async(url:string|URL|Request,init?:RequestInit)=>{calls.push({url:String(url),init});return calls.length===1?Response.json({access_token:'test_access',expires_in:3600}):Response.json({name:'projects/test-project/messages/test-1'});}),a=access({id:'endpoint',channel:'fcm',registration:{token:'test_fcm_token'},ownerVersion:1});
 const r=await new FcmPushPort(await rsa(),a,fetcher).send({...e,expiresAt:new Date(Date.now()+5000).toISOString()});expect(r.status).toBe('provider_accepted');expect(calls[0]?.url).toBe('https://oauth2.googleapis.com/token');expect(String(calls[0]?.init?.body)).toContain('grant_type=');
 const payload=JSON.parse(String(calls[1]?.init?.body));expect(payload.message.notification).toEqual({title:'농구 매칭',body:'새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.'});expect(payload.message.data.noticeIds).toBe(JSON.stringify(e.noticeIds));expect(payload.message.data.applicationId).toBeUndefined();expect(payload.message.android.ttl).toMatch(/^\d+s$/);expect(JSON.stringify(payload)).not.toContain('비공개 상세');
});
test('OAuth 응답을 기다리는 동안 상태가 바뀌면 FCM 전송을 하지 않는다',async()=>{
 const a=access({id:'endpoint',channel:'fcm',registration:{token:'test_fcm_token'},ownerVersion:1});a.refresh=async()=>null;const fetcher=vi.fn(async()=>Response.json({access_token:'test_access',expires_in:3600}));expect((await new FcmPushPort(await rsa(),a,fetcher).send(e)).status).toBe('suppressed');expect(fetcher).toHaveBeenCalledTimes(1);
});
test('Web Push는 암호문·redirect 차단·TTL 0을 보존하고 410은 현재 버전만 해지한다',async()=>{
 const curve=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),raw=new Uint8Array(await crypto.subtle.exportKey('raw',curve.publicKey)),b64=(b:ArrayBuffer|Uint8Array)=>Buffer.from(b instanceof Uint8Array?b:new Uint8Array(b)).toString('base64url');
 const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',vapid.privateKey),publicKey=b64(await crypto.subtle.exportKey('raw',vapid.publicKey));
 const a=access({id:'endpoint',channel:'webpush',registration:{endpoint:'https://fcm.googleapis.com/wp/test-token',p256dh:b64(raw),auth:b64(crypto.getRandomValues(new Uint8Array(16)))},ownerVersion:7}),fetcher=vi.fn(async(_url:string|URL|Request,_init?:RequestInit)=>new Response(null,{status:410}));
 const r=await new WebPushPort({subject:'mailto:test@example.invalid',publicKey,privateKey:jwk.d!},a,fetcher).send({...e,expiresAt:new Date(Date.now()+900).toISOString()});expect(r.status).toBe('failed');expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'error',headers:expect.objectContaining({ttl:'0','content-encoding':'aes128gcm'})});expect(a.expire).toHaveBeenCalledWith('endpoint',7);expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(Uint8Array);
});
