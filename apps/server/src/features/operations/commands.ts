import type {AuthActor,FormatNotice,CancellationReceipt} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {textField} from '../accounts/handlers';
import {idField} from '../matches/commands';
import {completeAccountDeletion} from '../../jobs/account-deletion';
export function createOperations(database:Database) {return {
 cancelApplication(actor:AuthActor,input:Record<string,unknown>):Promise<CancellationReceipt> {
  if(!['personal','format_change_declined'].includes(String(input.cause))) throw new ApiError('INVALID_INPUT',400);
  return database.rpc('api_cancel_application',{p_actor:actor.userId,p_application:idField(input.applicationId),p_cause:input.cause,p_notice:input.formatChangeId==null?null:idField(input.formatChangeId),p_request_id:textField(input.requestId,128)});
 },
 cancelMatch(actor:AuthActor,input:Record<string,unknown>):Promise<CancellationReceipt[]> {return database.rpc('api_cancel_match',{p_actor:actor.userId,p_match:idField(input.matchId),p_request_id:textField(input.requestId,128)});},
 announceFormatChange(actor:AuthActor,input:Record<string,unknown>):Promise<FormatNotice> {
  if(![3,4,5].includes(Number(input.playersPerTeam))) throw new ApiError('INVALID_INPUT',400);
  return database.rpc('api_announce_format',{p_actor:actor.userId,p_match:idField(input.matchId),p_players:input.playersPerTeam,p_reason:textField(input.reason,1000),p_request_id:textField(input.requestId,128)});
 },
 acknowledgeFormat(actor:AuthActor,input:Record<string,unknown>):Promise<void> {return database.rpc('api_acknowledge_format',{p_actor:actor.userId,p_application:idField(input.applicationId),p_notice:idField(input.noticeId),p_request_id:textField(input.requestId,128)});},
 myFormatNotices(actor:AuthActor):Promise<unknown[]> {return database.rpc('api_my_format_notices',{p_actor:actor.userId});},
 dashboard(actor:AuthActor):Promise<unknown> {return database.rpc('api_operator_dashboard',{p_actor:actor.userId});},
 reportProceeding(actor:AuthActor,input:Record<string,unknown>):Promise<unknown> {return database.rpc('api_report_proceeding',{p_actor:actor.userId,p_match:idField(input.matchId),p_reason:textField(input.reason,1000),p_request_id:textField(input.requestId,128)});},
 reportIssue(actor:AuthActor,input:Record<string,unknown>):Promise<{issueId:string}> {return database.rpc('api_report_issue',{p_actor:actor.userId,p_match:input.matchId==null?null:idField(input.matchId),p_facility:input.facilityId==null?null:idField(input.facilityId),p_text:textField(input.text),p_request_id:textField(input.requestId,128)});},
 moderateMatch(actor:AuthActor,input:Record<string,unknown>):Promise<void> {
  if(!['hide','stop_recruitment'].includes(String(input.action))) throw new ApiError('INVALID_INPUT',400);
  return database.rpc('api_moderate_match',{p_actor:actor.userId,p_match:idField(input.matchId),p_action:input.action,p_reason:textField(input.reason),p_request_id:textField(input.requestId,128)});
 },
 async requestAccountDeletion(actor:AuthActor):Promise<{status:'needs_resolution'|'completed'}> {
  const result=await database.rpc<{status:'needs_resolution'|'ready';authId?:string}>('api_prepare_account_deletion',{p_actor:actor.userId});
  if(result.status==='needs_resolution') return {status:'needs_resolution'};
  if(!result.authId) throw new ApiError('SERVICE_UNAVAILABLE',503);
  const success=await completeAccountDeletion(database,actor.userId,result.authId);
  return {status:success?'completed':'needs_resolution'};
 },
};}
