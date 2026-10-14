import type {AuthActor} from '@basket/core/contracts';
import type {DeliveryEnvelope} from '@basket/core/notifications/contracts';
import type {Database} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {idField} from '../matches/commands';
import {supportedWebPushHosts,validatePushRegistration} from './push-policy';
export type PrivatePushEndpoint={id:string;channel:'apns'|'fcm'|'webpush';registration:Record<string,string>;ownerVersion:number};
export type EndpointAccess={load(envelope:DeliveryEnvelope):Promise<PrivatePushEndpoint|null>;refresh(envelope:DeliveryEnvelope):Promise<DeliveryEnvelope|null>;expire(id:string,ownerVersion:number):Promise<void>};
export function createPushEndpoints(database:Database,allowedHosts:readonly string[]=supportedWebPushHosts){return {
 async registerPushEndpoint(actor:AuthActor,input:Record<string,unknown>):Promise<{endpointId:string;ownerVersion:number}>{
  if(Object.keys(input).some(k=>!['channel','registration','deviceId'].includes(k))||typeof input.channel!=='string'||!input.registration||typeof input.registration!=='object'||Array.isArray(input.registration))throw new ApiError('INVALID_INPUT',400);
  const deviceId=idField(input.deviceId);let registration:Record<string,string>;try{registration=await validatePushRegistration(input.channel,input.registration as Record<string,unknown>,allowedHosts);}catch{throw new ApiError('INVALID_INPUT',400);}
  const raw=input.channel+'|'+(registration.token??registration.endpoint),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw)),fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  return database.rpc('api_register_push_endpoint',{p_actor:actor.userId,p_channel:input.channel,p_device:deviceId,p_fingerprint:fingerprint,p_registration:registration});
 },
 deactivatePushEndpoint(actor:AuthActor,endpointId:unknown,ownerVersion:unknown):Promise<void>{if(typeof ownerVersion!=='number'||!Number.isSafeInteger(ownerVersion)||ownerVersion<1)throw new ApiError('INVALID_INPUT',400);return database.rpc('api_deactivate_push_endpoint',{p_actor:actor.userId,p_endpoint:idField(endpointId),p_version:ownerVersion});},
 selectPushEndpoint(userId:string):Promise<{endpointId:string;channel:PrivatePushEndpoint['channel']}|null>{return database.rpc('api_select_push_endpoint',{p_user:userId});},
 load(envelope:DeliveryEnvelope):Promise<PrivatePushEndpoint|null>{return database.rpc('api_push_binding_for_job',{p_job:envelope.jobId});},
 refresh(envelope:DeliveryEnvelope):Promise<DeliveryEnvelope|null>{return database.rpc('api_refresh_notification_send',{p_job:envelope.jobId});},
 expire(id:string,ownerVersion:number):Promise<void>{return database.rpc('api_expire_push_endpoint',{p_endpoint:id,p_version:ownerVersion});},
};}
