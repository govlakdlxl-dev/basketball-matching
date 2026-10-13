export type Id = string;
export type UtcInstant = string;
export type Won = number;
export type Position = 'guard' | 'forward' | 'center';
export type AppState = 'pending' | 'awaiting_payment' | 'verifying_payment' | 'confirmed' | 'rejected' | 'expired' | 'cancelled';
export type AuthActor = { userId: Id };
export type Point = { lat: number; lng: number };
export type FacilityInput = {name:string;address:string;point:Point;region:'seoul'|'incheon';registration:'operator'|'map_search'|'manual_pin';sourceUrl:string|null;evidence:string};
export type Facility = Omit<FacilityInput,'evidence'> & {id:Id;registeredBy:Id|null;locationStatus:'unverified'|'verified';basketballUseStatus:'unverified'|'verified';verifiedAt:UtcInstant|null};
export type PublicFacility=Omit<Facility,'registeredBy'>;
export type PlaceCandidate = {providerId:string;name:string;address:string;point:Point};
export type PlatformAdapter={kind:'web'|'ios'|'android';openExternal(url:string):Promise<void>;subscribeToLinks(listener:(url:string)=>void):Promise<()=>void>};
export type PgCost = { status: 'unconfirmed'; amountKrw: null; bearer: null; reason: string };
export type PricingSnapshot = {
  baseFeeKrw: Won; platformRateBps: 0 | 500 | 1000;
  platformFeeKrw: Won; participantFeeKrw: Won; teamFeeKrw: Won;
  paymentAmountKrw: Won; teamBasisKrw: Won; currency: 'KRW';
  purpose: 'initial_test_order' | 'calculator_only'; pgCost: PgCost;
};
export type PolicySnapshot = { version: 'test-A-v1' | 'test-B-v1' };
export type TermsSnapshot = {
  facility: { id: Id; name: string; address: string; point: Point };
  startsAt: UtcInstant; endsAt: UtcInstant; playersPerTeam: 3 | 4 | 5;
  formatVersion: number; pricing: PricingSnapshot; policy: PolicySnapshot;
};
export type CancellationCause = 'personal' | 'host_cancelled' | 'format_change_declined';
export type CancellationReceipt = {
  id: Id; applicationId: Id; matchId: Id; receivedAt: UtcInstant;
  cause: CancellationCause; formatChangeId: Id | null; terms: TermsSnapshot;
};
export type MatchRoster = {
  matchId: Id; existingPlanned: number; confirmedGuests: number;
  awaitingPayment: number; verifyingPayment: number; availableGuests: number;
  projectedPlayers: number; guestTargetShortage: number; minimumPlayerShortage: number;
  positionSlots: Record<Position, { target: number; confirmed: number; held: number; available: number }>;
};
export type MatchInput={teamId:Id;facilityId:Id;startsAt:UtcInstant;endsAt:UtcInstant;playersPerTeam:3|4|5;teamCount:number;existingPlanned:number;guestSlots:Record<Position,number>;baseFeeKrw:Won;policy:PolicySnapshot;meetingPoint:string;rotationDescription:string;guestComposition:string;captainCoordination:string;reservationNote:string;expectedPlayingMinutes:number|null};
export type MatchSummary=MatchInput & {id:Id;teamName:string;facility:PublicFacility;recruitmentStatus:'open'|'closed'|'cancelled';formatVersion:number;roster:MatchRoster};
export type ApplicationRecord={id:Id;matchId:Id;applicantId:Id;position:Position;state:AppState;submittedAt:UtcInstant;acceptedAt:UtcInstant|null;paymentDeadlineAt:UtcInstant|null;terms:TermsSnapshot};
export type PaymentContext={application:ApplicationRecord;teamId:Id;recruitmentStatus:MatchSummary['recruitmentStatus']};
export type MatchNotificationContext={match:{id:Id;startsAt:UtcInstant;recruitmentStatus:MatchSummary['recruitmentStatus']};roster:MatchRoster;applications:ApplicationRecord[];activeCaptainIds:Id[]};
export type DomainEvent = {
  id: Id;
  kind: 'application.submitted' | 'application.accepted' | 'application.rejected'
    | 'application.expired' | 'application.cancelled' | 'payment.confirmed'
    | 'match.cancelled' | 'match.proceeding_reported' | 'format.changed' | 'roster.changed';
  matchId: Id; applicationId: Id | null; occurredAt: UtcInstant; payload: Record<string, unknown>;
};
