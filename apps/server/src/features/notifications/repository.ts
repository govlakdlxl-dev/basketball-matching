import type {NotificationPlan,ClaimedJob,DeliveryEnvelope,DeliveryResult} from '@basket/core/notifications/contracts';
import type {Database} from '../../infra/database';
import {parseInstant} from '@basket/core/time';
export function createNotificationRepository(database:Database){return {
 persistNotificationPlan(eventId:string|null,plan:NotificationPlan):Promise<void>{return database.rpc('api_persist_notification_plan',{p_event:eventId,p_plan:plan});},
 claimNotificationJobs(workerId:string,now:string):Promise<ClaimedJob[]>{parseInstant(now);return database.rpc('api_claim_notifications',{p_worker:workerId});},
 beginSend(claim:ClaimedJob):Promise<DeliveryEnvelope|null>{return database.rpc('api_begin_notification_send',{p_job:claim.jobId,p_token:claim.claimToken});},
 finishSend(claim:ClaimedJob,result:DeliveryResult):Promise<void>{return database.rpc('api_finish_notification_send',{p_job:claim.jobId,p_token:claim.claimToken,p_result:result});},
};}
