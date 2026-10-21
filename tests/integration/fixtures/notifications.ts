import type {ApplicationRecord,DomainEvent,MatchNotificationContext} from '@basket/core/contracts';
import type {NotificationSnapshot,ReminderWindow} from '@basket/core/notifications/contracts';
import {calculatePaymentDeadline} from '@basket/core/time';
import {quoteInitialTest} from '@basket/core/money';
export function paymentFixture(change:Partial<ApplicationRecord>={}):NotificationSnapshot{
 const acceptedAt=change.acceptedAt??'2026-10-13T09:10:00Z',startsAt='2026-10-13T10:00:00Z';
 const a:ApplicationRecord={id:'app-1',matchId:'match-1',applicantId:'guest-1',position:'guard',state:'awaiting_payment',submittedAt:'2026-10-13T09:00:00Z',acceptedAt,paymentDeadlineAt:calculatePaymentDeadline(acceptedAt,startsAt),terms:{facility:{id:'court',name:'체육관',address:'서울',point:{lat:37.5,lng:127}},startsAt,endsAt:'2026-10-13T12:00:00Z',playersPerTeam:5,formatVersion:1,pricing:quoteInitialTest(10000),policy:{version:'test-A-v1'}},...change};
 const window:ReminderWindow={logicalKey:'application:app-1:payment',recipientId:a.applicantId,matchId:a.matchId,kind:'payment',anchorAt:acceptedAt,endsAt:a.paymentDeadlineAt!};
 return {match:{id:'match-1',startsAt,recruitmentStatus:'open'},applications:[a],roster:{matchId:'match-1',existingPlanned:8,confirmedGuests:2,awaitingPayment:2,verifyingPayment:0,availableGuests:0,projectedPlayers:10,guestTargetShortage:2,minimumPlayerShortage:0,positionSlots:{guard:{target:2,confirmed:1,held:1,available:0},forward:{target:2,confirmed:1,held:1,available:0},center:{target:0,confirmed:0,held:0,available:0}}},activeCaptainIds:[],formatNotices:[],cancellations:[],hostReports:[],windows:[window]};
}
export function event(kind:DomainEvent['kind'],applicationId:string|null='app-1',payload:Record<string,unknown>={}):DomainEvent{return {id:'event-1',kind,matchId:'match-1',applicationId,occurredAt:'2026-10-13T09:10:00Z',payload};}
export function pendingFixture(){const s=paymentFixture({state:'pending',acceptedAt:null,paymentDeadlineAt:null});s.activeCaptainIds=['captain-1'];s.windows=[];return s;}
export function proceedingFixture(){const snapshot=paymentFixture({id:'active-app',state:'confirmed'});snapshot.windows=[];snapshot.applications.push({...snapshot.applications[0]!,id:'cancelled-app',applicantId:'cancelled-guest',state:'cancelled'});snapshot.hostReports=[{id:'report-1',reportedBy:'captain',reportedAt:'2026-10-13T09:20:00Z',reason:'주최자가 인원을 확인하고 진행 안내'}];return {snapshot,event:{...event('match.proceeding_reported',null,{reportId:'report-1'}),occurredAt:'2026-10-13T09:20:00Z'},now:'2026-10-13T09:21:00Z'};}
export type FixtureContext=MatchNotificationContext;
