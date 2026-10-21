import type {AuthActor,MatchSummary} from '@basket/core/contracts';
import {validateMatchInput} from '@basket/core/matches';
import type {Database} from '../../infra/database';
import {ApiError} from '../../http/auth';
import {textField} from '../accounts/handlers';
export function idField(value:unknown):string {const id=textField(value,36);if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new ApiError('INVALID_INPUT',400);return id;}
export function createMatchCommands(database:Database) {return {
 publishMatch(actor:AuthActor,input:Record<string,unknown>):Promise<MatchSummary> {
  let valid;try {valid=validateMatchInput(input);} catch {throw new ApiError('INVALID_INPUT',400);}
  return database.rpc('api_publish_match',{p_actor:actor.userId,p_input:valid,p_request_id:textField(input.requestId,128)});
 },
};}
