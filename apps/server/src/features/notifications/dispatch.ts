import type {ClaimedJob,DeliveryPort,DeliveryResult} from '@basket/core/notifications/contracts';
import type {Database} from '../../infra/database';
import {createNotificationRepository} from './repository';
export function createNotificationDispatcher(database:Database){return {async dispatchNotificationJob(claim:ClaimedJob,port:DeliveryPort):Promise<DeliveryResult>{
 const repo=createNotificationRepository(database),envelope=await repo.beginSend(claim);if(!envelope)return {status:'suppressed',providerMessageId:null,reason:'STATE_OR_CLAIM_CHANGED'};
 let result:DeliveryResult;try{result=await port.send(envelope);}catch{result={status:'unknown',providerMessageId:null,reason:'PROVIDER_UNAVAILABLE'};}await repo.finishSend(claim,result);return result;
}};}
