import type {Id,UtcInstant,MatchNotificationContext} from '../contracts';
export type ReminderWindow={logicalKey:string;recipientId:Id;matchId:Id;kind:'payment'|'captain_pending'|'captain_shortage';anchorAt:UtcInstant;endsAt:UtcInstant};
export type NotificationSnapshot=MatchNotificationContext&{windows:ReminderWindow[]};
export type NoticeDraft={logicalKey:string;recipientId:Id;matchId:Id;applicationId:Id|null;kind:'application.accepted'|'payment.confirmed'|'match.cancelled'|'format.changed'|'match.proceeding_reported'|'captain.pending'|'captain.shortage';text:string;isActionable:boolean;targetVersion:number|null};
export type DeliveryDraft={logicalKeys:string[];recipientId:Id;matchId:Id;milestone:string;transport:'push'|'alimtalk';dueAt:UtcInstant;expiresAt:UtcInstant|null};
export type NotificationPlan={notices:NoticeDraft[];deliveries:DeliveryDraft[];windows:ReminderWindow[]};
