import type {DeliveryEnvelope,DeliveryResult} from '@basket/core/notifications/contracts';
import type {EndpointAccess} from '../endpoints';
import {buildPushPayload} from '@block65/webcrypto-web-push';
import type {VapidKeys} from '@block65/webcrypto-web-push';
import {validateWebPushEndpoint,supportedWebPushHosts} from '../push-policy';
import {pushTitle,pushBody,pushData,remainingSeconds,result} from './shared';
export class WebPushPort{
 constructor(private config:VapidKeys|null,private endpoints:EndpointAccess,private fetcher:typeof fetch=fetch,private allowedHosts:readonly string[]=supportedWebPushHosts){}
 async send(envelope:DeliveryEnvelope):Promise<DeliveryResult>{
  const c=this.config;if(!c?.subject||!c.publicKey||!c.privateKey)return result('setup_required','VAPID_NOT_CONFIGURED');
  const p=await this.endpoints.load(envelope);if(!p||p.channel!=='webpush')return result('suppressed','ENDPOINT_BINDING_CHANGED');
  try{
   const endpoint=validateWebPushEndpoint(p.registration.endpoint!,this.allowedHosts),current=await this.endpoints.refresh(envelope);if(!current)return result('suppressed','STATE_CHANGED');if(current.expiresAt&&Date.parse(current.expiresAt)<=Date.now())return result('suppressed','DELIVERY_EXPIRED');
   const subscription={endpoint:endpoint.href,expirationTime:null,keys:{p256dh:p.registration.p256dh!,auth:p.registration.auth!}},ttl=remainingSeconds(current),init=await buildPushPayload({data:{title:pushTitle,body:pushBody,...pushData(current)},options:{ttl}},subscription,c);init.headers.ttl=String(ttl);
   // 암호화 이후에도 현재 회원·기한을 재검사합니다.
   const fresh=await this.endpoints.refresh(current);if(!fresh||JSON.stringify(pushData(fresh))!==JSON.stringify(pushData(current)))return result('suppressed','STATE_CHANGED');
   if(fresh.expiresAt&&Date.parse(fresh.expiresAt)<=Date.now())return result('suppressed','DELIVERY_EXPIRED');init.headers.ttl=String(remainingSeconds(fresh));
   const response=await this.fetcher(endpoint.href,{...init,redirect:'error',signal:AbortSignal.timeout(8000)});
   if(response.ok)return result('provider_accepted',null,response.headers.get('location'));
   if([404,410].includes(response.status))await this.endpoints.expire(p.id,p.ownerVersion);
   return result('failed','WEBPUSH_HTTP_'+response.status);
  }catch{return result('unknown','WEBPUSH_PROVIDER_UNAVAILABLE');}
 }
}
