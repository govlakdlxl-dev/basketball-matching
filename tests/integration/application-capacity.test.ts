import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import type {MatchInput,MatchSummary,ApplicationRecord} from '@basket/core/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>;
beforeAll(async()=>{db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;await db.setLocalDatabaseTime('2026-10-15T10:00:00Z');});
afterAll(async()=>{await db?.reset();});
function input(fee=10000):MatchInput{return {teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:'2026-10-15T11:00:00Z',endsAt:'2026-10-15T13:00:00Z',playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:0,center:0},baseFeeKrw:fee,policy:{version:'test-A-v1'},meetingPoint:'체육관 입구',rotationDescription:'5대5 교대',guestComposition:'혼자 오는 게스트 환영',captainCoordination:'주장이 팀과 패스를 조율',reservationNote:'로컬 검증이며 실제 대관 아님',expectedPlayingMinutes:60};}
async function publish(fee=10000){const response=await db.request('captain','/api/matches','POST',{...input(fee),requestId:crypto.randomUUID()});expect(response.status).toBe(200);return await response.json() as MatchSummary;}
async function apply(member:'memberA'|'memberB',matchId:string,position='guard',requestId:string=crypto.randomUUID()) {return db.request(member,`/api/matches/${matchId}/applications`,'POST',{position,requestId});}
test('마지막 자리의 동시 수락은 한 사람만 성공한다',async()=>{
 const match=await publish();const a=await (await apply('memberA',match.id)).json() as ApplicationRecord,b=await (await apply('memberB',match.id)).json() as ApplicationRecord;
 const responses=await Promise.all([db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:'accept-a'}),db.request('captain',`/api/applications/${b.id}/accept`,'POST',{requestId:'accept-b'})]);
 expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
 const current=await (await db.request('memberA',`/api/matches/${match.id}`)).json() as MatchSummary;
 expect(current.roster.awaitingPayment).toBe(1);expect(current.roster.availableGuests).toBe(0);expect(current.roster.projectedPlayers).toBe(9);expect(current.roster.minimumPlayerShortage).toBe(1);
});
test('포지션을 자동 변경하지 않으며 동일 신청·수락 재시도는 중복을 만들지 않는다',async()=>{
 const match=await publish();expect((await apply('memberA',match.id,'center')).status).toBe(409);
 const a=await (await apply('memberA',match.id,'guard','same-application')).json() as ApplicationRecord;
 const repeated=await (await apply('memberA',match.id,'guard','same-application')).json() as ApplicationRecord;expect(repeated.id).toBe(a.id);
 const first=await (await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:'same-accept'})).json() as ApplicationRecord;
 const again=await (await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:'same-accept'})).json() as ApplicationRecord;expect(again).toEqual(first);
 expect(first.paymentDeadlineAt).toBe('2026-10-15T10:30:00.000Z');expect(first.terms.startsAt).toBe('2026-10-15T11:00:00.000Z');
});
test('무료 경기 수락은 결제 대기 없이 참가 확정한다',async()=>{
 const match=await publish(0),a=await (await apply('memberA',match.id)).json() as ApplicationRecord;
 const accepted=await (await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 expect(accepted.state).toBe('confirmed');expect(accepted.paymentDeadlineAt).toBeNull();expect(accepted.terms.pricing.paymentAmountKrw).toBe(0);
});
test('서버 기한에 만료된 결제 대기는 자리를 반환하고 신청 대기는 차감하지 않는다',async()=>{
 const match=await publish(),a=await (await apply('memberA',match.id)).json() as ApplicationRecord;
 await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()});
 await db.setLocalDatabaseTime('2026-10-15T10:30:00Z');
 const current=await (await db.request('memberB',`/api/matches/${match.id}`)).json() as MatchSummary;
 expect(current.roster.availableGuests).toBe(1);expect(current.roster.awaitingPayment).toBe(0);
 const own=await (await db.request('memberA','/api/me/applications')).json() as ApplicationRecord[];
 expect(own.find(row=>row.id===a.id)?.state).toBe('expired');
 await db.setLocalDatabaseTime('2026-10-15T10:00:00Z');
});
test('일반 회원은 모집과 수락을 할 수 없다',async()=>{
 expect((await db.request('memberA','/api/matches','POST',{...input(),requestId:crypto.randomUUID()})).status).toBe(403);
});
test('전체 자리가 남아 있어도 마지막 가드 자리의 동시 수락은 한 명만 가능하다',async()=>{
 const response=await db.request('captain','/api/matches','POST',{...input(),existingPlanned:8,guestSlots:{guard:1,forward:1,center:0},requestId:crypto.randomUUID()});
 expect(response.status).toBe(200);const match=await response.json() as MatchSummary;
 const a=await (await apply('memberA',match.id)).json() as ApplicationRecord,b=await (await apply('memberB',match.id)).json() as ApplicationRecord;
 const results=await Promise.all([db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()}),db.request('captain',`/api/applications/${b.id}/accept`,'POST',{requestId:crypto.randomUUID()})]);
 expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 const current=await (await db.request('memberA',`/api/matches/${match.id}`)).json() as MatchSummary;
 expect(current.roster.positionSlots.guard.available).toBe(0);expect(current.roster.positionSlots.forward.available).toBe(1);
});
test('서버 확인 중인 결제는 기한 만료 정리로 자리를 반환하지 않는다',async()=>{
 const match=await publish(),a=await (await apply('memberA',match.id)).json() as ApplicationRecord;
 await db.request('captain',`/api/applications/${a.id}/accept`,'POST',{requestId:crypto.randomUUID()});
 await db.sql`update public.applications set state='verifying_payment' where id=${a.id}`;
 await db.setLocalDatabaseTime('2026-10-15T10:31:00Z');
 const current=await (await db.request('memberB',`/api/matches/${match.id}`)).json() as MatchSummary;
 expect(current.roster.verifyingPayment).toBe(1);expect(current.roster.availableGuests).toBe(0);
 await db.setLocalDatabaseTime('2026-10-15T10:00:00Z');
});
