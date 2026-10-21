import type {Id,UtcInstant,MatchNotificationContext} from '../contracts';
export type ReminderWindow={logicalKey:string;recipientId:Id;matchId:Id;kind:'payment'|'captain_pending'|'captain_shortage';anchorAt:UtcInstant;endsAt:UtcInstant};
export type NotificationSnapshot=MatchNotificationContext&{windows:ReminderWindow[]};
export type NoticeDraft={logicalKey:string;recipientId:Id;matchId:Id;applicationId:Id|null;kind:'application.accepted'|'payment.confirmed'|'match.cancelled'|'format.changed'|'match.proceeding_reported'|'captain.pending'|'captain.shortage';text:string;isActionable:boolean;targetVersion:number|null};
export type DeliveryDraft={logicalKeys:string[];recipientId:Id;matchId:Id;milestone:string;transport:'push'|'alimtalk';dueAt:UtcInstant;expiresAt:UtcInstant|null};
export type NotificationPlan={notices:NoticeDraft[];deliveries:DeliveryDraft[];windows:ReminderWindow[]};
export type InboxNotice=Omit<NoticeDraft,'recipientId'|'targetVersion'>&{id:Id;createdAt:UtcInstant;readAt:UtcInstant|null};
export type ClaimedJob={jobId:Id;claimToken:Id;leaseEndsAt:UtcInstant;endpointId:Id|null;endpointOwnerVersion:number|null};
export type DeliveryEnvelope={jobId:Id;recipientId:Id;transport:'push'|'alimtalk';endpointId:Id|null;noticeIds:Id[];matchId:Id;applicationId:Id|null;title:string;body:string;expiresAt:UtcInstant|null};
export type DeliveryResult={status:'provider_accepted'|'failed'|'unknown'|'suppressed'|'setup_required';providerMessageId:string|null;reason:string|null};
export interface DeliveryPort{send(envelope:DeliveryEnvelope):Promise<DeliveryResult>}
