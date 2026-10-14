import {createDevicePushController,nativePushPorts} from '../../../../mobile/src/push';
import {nativePlatformKind} from '@basket/mobile';
import {apiUsingToken,session,onSessionLeaving,onSessionChanged,sessionStoragePort} from '../auth/session';
const current=()=>{const s=session();return s?{userId:s.user.id,token:s.access_token}:null;};
let controller:ReturnType<typeof createDevicePushController>|null=null;
export function setupNativePush(){if(!nativePlatformKind())return;
 controller=createDevicePushController(nativePushPorts(),{current,register:(actor,input)=>apiUsingToken(actor.token,'/push-endpoints','POST',input),remove:async(binding,token)=>{await apiUsingToken(token,`/push-endpoints/${binding.endpointId}`,'DELETE',{ownerVersion:binding.ownerVersion});}},localStorage);
 void controller.listen(path=>{location.hash=path;});
 onSessionLeaving(async s=>{await controller?.unregisterDevicePush({userId:s.user.id,token:s.access_token});if(!session()||session()?.user.id===s.user.id){await sessionStoragePort.removeItem('basket.auth.transaction');await sessionStoragePort.removeItem('basket.payment.pending');}});
 onSessionChanged(()=>{void controller?.resume();});
}
export async function refreshNativePush(){if(!controller)return;await controller.resume();if(controller.enabled())await controller.registerDevicePush(false);}
export function nativePushControls(){const root=document.createElement('div');root.className='card stack';const enable=document.createElement('button');enable.className='btn sec';enable.textContent='앱 푸시 알림 켜기';const disable=document.createElement('button');disable.className='btn sec';disable.textContent='앱 푸시 알림 끄기';const status=document.createElement('p');status.className='muted';
 enable.onclick=async()=>{enable.disabled=true;try{if(!controller)throw new Error('CONFIG_REQUIRED');const r=await controller.registerDevicePush();status.textContent='status' in r?'알림 허용 여부는 휴대폰 설정에서 바꿀 수 있어요.':'이 기기의 앱 알림을 연결했어요.';}catch{status.textContent='앱 알림 연결을 준비 중이에요. 알림함은 이용할 수 있어요.';}enable.disabled=false;};disable.onclick=async()=>{try{if(!controller)throw new Error('CONFIG_REQUIRED');const r=await controller.unregisterDevicePush();status.textContent=r.status==='pending'?'기기 알림을 해제했어요. 서버 해지는 재접속 시 다시 확인합니다.':'앱 알림을 해제했어요.';}catch{status.textContent='알림 정리를 마치지 못했어요. 휴대폰 설정도 확인해 주세요.';}};root.append(enable,disable,status);return root;
}
