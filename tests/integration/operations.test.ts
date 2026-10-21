import {beforeAll,afterAll,test,expect} from 'vitest';
import {createDatabaseFixture} from './fixtures/database';
import type {MatchSummary,ApplicationRecord,FormatNotice,CancellationReceipt} from '@basket/core/contracts';
let db:Awaited<ReturnType<typeof createDatabaseFixture>>,match:MatchSummary,app:ApplicationRecord;
beforeAll(async()=>{
 db=await createDatabaseFixture();await db.sql`update public.teams set status='approved' where id=${db.teamId}`;await db.setLocalDatabaseTime('2026-10-15T10:00:00Z');
 const response=await db.request('captain','/api/matches','POST',{teamId:db.teamId,facilityId:'b0000000-0000-4000-a000-000000000001',startsAt:'2026-10-15T11:00:00Z',endsAt:'2026-10-15T13:00:00Z',playersPerTeam:5,teamCount:2,existingPlanned:9,guestSlots:{guard:1,forward:1,center:0},baseFeeKrw:10000,policy:{version:'test-B-v1'},meetingPoint:'입구',rotationDescription:'5대5',guestComposition:'게스트 함께',captainCoordination:'주장 조율',reservationNote:'로컬 검증',expectedPlayingMinutes:null,requestId:crypto.randomUUID()});
 match=await response.json() as MatchSummary;
 app=await (await db.request('memberA',`/api/matches/${match.id}/applications`,'POST',{position:'guard',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 await db.request('captain',`/api/applications/${app.id}/accept`,'POST',{requestId:crypto.randomUUID()});
});afterAll(async()=>{await db?.reset();});
test('주최자 진행 안내는 신청 인원이나 현장 참석을 바꾸지 않는다',async()=>{
 const response=await db.request('captain',`/api/matches/${match.id}/proceeding`,'POST',{reason:'최소 인원이 부족해도 기존 방식으로 진행 예정',requestId:crypto.randomUUID()});
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({source:'host_report'});
 const current=await (await db.request('memberA',`/api/matches/${match.id}`)).json() as MatchSummary;
 expect(current.roster.confirmedGuests).toBe(0);expect(current.roster.projectedPlayers).toBe(9);
});
test('4대4 안내는 당시 활성 신청만 대상으로 하고 불참은 원래 조건의 취소 접수를 남긴다',async()=>{
 const b=await (await db.request('memberB',`/api/matches/${match.id}/applications`,'POST',{position:'forward',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 expect((await db.request('memberB',`/api/applications/${b.id}/cancel`,'POST',{cause:'personal',formatChangeId:null,requestId:crypto.randomUUID()})).status).toBe(200);
 const response=await db.request('captain',`/api/matches/${match.id}/format-notices`,'POST',{playersPerTeam:4,reason:'인원 부족',requestId:crypto.randomUUID()});expect(response.status).toBe(200);
 const notice=await response.json() as FormatNotice;expect(notice.affectedApplicationIds).toContain(app.id);expect(notice.affectedApplicationIds).not.toContain(b.id);
 const declined=await db.request('memberA',`/api/applications/${app.id}/cancel`,'POST',{cause:'format_change_declined',formatChangeId:notice.id,requestId:'decline-change'});
 expect(declined.status).toBe(200);const receipt=await declined.json() as CancellationReceipt;expect(receipt.cause).toBe('format_change_declined');expect(receipt.terms.playersPerTeam).toBe(5);expect(receipt.terms.pricing.platformRateBps).toBe(0);
 const current=await (await db.request('memberB',`/api/matches/${match.id}`)).json() as MatchSummary;expect(current.playersPerTeam).toBe(4);expect(current.roster.awaitingPayment).toBe(0);expect(current.roster.availableGuests).toBe(2);
});
test('권한이 중단된 담당자는 변경할 수 없고 운영자는 기존 경기 취소를 처리할 수 있다',async()=>{
 await db.sql`update public.teams set status='suspended' where id=${db.teamId}`;
 expect((await db.request('captain',`/api/matches/${match.id}/cancel`,'POST',{requestId:crypto.randomUUID()})).status).toBe(403);
 const result=await db.request('operator',`/api/matches/${match.id}/cancel`,'POST',{requestId:crypto.randomUUID()});expect(result.status).toBe(200);
 const receipts=await result.json() as CancellationReceipt[];expect(receipts.some(r=>r.applicationId===app.id && r.cause==='host_cancelled')).toBe(true);
});
test('일반 회원은 운영 숨김 경로로 모집글을 변경하지 못한다',async()=>expect((await db.request('memberA',`/api/operator/matches/${match.id}/moderation`,'POST',{action:'hide',reason:'임의 숨김',requestId:crypto.randomUUID()})).status).toBe(403));
test('마지막 담당자는 미처리 미래 경기로부터 탈퇴할 수 없다',async()=>{
 await db.sql`update public.teams set status='approved' where id=${db.teamId}`;await db.sql`update public.matches set recruitment_status='open' where id=${match.id}`;
 const result=await db.request('captain','/api/me/deletion','POST',{});expect(result.status).toBe(200);expect(await result.json()).toMatchObject({status:'needs_resolution'});
 expect((await db.sql`select deleted_at from public.profiles where id=${db.captain.userId}`)[0]!.deleted_at).toBeNull();
});
test('원래 조건을 덮지 않고 변경 후 계속 참가를 확인한 신청만 새 수락이 가능하다',async()=>{
 const b=await (await db.request('memberB',`/api/matches/${match.id}/applications`,'POST',{position:'forward',requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 const notice=await (await db.request('captain',`/api/matches/${match.id}/format-notices`,'POST',{playersPerTeam:3,reason:'인원 재조정',requestId:crypto.randomUUID()})).json() as FormatNotice;
 expect((await db.request('captain',`/api/applications/${b.id}/accept`,'POST',{requestId:crypto.randomUUID()})).status).toBe(409);
 expect((await db.request('memberB',`/api/applications/${b.id}/format-acknowledgement`,'POST',{noticeId:notice.id,requestId:crypto.randomUUID()})).status).toBe(200);
 const accepted=await (await db.request('captain',`/api/applications/${b.id}/accept`,'POST',{requestId:crypto.randomUUID()})).json() as ApplicationRecord;
 expect(accepted.state).toBe('awaiting_payment');expect(accepted.terms.playersPerTeam).toBe(4);
});
test('시작 이후 변경 불참은 개인 사정 취소로 자동 처리하지 않는다',async()=>{
 const own=await (await db.request('memberB','/api/me/format-notices')).json() as {applicationId:string;notice:FormatNotice}[];
 const latest=own.find(row=>row.notice.currentPlayersPerTeam===3)!;
 await db.setLocalDatabaseTime('2026-10-15T11:00:00Z');
 const response=await db.request('memberB',`/api/applications/${latest.applicationId}/cancel`,'POST',{cause:'format_change_declined',formatChangeId:latest.notice.id,requestId:crypto.randomUUID()});
 expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'LATE_CHANGE_NEEDS_REVIEW'});
 await db.setLocalDatabaseTime('2026-10-15T10:00:00Z');
});
test('미처리 참가가 없는 회원은 인증 계정을 정리하고 처리 기록의 내부 ID는 보존한다',async()=>{
 const result=await db.request('memberA','/api/me/deletion','POST',{});expect(result.status).toBe(200);expect(await result.json()).toEqual({status:'completed'});
 const profile=(await db.sql`select auth_id,deleted_at,nickname from public.profiles where id=${db.memberA.userId}`)[0]!;
 expect(profile.auth_id).toBeNull();expect(profile.deleted_at).not.toBeNull();expect(profile.nickname).toBe('탈퇴한 회원');
 expect((await db.sql`select id from public.applications where id=${app.id}`)).toHaveLength(1);
 expect((await db.request('memberA','/api/me')).status).toBe(401);
});
