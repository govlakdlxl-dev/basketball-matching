import {test,expect,vi} from 'vitest';
import {parseAppLink,createAuthTransaction} from '../../apps/mobile/src/links';
import {createNativeSessionStorage} from '../../apps/mobile/src/auth-storage';
test('알려진 앱 경로·UUID만 받고 위조 성공 플래그와 외부 주소를 거부한다',()=>{
 expect(parseAppLink('evil://payment/return?paid=true')).toBeNull();expect(parseAppLink('basketpilot://payment/return?orderId=c0000000-0000-4000-a000-000000000001')?.kind).toBe('payment');
 expect(parseAppLink('basketpilot://payment/return?orderId=bad&paid=true')).toBeNull();expect(parseAppLink('https://evil.invalid/auth/callback?code=secret&state=abc')).toBeNull();
 expect(parseAppLink('basketpilot://auth/callback?code=one&code=two&state=abc')).toBeNull();
});
test('로그인 시작 기록·만료·한 번 사용을 검사하고 콜백을 재사용하지 않는다',async()=>{
 const values=new Map<string,string>(),storage={getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}},txn=createAuthTransaction(storage);
 await expect(txn.consume({kind:'auth',code:'fake',state:'none'},1000)).rejects.toThrow('AUTH_TRANSACTION_INVALID');
 const nonce=await txn.start(1000);await expect(txn.consume({kind:'auth',code:'fake',state:'wrong'},1001)).rejects.toThrow();expect(await txn.consume({kind:'auth',code:'valid',state:nonce},1002)).toBe('valid');await expect(txn.consume({kind:'auth',code:'valid',state:nonce},1003)).rejects.toThrow();
 const expired=await txn.start(1000);await expect(txn.consume({kind:'auth',code:'old',state:expired},601000)).rejects.toThrow();
});
test('네이티브 보관소 실패는 웹 저장소로 전환되지 않는다',async()=>{
 const vault={getItem:vi.fn(async()=>{throw new Error('SECURE_BRIDGE_UNAVAILABLE');}),setItem:vi.fn(async()=>{}),removeItem:vi.fn(async()=>{})},storage=createNativeSessionStorage(vault);
 await expect(storage.getItem('sb-session')).rejects.toThrow('SECURE_BRIDGE_UNAVAILABLE');await storage.setItem('sb-verifier','secret');expect(vault.setItem).toHaveBeenCalledWith({key:'sb-verifier',value:'secret'});
});
