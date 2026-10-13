import type {AuthActor} from '@basket/core/contracts';
import type {InboxNotice} from '@basket/core/notifications/contracts';
import type {Database} from '../../infra/database';
import {idField} from '../matches/commands';
export function createNotifications(database:Database){return {
 listInbox(actor:AuthActor):Promise<InboxNotice[]>{return database.rpc('api_list_inbox',{p_actor:actor.userId});},
 getInboxNotice(actor:AuthActor,noticeId:unknown):Promise<InboxNotice>{return database.rpc('api_get_inbox_notice',{p_actor:actor.userId,p_notice:idField(noticeId)});},
 markNoticeRead(actor:AuthActor,noticeId:unknown):Promise<void>{return database.rpc('api_read_inbox_notice',{p_actor:actor.userId,p_notice:idField(noticeId)});},
};}
