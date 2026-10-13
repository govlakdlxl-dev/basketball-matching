import type {AuthActor,MatchSummary,ApplicationRecord,MatchRoster,PaymentContext,MatchNotificationContext} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import {idField} from './commands';
export function createMatchQueries(database:Database) {return {
 list():Promise<MatchSummary[]> {return database.rpc('api_list_matches');},
 myHosting(actor:AuthActor):Promise<MatchSummary[]> {return database.rpc('api_my_hosting',{p_actor:actor.userId});},
 get(id:unknown):Promise<MatchSummary> {return database.rpc('api_get_match',{p_match:idField(id)});},
 getMatchRoster(id:unknown):Promise<MatchRoster> {return database.rpc('match_roster',{p_match:idField(id)});},
 myApplications(actor:AuthActor):Promise<ApplicationRecord[]> {return database.rpc('api_my_applications',{p_actor:actor.userId});},
 teamApplications(actor:AuthActor,id:unknown):Promise<(ApplicationRecord & {nickname:string})[]> {return database.rpc('api_team_applications',{p_actor:actor.userId,p_match:idField(id)});},
 getPaymentContext(actor:AuthActor,id:unknown):Promise<PaymentContext> {return database.rpc('api_payment_context',{p_actor:actor.userId,p_application:idField(id)});},
 expireUnpaidApplications():Promise<number> {return database.rpc('api_expire_unpaid');},
 getMatchNotificationContext(id:unknown):Promise<MatchNotificationContext> {return database.rpc('api_match_notification_context',{p_match:idField(id)});},
};}
