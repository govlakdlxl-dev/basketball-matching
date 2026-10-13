import {test,expect} from 'vitest';
import {planNotifications} from '../src/notifications/planner';
import {paymentFixture,pendingFixture,proceedingFixture,event} from '../../../tests/integration/fixtures/notifications';
test('수락 최초 안내는 결제 기한까지이며 5분 간격을 따른다',()=>{
 const s=paymentFixture(),first=planNotifications(event('application.accepted'),s,'2026-10-13T09:10:00Z');expect(first.notices[0]?.logicalKey).toBe('application:app-1:payment');expect(first.deliveries.map(d=>d.transport).sort()).toEqual(['alimtalk','push']);expect(first.deliveries.every(d=>d.expiresAt==='2026-10-13T09:40:00Z')).toBe(true);
 for(const minute of [15,20,25,30,35])expect(planNotifications(null,s,`2026-10-13T09:${minute}:00Z`).deliveries[0]?.milestone).toBe(`repeat:2026-10-13T09:${minute}:00Z`);
 expect(planNotifications(null,s,'2026-10-13T09:40:00Z').deliveries).toHaveLength(0);
});
test('수락 시각이 12분이면 17·22·27·32·37분만 반복하고 늦은 tick은 최신 한 개다',()=>{
 const s=paymentFixture({acceptedAt:'2026-10-13T09:12:00Z'});expect(planNotifications(null,s,'2026-10-13T09:15:00Z').deliveries).toHaveLength(0);
 for(const minute of [17,22,27,32,37])expect(planNotifications(null,s,`2026-10-13T09:${minute}:00Z`).deliveries[0]?.milestone).toBe(`repeat:2026-10-13T09:${minute}:00Z`);
 expect(planNotifications(null,s,'2026-10-13T09:28:00Z').deliveries.map(d=>d.milestone)).toEqual(['repeat:2026-10-13T09:27:00Z']);expect(planNotifications(null,s,'2026-10-13T09:42:00Z').deliveries).toHaveLength(0);
});
test.each(['verifying_payment','confirmed','cancelled','expired','rejected'] as const)('%s 상태는 결제를 독촉하지 않는다',state=>{
 expect(planNotifications(null,paymentFixture({state}),'2026-10-13T09:25:00Z').deliveries).toHaveLength(0);
});
test('경기 시작까지 짧게 남은 수락은 55분 반복만 허용한다',()=>{const s=paymentFixture({acceptedAt:'2026-10-13T09:50:00Z'});expect(planNotifications(null,s,'2026-10-13T09:55:00Z').deliveries).toHaveLength(1);expect(planNotifications(null,s,'2026-10-13T10:00:00Z').deliveries).toHaveLength(0);});
test('무료 수락은 참가 확정 한 건과 결제 독촉 없는 중요 안내다',()=>{
 const s=paymentFixture({state:'confirmed',paymentDeadlineAt:null});s.applications[0]!.terms.pricing.paymentAmountKrw=0;s.windows=[];
 const p=planNotifications(event('application.accepted'),s,'2026-10-13T09:10:00Z');expect(p.notices).toMatchObject([{logicalKey:'application:app-1:confirmed',text:expect.stringContaining('참가가 확정되었습니다')}]);expect(p.windows).toHaveLength(0);expect(p.notices[0]?.text).not.toContain('결제');
});
test('새 신청은 즉시 안내하지만 기존 주장 반복 구간을 연장하지 않는다',()=>{
 const s=pendingFixture(),p=planNotifications(event('application.submitted'),s,'2026-10-13T09:10:00Z');expect(p.windows).toHaveLength(1);s.windows=p.windows;
 s.applications.push({...s.applications[0]!,id:'app-2',applicantId:'guest-2',submittedAt:'2026-10-13T09:20:00Z'});
 const added=planNotifications({...event('application.submitted','app-2'),id:'event-2',occurredAt:'2026-10-13T09:20:00Z'},s,'2026-10-13T09:20:00Z');expect(added.windows).toHaveLength(0);expect(s.windows[0]?.endsAt).toBe('2026-10-13T09:40:00Z');expect(added.deliveries.some(d=>d.milestone==='event:event-2')).toBe(true);
 expect(planNotifications(null,s,'2026-10-13T09:41:00Z').deliveries.filter(d=>d.logicalKeys.includes(s.windows[0]!.logicalKey))).toHaveLength(0);s.applications=[];expect(planNotifications(null,s,'2026-10-13T09:25:00Z').deliveries).toHaveLength(0);
});
test('마지막 30분의 최소 부족과 모집 목표 부족은 구분한다',()=>{
 const s=paymentFixture({state:'confirmed'});s.windows=[];s.activeCaptainIds=['captain-1'];
 expect(planNotifications(null,s,'2026-10-13T09:29:59Z').deliveries).toHaveLength(0);const p=planNotifications(null,s,'2026-10-13T09:30:00Z');expect(p.notices[0]?.text).toContain('진행 최소 인원은 확보');expect(p.notices[0]?.text).toContain('게스트 목표 2명');
 s.roster.minimumPlayerShortage=1;expect(planNotifications(null,s,'2026-10-13T09:35:00Z').notices[0]?.text).toContain('최소 인원 1명 부족');s.roster.minimumPlayerShortage=0;s.roster.guestTargetShortage=0;expect(planNotifications(null,s,'2026-10-13T09:35:00Z').deliveries).toHaveLength(0);
});
test('변경 안내는 당시 대상에게만 원래 방식과 새 방식을 보여준다',()=>{
 const s=paymentFixture();s.windows=[];s.applications.push({...s.applications[0]!,id:'non-target',applicantId:'other'});s.formatNotices=[{id:'notice-1',matchId:'match-1',version:2,previousPlayersPerTeam:5,currentPlayersPerTeam:4,actorId:'captain',announcedAt:'2026-10-13T09:20:00Z',affectedApplicationIds:['app-1'],reason:'인원 부족'}];
 const p=planNotifications({...event('format.changed',null,{noticeId:'notice-1'}),occurredAt:'2026-10-13T09:20:00Z'},s,'2026-10-13T09:20:00Z');expect(p.notices.filter(n=>n.kind==='format.changed').map(n=>n.recipientId)).toEqual(['guest-1']);expect(p.notices.find(n=>n.kind==='format.changed')?.text).toContain('5대5 → 4대4');expect(s.applications[0]?.terms.playersPerTeam).toBe(5);
});
test('주최자 진행 기재는 활성 대상의 최초 push만 만들고 현장 검증으로 표현하지 않는다',()=>{
 const s=proceedingFixture(),p=planNotifications(s.event,s.snapshot,s.now),notices=p.notices.filter(n=>n.kind==='match.proceeding_reported');expect(notices.map(n=>n.logicalKey)).toEqual(['host-report:report-1:application:active-app']);expect(p.deliveries.filter(d=>d.logicalKeys.includes(notices[0]!.logicalKey))).toMatchObject([{transport:'push',milestone:'initial'}]);expect(notices[0]?.text).toContain('주최자가 진행을 안내함');expect(notices[0]?.text).not.toContain('현장 확인 완료');expect(s.snapshot.applications[0]?.terms.playersPerTeam).toBe(5);
});
test('경기 취소는 결제 반복과 분리하고 마감·시작은 반복을 종료한다',()=>{
 const s=paymentFixture({state:'cancelled'});s.match.recruitmentStatus='cancelled';const p=planNotifications(event('match.cancelled',null),s,'2026-10-13T09:25:00Z');expect(p.notices.map(n=>n.logicalKey)).toEqual(['match:match-1:cancelled']);expect(p.deliveries.map(d=>d.milestone)).toEqual(['initial','initial']);s.match.recruitmentStatus='closed';expect(planNotifications(null,s,'2026-10-13T09:25:00Z').deliveries).toHaveLength(0);
});
