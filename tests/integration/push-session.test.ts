import {test,expect,vi} from 'vitest';
import {createPushLifecycle,noticeTarget} from '../../apps/mobile/src/push-lifecycle';
test('로그아웃은 원래 회원으로 해지하고 실패한 버전만 대기한다',async()=>{
 const saved:Record<string,string>={},storage={getItem:(k:string)=>saved[k]??null,setItem:(k:string,v:string)=>{saved[k]=v;},removeItem:(k:string)=>{delete saved[k];}},remove=vi.fn(async()=>{throw new Error('offline');}),clear=vi.fn(async()=>{});
 const life=createPushLifecycle(storage,remove,clear);life.bind({endpointId:'a',ownerVersion:1,userId:'A'});await life.leave({userId:'A',token:'temporary-secret'});
 expect(remove).toHaveBeenCalledWith({endpointId:'a',ownerVersion:1,userId:'A'},'temporary-secret');expect(clear).toHaveBeenCalled();expect(JSON.stringify(saved)).not.toContain('temporary-secret');
 life.bind({endpointId:'a',ownerVersion:2,userId:'B'});await life.retry({userId:'B',token:'B'});expect(remove).toHaveBeenCalledTimes(1);expect(life.binding()?.userId).toBe('B');
 await life.leave({userId:'A',token:'old'});expect(clear).toHaveBeenCalledTimes(1);expect(life.binding()?.userId).toBe('B');
});
test('푸시 클릭은 UUID 안내만 받아 현재 로그인으로 조회하는 내부 경로를 만든다',()=>{
 expect(noticeTarget({noticeIds:['c0000000-0000-4000-a000-000000000001'],url:'https://evil.invalid'})).toBe('/notifications/c0000000-0000-4000-a000-000000000001');
 expect(noticeTarget({noticeIds:['<script>'],matchId:'invalid'})).toBe('/notifications');
});
