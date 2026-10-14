import {test,expect,vi} from 'vitest';
import {createDevicePushController} from '../../apps/mobile/src/push';
import {createDatabaseFixture} from './fixtures/database';
import {createDatabase} from '../../apps/server/src/infra/database';
import {completeAccountDeletion,runAccountDeletionTick} from '../../apps/server/src/jobs/account-deletion';
test('권한 거부는 등록만 중단하고 앱 조회를 막지 않는다',async()=>{
 const native={kind:'ios' as const,permission:async()=> 'denied',requestPermission:vi.fn(async()=> 'denied'),token:vi.fn(async()=> 'token'),clear:async()=>{},click:async()=>{}},api={current:()=>({userId:'A',token:'A'}),register:vi.fn(),remove:vi.fn()},saved=new Map<string,string>(),storage={getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v);},removeItem:(k:string)=>{saved.delete(k);}};
 const controller=createDevicePushController(native,api,storage);expect(await controller.registerDevicePush()).toEqual({status:'permission_denied'});expect(native.token).not.toHaveBeenCalled();expect(api.register).not.toHaveBeenCalled();
});
test('탈퇴 준비는 기기를 해지하고 Auth 실패는 서버 재처리로 완료한다',async()=>{
 const db=await createDatabaseFixture();try{
  const r=await db.request('memberA','/api/push-endpoints','POST',{channel:'apns',deviceId:crypto.randomUUID(),registration:{token:'ab'.repeat(32)}}),binding=await r.json() as {endpointId:string};expect(r.status).toBe(200);
  const database=createDatabase(db.env),prepared=await database.rpc<{authId:string}>('api_prepare_account_deletion',{p_actor:db.memberA.userId});
  expect((await db.sql`select active from public.push_endpoints where id=${binding.endpointId}`)[0]?.active).toBe(false);
  const failure=vi.spyOn(database.client.auth.admin,'deleteUser').mockRejectedValue(new Error('test offline'));expect(await completeAccountDeletion(database,db.memberA.userId,prepared.authId)).toBe(false);failure.mockRestore();
  expect((await runAccountDeletionTick(database)).completed).toBe(1);expect((await db.sql`select status from private.account_deletion_requests where user_id=${db.memberA.userId}`)[0]?.status).toBe('completed');
 }finally{await db.reset();}
});
test('등록 응답 중 계정이 바뀌면 이전 소유 버전만 해지하고 새 계정 연결을 보존한다',async()=>{
 let current={userId:'A',token:'A'},resolve!:(v:{endpointId:string;ownerVersion:number})=>void;const response=new Promise<{endpointId:string;ownerVersion:number}>(r=>{resolve=r;}),registered=vi.fn(async()=>response),removed=vi.fn(async()=>{}),saved=new Map<string,string>(),storage={getItem:(k:string)=>saved.get(k)??null,setItem:(k:string,v:string)=>{saved.set(k,v);},removeItem:(k:string)=>{saved.delete(k);}},native={kind:'android' as const,permission:async()=> 'granted',requestPermission:async()=> 'granted',token:async()=> 'test-token',clear:async()=>{},click:async()=>{}};
 const controller=createDevicePushController(native,{current:()=>current,register:registered,remove:removed},storage),pending=controller.registerDevicePush();await vi.waitFor(()=>expect(registered).toHaveBeenCalled());current={userId:'B',token:'B'};resolve({endpointId:'same',ownerVersion:1});await expect(pending).rejects.toThrow('SESSION_CHANGED');expect(removed).toHaveBeenCalledWith({endpointId:'same',ownerVersion:1,userId:'A'},'A');expect(JSON.stringify([...saved])).not.toContain('test-token');
});
