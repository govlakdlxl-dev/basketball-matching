import {parseAppLink,createAuthTransaction} from '../../../../mobile/src/links';
import {auth,api,session,sessionStoragePort} from './session';
import {createPlatform} from '../../platform/runtime';
import {closeNativeBrowser} from '@basket/mobile';
import type {TestOrder} from '@basket/core/contracts';
const transaction=createAuthTransaction(sessionStoragePort);
export async function beginOAuth(provider:'kakao'|'apple'){
 if(!auth)throw new Error('CONFIG_REQUIRED');const platform=createPlatform();
 if(platform.kind==='web'){const r=await auth.auth.signInWithOAuth({provider,options:{redirectTo:location.origin+'/auth/callback'}});if(r.error)throw r.error;return;}
 const state=await transaction.start(),result=await auth.auth.signInWithOAuth({provider,options:{redirectTo:'basketpilot://auth/callback?state='+encodeURIComponent(state),skipBrowserRedirect:true}});
 if(result.error||!result.data.url)throw new Error('OAUTH_UNAVAILABLE');await platform.openExternal(result.data.url);
}
export async function handleAppReturn(url:string){
 const link=parseAppLink(url,import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string|undefined);if(!link)return;
 if(link.kind==='auth'){
  const code=await transaction.consume(link),result=await auth?.auth.exchangeCodeForSession(code);if(!result||result.error)throw new Error('AUTH_CALLBACK_FAILED');try{await closeNativeBrowser();}catch{}location.hash='/applications';
 }else if(link.kind==='payment'){
  if(!session()){location.hash='/applications';return;}await api<TestOrder>(`/test-orders/${link.orderId}`);try{await closeNativeBrowser();}catch{}location.hash='/applications';
 }else location.hash=link.kind==='notice'?'/notifications/'+link.noticeId:'/matches/'+link.matchId;
}
