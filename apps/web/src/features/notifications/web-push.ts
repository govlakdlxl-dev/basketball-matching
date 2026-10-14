import {apiUsingToken,session,onSessionChanged,onSessionLeaving} from '../auth/session';
import {nativePlatformKind} from '@basket/mobile';
import {createPushLifecycle} from '../../../../mobile/src/push-lifecycle';
const life=createPushLifecycle(localStorage,async(b,token)=>{await apiUsingToken(token,`/push-endpoints/${b.endpointId}`,'DELETE',{ownerVersion:b.ownerVersion});},async()=>{
 localStorage.removeItem('basket.webpush.enabled');
 const registration=await navigator.serviceWorker?.getRegistration('/');for(const n of await registration?.getNotifications()||[])n.close();
 await registration?.pushManager.getSubscription().then(s=>s?.unsubscribe());
});
let cleanup:Promise<unknown>=Promise.resolve();
export function deviceId(){let id=localStorage.getItem('basket.device');if(!id){id=crypto.randomUUID();localStorage.setItem('basket.device',id);}return id;}
export async function registerWebPush(){
 await cleanup;
 const actor=session(),key=import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY as string|undefined;
 if(!actor)throw new Error('AUTH_REQUIRED');if(!key)throw new Error('SETUP_REQUIRED');
 if(nativePlatformKind()||!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('UNSUPPORTED');
 if(Notification.permission==='denied')throw new Error('PERMISSION_DENIED');
 if(Notification.permission!=='granted'&&await Notification.requestPermission()!=='granted')throw new Error('PERMISSION_DENIED');
 const reg=await navigator.serviceWorker.register('/push-sw.js'),ready=await navigator.serviceWorker.ready;
 const padded=key.replace(/-/g,'+').replace(/_/g,'/'),bytes=Uint8Array.from(atob(padded),c=>c.charCodeAt(0));
 const sub=await ready.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes}),json=sub.toJSON();
 const binding=await apiUsingToken<{endpointId:string;ownerVersion:number}>(actor.access_token,'/push-endpoints','POST',{channel:'webpush',deviceId:deviceId(),registration:{endpoint:json.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth}});
 if(session()?.user.id!==actor.user.id){await apiUsingToken(actor.access_token,`/push-endpoints/${binding.endpointId}`,'DELETE',{ownerVersion:binding.ownerVersion});throw new Error('SESSION_CHANGED');}
 life.bind({...binding,userId:actor.user.id});localStorage.setItem('basket.webpush.enabled','true');
}
export async function disableWebPush(){const s=session();if(s){cleanup=cleanup.then(()=>life.leave({userId:s.user.id,token:s.access_token}));await cleanup;}}
export function setupWebPush(){
 if(nativePlatformKind())return;
 onSessionLeaving(s=>{cleanup=cleanup.catch(()=>{}).then(()=>life.leave({userId:s.user.id,token:s.access_token}));return cleanup.then(()=>{});});
 onSessionChanged(()=>{const s=session();if(s)void life.retry({userId:s.user.id,token:s.access_token});});
}
export function webPushControls(){const root=document.createElement('div');root.className='card stack';const status=document.createElement('p');status.className='muted';const enable=document.createElement('button');enable.className='btn sec';enable.textContent='웹 푸시 알림 켜기';const disable=document.createElement('button');disable.className='btn sec';disable.textContent='웹 푸시 알림 끄기';
 enable.onclick=async()=>{enable.disabled=true;try{await registerWebPush();status.textContent='이 브라우저에 알림을 연결했어요.';}catch(e){status.textContent=e instanceof Error&&e.message==='PERMISSION_DENIED'?'브라우저 설정에서 알림을 허용할 수 있어요.':'웹 푸시 연결 설정을 준비 중이에요. 알림함은 이용할 수 있어요.';}enable.disabled=false;};
 disable.onclick=async()=>{try{await disableWebPush();status.textContent='이 브라우저의 알림 연결을 해제했어요.';}catch{status.textContent='알림 정리를 마치지 못했어요. 브라우저 설정도 확인해 주세요.';}};root.append(enable,disable,status);return root;
}
