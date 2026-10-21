import type {DeliveryEnvelope,DeliveryResult} from '@basket/core/notifications/contracts';
import type {EndpointAccess} from '../endpoints';
import {pushTitle,pushBody,pushData,result,signJwt} from './shared';
export type ApnsConfig={keyId:string;teamId:string;privateKey:string;topic:string;environment:'sandbox'|'production'};
export type ApnsHttp2Transport={protocol:'h2';send:typeof fetch};
export class ApnsPushPort{
 private jwt:{value:string;createdAt:number}|null=null;
 constructor(private config:ApnsConfig|null,private endpoints:EndpointAccess,private transport?:ApnsHttp2Transport){}
 async send(envelope:DeliveryEnvelope):Promise<DeliveryResult>{
  if(!this.config)return result('setup_required','APNS_CREDENTIALS_NOT_CONFIGURED');if(!this.transport||this.transport.protocol!=='h2')return result('setup_required','APNS_HTTP2_TRANSPORT_NOT_VERIFIED');
  const p=await this.endpoints.load(envelope);if(!p||p.channel!=='apns')return result('suppressed','ENDPOINT_BINDING_CHANGED');
  try{
   const now=Math.floor(Date.now()/1000);if(!this.jwt||now-this.jwt.createdAt>=3000)this.jwt={value:await signJwt({alg:'ES256',kid:this.config.keyId},{iss:this.config.teamId,iat:now},this.config.privateKey,'ES256'),createdAt:now};
   const current=await this.endpoints.refresh(envelope);if(!current)return result('suppressed','STATE_CHANGED');
   if(current.expiresAt&&Date.parse(current.expiresAt)<=Date.now())return result('suppressed','DELIVERY_EXPIRED');
   const body=JSON.stringify({aps:{alert:{title:pushTitle,body:pushBody},sound:'default'},...pushData(current)});if(new TextEncoder().encode(body).length>4096)return result('failed','APNS_PAYLOAD_TOO_LARGE');
   const response=await this.transport.send(`https://${this.config.environment==='sandbox'?'api.sandbox.push.apple.com':'api.push.apple.com'}/3/device/${p.registration.token}`,{method:'POST',redirect:'error',headers:{authorization:'bearer '+this.jwt.value,'apns-topic':this.config.topic,'apns-push-type':'alert','apns-id':current.jobId,'apns-expiration':String(current.expiresAt?Math.floor(Date.parse(current.expiresAt)/1000):now+300),'content-type':'application/json'},body,signal:AbortSignal.timeout(8000)});
   if(response.status===200)return result('provider_accepted',null,response.headers.get('apns-id')??current.jobId);
   const error=await response.json().catch(()=>null) as {reason?:unknown}|null;if(response.status===410&&['Unregistered','ExpiredToken'].includes(String(error?.reason)))await this.endpoints.expire(p.id,p.ownerVersion);
   return result(response.status>=500?'failed':'failed','APNS_HTTP_'+response.status);
  }catch{return result('unknown','APNS_PROVIDER_UNAVAILABLE');}
 }
}
