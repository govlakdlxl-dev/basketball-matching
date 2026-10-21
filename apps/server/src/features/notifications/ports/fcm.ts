import type {DeliveryEnvelope,DeliveryResult} from '@basket/core/notifications/contracts';
import type {EndpointAccess} from '../endpoints';
import {pushTitle,pushBody,pushData,remainingSeconds,result,signJwt} from './shared';
export type FcmServiceAccount={project_id:string;client_email:string;private_key:string};
export class FcmPushPort{
 private token:{value:string;expiresAt:number}|null=null;private pendingToken:Promise<string>|null=null;
 constructor(private config:FcmServiceAccount|null,private endpoints:EndpointAccess,private fetcher:typeof fetch=fetch){}
 private async accessToken():Promise<string>{
  if(this.token&&this.token.expiresAt>Date.now()+60000)return this.token.value;
  if(this.pendingToken)return this.pendingToken;
  this.pendingToken=(async()=>{const c=this.config!,now=Math.floor(Date.now()/1000),jwt=await signJwt({alg:'RS256',typ:'JWT'},{iss:c.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600},c.private_key,'RS256');
   const response=await this.fetcher('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt}).toString(),signal:AbortSignal.timeout(8000)}),body=await response.json() as {access_token?:unknown;expires_in?:unknown};
   if(!response.ok||typeof body.access_token!=='string'||typeof body.expires_in!=='number'||body.expires_in<=0)throw new Error('FCM_OAUTH_UNAVAILABLE');this.token={value:body.access_token,expiresAt:Date.now()+Math.min(body.expires_in,3600)*1000};return body.access_token;
  })();try{return await this.pendingToken;}finally{this.pendingToken=null;}
 }
 async send(envelope:DeliveryEnvelope):Promise<DeliveryResult>{
  const c=this.config;if(!c||!/^[-a-z0-9]{4,64}$/.test(c.project_id)||typeof c.private_key!=='string'||typeof c.client_email!=='string')return result('setup_required','FCM_CREDENTIALS_NOT_CONFIGURED');
  const p=await this.endpoints.load(envelope);if(!p||p.channel!=='fcm')return result('suppressed','ENDPOINT_BINDING_CHANGED');
  try{
   const token=await this.accessToken(),current=await this.endpoints.refresh(envelope);if(!current)return result('suppressed','STATE_CHANGED');if(current.expiresAt&&Date.parse(current.expiresAt)<=Date.now())return result('suppressed','DELIVERY_EXPIRED');
   const data=Object.fromEntries(Object.entries(pushData(current)).map(([key,value])=>[key,Array.isArray(value)?JSON.stringify(value):value]));
   const response=await this.fetcher(`https://fcm.googleapis.com/v1/projects/${c.project_id}/messages:send`,{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({message:{token:p.registration.token,notification:{title:pushTitle,body:pushBody},data,android:{ttl:remainingSeconds(current)+'s',priority:'high'}}}),signal:AbortSignal.timeout(8000)}),body=await response.json().catch(()=>null) as {name?:unknown;error?:{details?:{errorCode?:unknown}[]}}|null;
   if(response.ok&&typeof body?.name==='string'&&body.name.startsWith(`projects/${c.project_id}/messages/`))return result('provider_accepted',null,body.name);
   if(body?.error?.details?.some(detail=>detail.errorCode==='UNREGISTERED'))await this.endpoints.expire(p.id,p.ownerVersion);
   return result(response.ok?'unknown':'failed','FCM_HTTP_'+response.status);
  }catch{return result('unknown','FCM_PROVIDER_UNAVAILABLE');}
 }
}
