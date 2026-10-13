import {test,expect} from 'vitest';
import {validateMapEvent} from '../../apps/web/src/features/map/protocol';
import {createNativePlatform,externalUrl} from '../../apps/mobile/src/bridge';
test('설치 앱 링크를 구독하고 해제하며 OS 종류를 유지한다',async()=>{
 let sink:((url:string)=>void)|null=null,removed=false;const opened:string[]=[];
 const adapter=createNativePlatform({getPlatform:()=> 'ios',open:async url=>{opened.push(url);},subscribe:async listener=>{sink=listener;return()=>{removed=true;};}});
 expect(adapter.kind).toBe('ios');const links:string[]=[];const remove=await adapter.subscribeToLinks(url=>links.push(url));
 (sink! as (url:string)=>void)('basketpilot://auth/callback?code=test-code');expect(links).toEqual(['basketpilot://auth/callback?code=test-code']);remove();expect(removed).toBe(true);
 await adapter.openExternal('https://map.kakao.com/');expect(opened).toEqual(['https://map.kakao.com/']);
});
test('외부 화면에 실행 코드·파일·임의 스킴을 넘기지 않는다',async()=>{
 for(const url of ['javascript:alert(1)','file:///etc/passwd','data:text/html,hello','https://name:secret@example.com/','basketpilot://arbitrary']) expect(()=>externalUrl(url)).toThrow('UNSAFE_EXTERNAL_URL');
 expect(externalUrl('https://map.kakao.com/link/map/test,37,127')).toBe('https://map.kakao.com/link/map/test,37,127');
});
test('설치 앱의 허용 로컬 부모에도 원격 지도 origin·source·nonce 검사가 적용된다',()=>{
 const source={};const context={origin:'https://maps.basket.test',expectedOrigin:'https://maps.basket.test',source,expectedSource:source,nonce:'native-current-nonce'};
 const point={type:'point_selected',nonce:context.nonce,point:{lat:37.5,lng:126.7}};
 expect(validateMapEvent(point,context)).toEqual(point);
 expect(validateMapEvent(point,{...context,origin:'capacitor://localhost'})).toBeNull();
 expect(validateMapEvent({...point,nonce:'previous-nonce'},context)).toBeNull();
 expect(validateMapEvent({...point,point:{lat:91,lng:126}},context)).toBeNull();
});
