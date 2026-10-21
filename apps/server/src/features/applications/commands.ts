import type {AuthActor,ApplicationRecord} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {idField} from '../matches/commands';
import {textField} from '../accounts/handlers';
export function createApplicationCommands(database:Database) {return {
 submitApplication(actor:AuthActor,input:Record<string,unknown>):Promise<ApplicationRecord> {
  if(!['guard','forward','center'].includes(String(input.position))) throw new ApiError('INVALID_INPUT',400);
  return database.rpc('api_submit_application',{p_actor:actor.userId,p_match:idField(input.matchId),p_position:input.position,p_request_id:textField(input.requestId,128)});
 },
 acceptApplication(actor:AuthActor,input:Record<string,unknown>):Promise<ApplicationRecord> {return database.rpc('api_accept_application',{p_actor:actor.userId,p_application:idField(input.applicationId),p_request_id:textField(input.requestId,128)});},
 rejectApplication(actor:AuthActor,input:Record<string,unknown>):Promise<ApplicationRecord> {return database.rpc('api_reject_application',{p_actor:actor.userId,p_application:idField(input.applicationId),p_reason:textField(input.reason,500),p_request_id:textField(input.requestId,128)});},
};}
