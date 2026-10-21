import {PushNotifications} from '@capacitor/push-notifications';
import {registerPlugin} from '@capacitor/core';
import {createPushLifecycle,noticeTarget} from './push-lifecycle';
import type {PushActor,PushBinding} from './push-lifecycle';
import {nativePlatformKind} from './bridge';
export type DevicePushPorts={kind:'ios'|'android';permission():Promise<string>;requestPermission():Promise<string>;token():Promise<string>;clear():Promise<void>;click(listener:(data:unknown)=>void):Promise<void>};
type PushApi={current():PushActor|null;register(actor:PushActor,input:{channel:'apns'|'fcm';registration:{token:string};deviceId:string}):Promise<{endpointId:string;ownerVersion:number}>;remove(binding:PushBinding,token:string):Promise<void>};
export function createDevicePushController(native:DevicePushPorts,api:PushApi,storage:Pick<Storage,'getItem'|'setItem'|'removeItem'>){
 const localPending='basket.nativepush.localCleanupPending';
 async function clearLocal(){storage.setItem(localPending,'true');await native.clear();storage.removeItem(localPending);}
 let generation=0,cleanup=Promise.resolve();const life=createPushLifecycle(storage,api.remove,clearLocal,'basket.nativepush');
 async function retryLocal(){cleanup=cleanup.catch(()=>{}).then(async()=>{if(storage.getItem(localPending)==='true')await clearLocal();});await cleanup;}
 function device(){let id=storage.getItem('basket.device');if(!id){id=crypto.randomUUID();storage.setItem('basket.device',id);}return id;}
 return {
  async registerDevicePush(prompt=true):Promise<{endpointId:string}|{status:'permission_denied'}>{
   await retryLocal();const actor=api.current();if(!actor)throw new Error('AUTH_REQUIRED');const version=++generation;
   let permission=await native.permission();if(prompt&&permission.startsWith('prompt'))permission=await native.requestPermission();if(permission!=='granted')return {status:'permission_denied'};
   const token=await native.token();if(version!==generation||api.current()?.userId!==actor.userId)throw new Error('SESSION_CHANGED');
   const binding=await api.register(actor,{channel:native.kind==='ios'?'apns':'fcm',deviceId:device(),registration:{token}});
   if(version!==generation||api.current()?.userId!==actor.userId){await life.release({...binding,userId:actor.userId},actor.token);throw new Error('SESSION_CHANGED');}
   life.bind({...binding,userId:actor.userId});storage.setItem('basket.nativepush.enabled','true');return {endpointId:binding.endpointId};
  },
  async unregisterDevicePush(actor=api.current()):Promise<{status:'completed'|'pending'}>{
   if(actor&&api.current()?.userId!==actor.userId&&life.binding()?.userId!==actor.userId)return {status:'completed'};
   ++generation;storage.removeItem('basket.nativepush.enabled');if(!actor)return {status:'completed'};
   cleanup=cleanup.catch(()=>{}).then(()=>life.leave(actor));await cleanup.catch(()=>{});return {status:life.pendingCount(actor.userId)||storage.getItem(localPending)==='true'?'pending':'completed'};
  },
  async resume(){await retryLocal();const actor=api.current();if(actor)await life.retry(actor);},
  enabled:()=>storage.getItem('basket.nativepush.enabled')==='true',
  async listen(listener:(path:string)=>void){await native.click(data=>listener(noticeTarget(data)));},
 };
}
export function nativePushPorts():DevicePushPorts{
 const kind=nativePlatformKind();if(!kind)throw new Error('NOT_NATIVE_PLATFORM');
 const reset=registerPlugin<{clearBadge():Promise<void>}>('SessionVault');
 return {kind,
  permission:async()=>(await PushNotifications.checkPermissions()).receive,
  requestPermission:async()=>(await PushNotifications.requestPermissions()).receive,
  token:()=>new Promise<string>((resolve,reject)=>{let done=false;const handles:Awaited<ReturnType<typeof PushNotifications.addListener>>[]=[],finish=(token?:string)=>{if(done)return;done=true;clearTimeout(timer);for(const h of handles)void h.remove();token?resolve(token):reject(new Error('PUSH_REGISTRATION_FAILED'));},timer=setTimeout(()=>finish(),20000);
   void (async()=>{try{const a=await PushNotifications.addListener('registration',t=>finish(t.value));if(done){await a.remove();return;}handles.push(a);const b=await PushNotifications.addListener('registrationError',()=>finish());if(done){await b.remove();return;}handles.push(b);await PushNotifications.register();}catch{finish();}})();
  }),
  async clear(){const results=await Promise.allSettled([PushNotifications.removeAllDeliveredNotifications(),PushNotifications.unregister(),...(kind==='ios'?[reset.clearBadge()]:[])]);if(results.some(r=>r.status==='rejected'))throw new Error('DEVICE_CLEANUP_PENDING');},
  async click(listener){await PushNotifications.addListener('pushNotificationActionPerformed',event=>listener(event.notification.data));},
 };
}
