import {test,expect} from 'vitest';
import worker from '../../apps/server/src/index';
import {readBody} from '../../apps/server/src/http/router';
test('설치 앱의 허용 origin만 CORS preflight에 응답한다',async()=>{
 const env={ALLOWED_ORIGINS:'capacitor://localhost,http://localhost'};
 const valid=await worker.fetch(new Request('https://basket.test/api/me',{method:'OPTIONS',headers:{origin:'capacitor://localhost','access-control-request-method':'GET','access-control-request-headers':'authorization,content-type'}}),env);
 expect(valid.status).toBe(204);expect(valid.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
 const invalid=await worker.fetch(new Request('https://basket.test/api/me',{method:'OPTIONS',headers:{origin:'https://evil.test','access-control-request-method':'GET'}}),env);
 expect(invalid.status).toBe(403);expect(invalid.headers.get('access-control-allow-origin')).toBeNull();
});
test('오류 응답에도 허용된 origin만 적용한다',async()=>{
 const response=await worker.fetch(new Request('https://basket.test/api/me',{headers:{origin:'capacitor://localhost'}}),{ALLOWED_ORIGINS:'capacitor://localhost'});
 expect(response.status).toBe(401);expect(response.headers.get('access-control-allow-origin')).toBe('capacitor://localhost');
});
test('JSON 크기 제한은 문자 개수가 아닌 바이트로 판정한다',async()=>{
 const body=JSON.stringify({text:'가'.repeat(24000)});
 await expect(readBody(new Request('https://basket.test/',{method:'POST',body}))).rejects.toMatchObject({code:'INVALID_INPUT'});
});
