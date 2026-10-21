import type {DeliveryPort} from '@basket/core/notifications/contracts';
import type {Database,Env} from '../../../infra/database';
import {createPushEndpoints} from '../endpoints';
import {FcmPushPort} from './fcm';
import {ApnsPushPort} from './apns';
import {WebPushPort} from './webpush';
import {result} from './shared';
export function configuredPushPort(database:Database,env:Env):DeliveryPort{
 const endpoints=createPushEndpoints(database);let fcm=null,vapid=null;
 try{fcm=env.FCM_SERVICE_ACCOUNT_JSON?JSON.parse(env.FCM_SERVICE_ACCOUNT_JSON):null;}catch{/* 잘못된 설정은 미설정 상태로 남깁니다. */}
 if(env.WEB_PUSH_PUBLIC_KEY&&env.WEB_PUSH_PRIVATE_KEY&&env.WEB_PUSH_SUBJECT)vapid={publicKey:env.WEB_PUSH_PUBLIC_KEY,privateKey:env.WEB_PUSH_PRIVATE_KEY,subject:env.WEB_PUSH_SUBJECT};
 const ports={fcm:new FcmPushPort(fcm,endpoints),webpush:new WebPushPort(vapid,endpoints),apns:new ApnsPushPort(null,endpoints)};
 return {async send(envelope){if(!envelope.endpointId)return result('setup_required','PUSH_DEVICE_NOT_REGISTERED');const binding=await endpoints.load(envelope);if(!binding)return result('suppressed','ENDPOINT_BINDING_CHANGED');return ports[binding.channel].send(envelope);}};
}
