import {afterEach,expect,test,vi} from 'vitest';
import {createClient} from '@supabase/supabase-js';
import {loadLocalStatus} from './fixtures/database';

afterEach(()=>{vi.doUnmock('../../apps/web/src/features/auth/session');vi.doUnmock('../../apps/web/src/platform/runtime');vi.unstubAllGlobals();vi.resetModules();});

// 실제 SDK와 로컬 Auth를 통과한 최종 요청을 검사합니다. 기본 scope가 다시
// 이메일·사진을 포함하면 카카오 앱에 없는 권한을 요청하는 KOE205가 재발합니다.
for(const kind of ['web','ios'] as const){
 test(`${kind} 카카오 로그인은 최종 인가 요청에 닉네임만 포함한다`,async()=>{
  const status=loadLocalStatus(),values=new Map<string,string>();
  const storage={getItem:async(k:string)=>values.get(k)??null,setItem:async(k:string,v:string)=>{values.set(k,v);},removeItem:async(k:string)=>{values.delete(k);}};
  const client=createClient(status.API_URL,status.ANON_KEY,{auth:{flowType:'pkce',persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storage}});
  let authorizationUrl='';const signIn=client.auth.signInWithOAuth.bind(client.auth);
  client.auth.signInWithOAuth=async input=>{const result=await signIn(input);authorizationUrl=result.data.url??'';return result;};
  vi.stubGlobal('location',{origin:'http://127.0.0.1:5173'});
  // OS 브리지와 전역 웹 세션만 대체하고, transaction·PKCE 생성은 실제 코드를 사용합니다.
  vi.doMock('../../apps/web/src/features/auth/session',()=>({auth:client,api:async()=>null,session:()=>null,sessionStoragePort:storage}));
  vi.doMock('../../apps/web/src/platform/runtime',()=>({createPlatform:()=>({kind,openExternal:async(url:string)=>{authorizationUrl=url;}})}));
  const {beginOAuth}=await import('../../apps/web/src/features/auth/callback');
  await beginOAuth('kakao');
  const start=new URL(authorizationUrl);
  expect(start.origin).toBe(status.API_URL);
  expect(start.searchParams.has('code_challenge')).toBe(true);
  const response=await fetch(start,{redirect:'manual'});
  expect(response.status).toBe(302);
  const providerUrl=new URL(response.headers.get('location')!);
  expect(providerUrl.origin+providerUrl.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
  expect(providerUrl.searchParams.getAll('scope')).toEqual(['profile_nickname']);
  expect(Boolean(providerUrl.searchParams.get('state'))).toBe(true);
 });
}
