import type {ApplicationRecord,ApprovalReceipt,MatchSummary,TestOrder} from '@basket/core/contracts';
import type {createDatabaseFixture} from './database';
export async function acceptedPayment(db:Awaited<ReturnType<typeof createDatabaseFixture>>,fee=10000,prepareApproval=true){
 await db.setLocalDatabaseTime('2026-10-20T10:00:00Z');
 const matchResponse=await db.request('captain','/api/matches','POST',{teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:'2026-10-21T11:00:00Z',endsAt:'2026-10-21T13:00:00Z',playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:fee,policy:{version:'test-B-v1'},meetingPoint:'입구',rotationDescription:'교대',guestComposition:'개인',captainCoordination:'주장',reservationNote:'로컬 테스트',expectedPlayingMinutes:60,requestId:crypto.randomUUID()});
 if(!matchResponse.ok)throw new Error('MATCH_FIXTURE_FAILED');const m=await matchResponse.json() as MatchSummary;
 const a=await (await db.request('memberA',`/api/matches/${m.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 const accepted=await (await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 if(fee===0)return {m,a:accepted,order:null,receipt:null};
 const order=await (await db.request('memberA','/api/test-orders','POST',{applicationId:a.id,requestId:crypto.randomUUID()})).json() as TestOrder;
 const receipt=prepareApproval?await (await db.request('memberA',`/api/test-orders/${order.id}/approval`,'POST',{paymentKey:'fake_'+crypto.randomUUID(),requestId:crypto.randomUUID()})).json() as ApprovalReceipt:null;
 return {m,a:accepted,order,receipt};
}
