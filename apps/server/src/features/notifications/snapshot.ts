import type {NotificationSnapshot,ReminderWindow} from '@basket/core/notifications/contracts';
import type {Database} from '../../infra/database';
import {createMatchQueries} from '../matches/queries';
export function createNotificationSnapshots(database:Database){return {async loadNotificationSnapshot(matchId:string):Promise<NotificationSnapshot>{
 const context=await createMatchQueries(database).getMatchNotificationContext(matchId);
 const windows=await database.rpc<ReminderWindow[]>('api_notification_windows',{p_match:matchId});return {...context,windows};
}};}
