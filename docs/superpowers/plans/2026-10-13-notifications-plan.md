# D. 알림함·반복 안내·전달 경로 구현 계획

> **에이전트 실행자:** superpowers:subagent-driven-development 또는 superpowers:executing-plans로 체크박스 작업을 순서대로 실행한다.

**목표:** 앱·웹의 공통 알림함과 서버 기준 반복 안내를 만들고, 허용된 한 푸시 경로 및 준비된 중요 안내 채널로 전달한다.

**구조:** 순수 계획 함수가 현재 신청·인원·권한을 읽어 안내를 결정한다. PostgreSQL은 논리 안내·반복 구간·전송 작업의 중복을 막고 Workers는 전송 직전 다시 검사한다. 앱 등록·화면 복귀는 C3가 이 계획의 API를 소비한다.

**기술:** TypeScript, Supabase PostgreSQL/RLS, Workers scheduled handler, Vitest/Playwright, APNs·FCM HTTP v1·Web Push 전송 포트.

**명세:** [상세 설계](../specs/2026-10-13-basketball-matching-design.md), [공통 계획·계약](2026-10-13-basketball-implementation-plan.md), [A. 공통 모집](2026-10-13-core-matching-plan.md). A4 이후 진행하고 결제 확정 이벤트 검증은 B2 이후 연결한다.

## 공통 제약

1. 공통 계획의 제약을 모두 적용하고 `AuthActor.userId`, `DomainEvent`, `AppState`, `CancellationReceipt`, `MatchRoster`를 다시 정의하지 않는다.
2. “참가자는 결제 기한까지 최대 30분, 주장은 새 신청 최초 안내 후 최대 30분, 인원 부족은 시작 전 마지막 30분에 5분 간격.”
3. 같은 논리 안내는 알림함 한 개다. 반복 전송은 안내·milestone·채널별로 멱등이며 앱과 웹을 동시에 선택하지 않는다.
4. “새 신청이 기존 반복 구간을 연장하지 않음, 지연된 반복분을 한꺼번에 보내지 않음.”
5. 결제 확인 중에는 결제를 독촉하지 않는다. 완료·만료·취소·권한 회수는 전송 직전에도 반영한다.
6. 결제 대기 자리·앱 확정 게스트·기존 예정 인원·주최자 현장 기재를 구분하며 부족 인원만으로 자동 취소하지 않는다.
7. 첫 알림톡 업체·계약은 미정이다. `setup_required`는 발송 성공이 아니며 실제 업체 네트워크 통합은 준비 후 별도 진행한다.
8. 푸시에는 일반 안내와 식별자만 넣고 상세는 인증된 서버에서 조회한다. 토큰·구독 키·서버 비밀을 로그·공개 응답에 넣지 않는다.

## 검토 초점

1. 작업 claim 이후 결제 완료·담당자 권한 회수 — 전송이 억제되어야 한다: D2.
2. 같은 기기를 다른 회원이 재등록한 뒤 구회원의 늦은 해지 — 새 연결이 유지되어야 한다: D3.
3. Worker 지연·중복 실행 — 지난 반복분이 몰리지 않고 현재 milestone만 한 번 전달되어야 한다: D1·D2·D4.
4. 시설·팀 이름에 HTML·링크 코드 — 알림함에서 문자로 표시되어야 한다: D2.
5. 임의 Web Push endpoint·미설정 제공자 — 내부 주소 요청과 가짜 성공이 없어야 한다: D3·D4.

## 작업 D1. 서버 시간 반복 계획과 활동 이벤트 소비

**파일:** 생성 `packages/core/src/notifications/contracts.ts`, `packages/core/src/notifications/planner.ts`, `packages/core/tests/notifications-planner.test.ts`, `tests/integration/fixtures/notifications.ts`, `apps/server/src/features/notifications/snapshot.ts`.

**소비 계약:** A4의 `getMatchNotificationContext(matchId: Id): Promise<MatchNotificationContext>`와 `ApplicationRecord.state: AppState`, A5의 `FormatNotice`·`CancellationReceipt`·`reportProceeding(actor,{matchId,reason,requestId})` 기록, B3의 `payment.confirmed`를 포함한 `DomainEvent`를 사용한다. 이벤트 payload를 현재 권한·결제 상태의 근거로 신뢰하지 않는다.

**생성 계약:** 아래 타입·함수를 `notifications/contracts.ts`와 `planner.ts`에서 내보낸다. `loadNotificationSnapshot(matchId: Id): Promise<NotificationSnapshot>`은 현재 DB 값을 조회한다.

    type ReminderWindow = { logicalKey:string; recipientId:Id; matchId:Id;
      kind:'payment'|'captain_pending'|'captain_shortage'; anchorAt:UtcInstant; endsAt:UtcInstant };
    type NotificationSnapshot = MatchNotificationContext & {windows:ReminderWindow[]};
    type NoticeDraft = { logicalKey:string; recipientId:Id; matchId:Id; applicationId:Id|null;
      kind:'application.accepted'|'payment.confirmed'|'match.cancelled'|'format.changed'|'match.proceeding_reported'|'captain.pending'|'captain.shortage';
      text:string; isActionable:boolean; targetVersion:number|null };
    type DeliveryDraft = { logicalKeys:string[]; recipientId:Id; matchId:Id;
      milestone:string; transport:'push'|'alimtalk'; dueAt:UtcInstant; expiresAt:UtcInstant|null };
    type NotificationPlan = { notices:NoticeDraft[]; deliveries:DeliveryDraft[]; windows:ReminderWindow[] };
    planNotifications(event:DomainEvent|null, snapshot:NotificationSnapshot, now:UtcInstant): NotificationPlan;

논리 key는 참가자 결제 대기 `application:<id>:payment`, 확정 `application:<id>:confirmed`, 경기 취소 `match:<id>:cancelled`, 방식 변경 `format:<noticeId>:application:<id>`, 주최자 진행 기재 `host-report:<reportId>:application:<id>`다. 주장 미처리는 `match:<id>:captain:<userId>:pending:<첫신청id>`, 부족은 `match:<id>:captain:<userId>:shortage`로 묶는다.

최초 중요 안내의 milestone은 `initial`, 새 미처리 신청 즉시 안내는 `event:<eventId>`, 반복은 `repeat:<anchorAt부터5n분인UTC시각>`이다. `NotificationPlan.windows`는 새로 만들 구간만 반환하고 저장 함수는 기존 anchor·끝을 덮어쓰지 않는다.

`MatchNotificationContext`의 `match`는 id·startsAt·recruitmentStatus, `applications`는 submittedAt을 포함한 ApplicationRecord 배열이며 roster·activeCaptainIds·formatNotices·cancellations도 공유한다. `hostReports:{id:Id,reportedBy:Id,reportedAt:UtcInstant,reason:string}[]`는 A5의 진행 기재 이력이다. D1의 snapshot 조회는 여기에 D2의 저장된 반복 windows를 합친다.

- [ ] **실패 검증 작성:** 테스트 fixture는 19시 경기·18시 10분 수락·18시 40분 기한으로 만든다. 최초 수락과 15·20·25·30·35분 반복만 계획하고 40분에는 독촉이 없어야 한다. 18시 50분 수락은 55분 반복만 허용한다.

paymentFixture는 acceptedAt 변경 시 calculatePaymentDeadline으로 paymentDeadlineAt 및 window 끝도 다시 계산한다. 18시 12분 수락의 기한은 18시 42분이며 해당 fixture의 기존 18시 40분을 그대로 쓰지 않는다.

        expect(planNotifications(null,paymentFixture(),'2026-10-13T09:15:00Z').deliveries[0].milestone).toBe('repeat:2026-10-13T09:15:00Z');
        expect(planNotifications(null,paymentFixture(),'2026-10-13T09:40:00Z').deliveries).toHaveLength(0);
        expect(planNotifications(null,paymentFixture({state:'verifying_payment'}),'2026-10-13T09:25:00Z').deliveries).toHaveLength(0);
        const shifted=paymentFixture({acceptedAt:'2026-10-13T09:12:00Z'});
        expect(planNotifications(null,shifted,'2026-10-13T09:15:00Z').deliveries).toHaveLength(0);
        expect(planNotifications(null,shifted,'2026-10-13T09:17:00Z').deliveries[0].milestone).toBe('repeat:2026-10-13T09:17:00Z');
        expect(planNotifications(null,shifted,'2026-10-13T09:42:00Z').deliveries).toHaveLength(0);

- [ ] **실패 확인:** `pnpm exec vitest run packages/core/tests/notifications-planner.test.ts`를 실행한다. planner 미정의로 실패해야 한다.
- [ ] **계획 함수 구현:** 결제 반복 anchor는 `acceptedAt`, 끝은 `paymentDeadlineAt`이다. 주장 미처리 anchor는 해당 미처리 구간의 최초 알림함 생성 시각이며 새 신청은 즉시 안내하되 기존 끝을 바꾸지 않는다. 모두 처리된 뒤 새 신청이 생기면 새 구간을 만든다. 부족 안내는 시작 30분 전부터 시작 직전까지다.
- [ ] **지연·중단 규칙 구현:** 반복은 UTC 정각 배수가 아니라 `anchorAt + 5n분`, `n >= 1`, `milestone < endsAt`다. 지연 tick에서는 `n = floor((now-anchorAt)/5분)`의 최신 milestone 하나만 계획하고 이전 구간은 버린다. 결제 완료·취소·만료, 처리 완료, 모집 마감·경기 취소·시작, 부족 해소는 해당 계획을 중단한다.
- [ ] **최초 안내 유효 시각 구현:** 결제 대기 수락의 `initial` push·알림톡도 `expiresAt = paymentDeadlineAt`으로 제한한다. 지연된 initial이 만료 뒤 독촉이 되면 억제한다. 확정·취소·방식 변경 안내는 결제 반복 구간과 분리하여 현재 상태·변경 버전·대상을 재검사한다.
- [ ] **무료 경기 수락 검증:** A4의 baseFeeKrw=0·confirmed 수락 이벤트는 `application:<id>:confirmed` 논리 key로 “참가가 확정되었습니다”를 한 번 안내한다. 결제 기한·결제 반복 window·결제 요청 문구는 만들지 않는다. 무료 확정을 PG 승인 이력으로 생성하지 않는다. 같은 planner 테스트에서 무료 수락의 결제 독촉 0개를 단언한다.
- [ ] **활동 이벤트 연결:** `format.changed`는 `affectedApplicationIds`에만 원래/변경 방식·버전을 안내한다. `application.cancelled`의 방식 변경 불참과 `roster.changed`는 최신 인원을 재조회한다. 결제 대기를 확정 인원으로 세거나 주최자 변경을 자동 동의로 처리하지 않는다.
- [ ] **주최자 진행 안내 연결·검증:** `match.proceeding_reported`에서 최신 `hostReports`를 확인하고 기재 당시 활성 신청자에게 논리 안내·최초 push만 만든다. 이미 취소된 신청자는 제외하고 반복·진행 알림톡은 만들지 않는다. 원래 경기 방식을 유지하며 “주최자가 진행을 안내함”과 담당자·기재 시각·사유를 표시한다. `proceedingFixture()`는 5대5·확정 `active-app`·기취소 `cancelled-app`·진행 기재 `report-1`을 반환하며 같은 planner 검증에 다음 테스트를 추가한다.

        const proceeding=proceedingFixture();
        const plan=planNotifications(proceeding.event,proceeding.snapshot,proceeding.now);
        const notices=plan.notices.filter(n=>n.kind==='match.proceeding_reported');
        expect(notices.map(n=>n.logicalKey)).toEqual(['host-report:report-1:application:active-app']);
        expect(plan.deliveries.filter(d=>d.logicalKeys.includes(notices[0].logicalKey))).toMatchObject([{transport:'push',milestone:'initial'}]);
        expect(proceeding.snapshot.applications[0].terms.playersPerTeam).toBe(5);
        expect(notices[0].text).toContain('주최자가 진행을 안내함');
        expect(notices[0].text).not.toContain('현장 확인 완료');

- [ ] **통과 확인:** 같은 명령으로 22분 결제 완료 뒤 25분 계획 0개, 새 신청 뒤 기존 anchor·끝 유지, 26분 지연 tick에서 15·20분 제외와 25분 1개를 단언한다. 18시 12분 수락은 17·22·27·32·37분만 반복하고 42분은 제외하며 28분 지연 tick은 27분 1개다. 변경 불참 뒤 인원은 갱신하며 기존 8명·확정 2명·대기 2명은 최소 부족 0·목표 부족 2·신규 모집 0이다.
- [ ] **커밋:** 이 작업의 생성 파일만 추가한다.

        git add packages/core/src/notifications/contracts.ts packages/core/src/notifications/planner.ts packages/core/tests/notifications-planner.test.ts tests/integration/fixtures/notifications.ts apps/server/src/features/notifications/snapshot.ts
        git commit -m "알림 반복 구간과 서버 상태 계획 추가"

## 작업 D2. 공통 알림함·권한·작업 claim·묶음과 중복 방지

**파일:** 생성 `supabase/migrations/202610130007_notifications.sql`, `supabase/tests/notifications_permissions.sql`, `apps/server/src/features/notifications/repository.ts`, `apps/server/src/features/notifications/dispatch.ts`, `apps/server/src/features/notifications/handlers.ts`, `apps/web/src/features/notifications/view.ts`, `tests/integration/notifications-dispatch.test.ts`, `tests/e2e/inbox.spec.ts`. 수정 `packages/core/src/notifications/contracts.ts`, `apps/server/src/http/router.ts`, `apps/web/src/app/router.ts`.

**생성 계약:** `InboxNotice`는 `id`, `logicalKey`, `kind`, `matchId`, `applicationId`, `text`, `createdAt`, `readAt: UtcInstant|null`, `isActionable`을 가진다. `listInbox(actor: AuthActor): Promise<InboxNotice[]>`, `getInboxNotice(actor:AuthActor,noticeId:Id):Promise<InboxNotice>`, `markNoticeRead(actor: AuthActor, noticeId: Id): Promise<void>`를 제공한다. notice 클릭은 GET /api/notifications/:noticeId로 본인 기록을 조회하며 다른 회원에게 FORBIDDEN이다.

**작업 계약:** `persistNotificationPlan(eventId:Id|null, plan:NotificationPlan): Promise<void>`, `claimNotificationJobs(workerId:Id, now:UtcInstant): Promise<ClaimedJob[]>`, `dispatchNotificationJob(claim:ClaimedJob, port:DeliveryPort): Promise<DeliveryResult>`를 제공한다. `ClaimedJob`은 `jobId`, `claimToken`, `leaseEndsAt`, `endpointId:Id|null`, `endpointOwnerVersion:number|null`이다. D3 연결 후 push claim은 선택한 endpoint·소유 버전을 작업에 고정한다.

    type DeliveryEnvelope = {jobId:Id; recipientId:Id; transport:'push'|'alimtalk'; endpointId:Id|null;
      noticeIds:Id[]; matchId:Id; applicationId:Id|null; title:string; body:string; expiresAt:UtcInstant|null};
    type DeliveryResult = {status:'provider_accepted'|'failed'|'unknown'|'suppressed'|'setup_required'; providerMessageId:string|null; reason:string|null};
    interface DeliveryPort {send(envelope:DeliveryEnvelope): Promise<DeliveryResult>}

- [ ] **실패 검증 작성:** 같은 활동 이벤트·milestone을 두 번 소비해도 알림함과 채널별 job item은 각각 하나다. 동시 claim에서 한 작업은 한 Worker만 얻고, 같은 경기·주장의 미처리/부족 안내는 한 push job에 묶인다.

        expect(await inboxCount(actor.userId,logicalKey)).toBe(1);
        expect(await jobItemCount(noticeId,'repeat:2026-10-13T09:25:00Z','push')).toBe(1);
        expect((await Promise.all([claimAs('w1'),claimAs('w2')])).flat()).toHaveLength(1);
        await payAfterClaim(claim.jobId);
        expect((await dispatchNotificationJob(claim,fakePort)).status).toBe('suppressed');
        expect(fakePort.send).not.toHaveBeenCalled();

- [ ] **실패 확인:** `pnpm exec supabase test db`와 `pnpm exec vitest run tests/integration/notifications-dispatch.test.ts`를 실행한다. 알림 테이블·claim 함수 미구현으로 실패해야 한다.
- [ ] **DB 기록 구현:** `notifications`는 `(recipient_id,logical_key)`, `notification_job_items`는 `(notification_id,milestone,transport)`, `notification_event_receipts`는 `event_id`를 유일하게 둔다. `notification_reminder_windows`는 anchor·끝을 보존한다. `notification_jobs`는 묶음·상태·claim token·60초 lease·provider 결과를 보존한다. 이벤트 receipt와 계획 저장은 같은 트랜잭션이다.
- [ ] **권한과 API 구현:** 생성·claim·전송 결과는 서버만 변경한다. 회원은 자기 알림함 조회·읽음만 허용한다. `GET /api/notifications/inbox`, `POST /api/notifications/:noticeId/read`는 `requireActor()`의 `userId`를 사용한다. 클라이언트가 수신자나 결제 완료 안내를 임의 생성하면 `FORBIDDEN`이다.
- [ ] **claim·재검증 구현:** DB 잠금과 claim token으로 현재 작업을 한 번만 잡는다. 전송 직전 snapshot·현재 담당 권한·기한·기기 소유권·claim의 endpoint 소유 버전을 다시 검사한다. 버전 불일치 시 이전 lease로 다른 endpoint를 골라 보내지 않는다. 묶음 중 종료된 항목은 제외하고 모두 종료되면 `suppressed`다. 외부 전송은 DB 트랜잭션 밖에서 한다.
- [ ] **전송 결과 구현:** `sending` 전환 뒤 결과가 불명확하면 `unknown`으로 보존하고 같은 milestone을 자동 재전송하지 않는다. 명확한 실패만 유효 시간 내 최신 상태로 재검증 후 재시도한다. 제공자 접수는 `provider_accepted`이며 `readAt`을 변경하지 않는다. 성공 응답 유실을 완료·실패로 추측하지 않는다.

        expect((await listInbox(actor))[0].readAt).toBeNull();
        await revokeCaptainAfterClaim(claim.jobId);
        expect((await dispatchNotificationJob(claim,fakePort)).status).toBe('suppressed');

- [ ] **화면·통과 확인:** DB·통합 검증과 `pnpm exec playwright test tests/e2e/inbox.spec.ts`를 통과시킨다. B의 A 알림 읽음은 거부, claim 뒤 담당 권한 회수는 전송 0회, 앱·웹 같은 회원의 읽음 공유, provider 접수 뒤 `readAt === null`, 악성 이름은 `textContent`로 표시된다.
- [ ] **커밋:** 이 작업의 생성·수정 파일만 추가한다.

        git add supabase/migrations/202610130007_notifications.sql supabase/tests/notifications_permissions.sql apps/server/src/features/notifications/repository.ts apps/server/src/features/notifications/dispatch.ts apps/server/src/features/notifications/handlers.ts apps/web/src/features/notifications/view.ts tests/integration/notifications-dispatch.test.ts tests/e2e/inbox.spec.ts packages/core/src/notifications/contracts.ts apps/server/src/http/router.ts apps/web/src/app/router.ts
        git commit -m "공통 알림함과 멱등 전송 작업 연결"

## 작업 D3. APNs·FCM·웹 푸시 등록과 전송 포트

**파일:** 생성 `supabase/migrations/202610130008_push_endpoints.sql`, `supabase/tests/push_endpoint_permissions.sql`, `apps/server/src/features/notifications/endpoints.ts`, `apps/server/src/features/notifications/push-policy.ts`, `apps/server/src/features/notifications/ports/apns.ts`, `apps/server/src/features/notifications/ports/fcm.ts`, `apps/server/src/features/notifications/ports/webpush.ts`, `apps/web/src/features/notifications/web-push.ts`, `apps/web/public/push-sw.js`, `tests/integration/push-endpoints.test.ts`. 수정 D2의 `handlers.ts`, `dispatch.ts`, `contracts.ts`, `apps/server/src/http/router.ts` 및 `apps/web/src/features/auth/session.ts`.

**C3 소비 계약:** 아래 함수를 그대로 제공하고 HTTP 응답에 등록 정보·토큰을 반환하지 않는다.

    registerPushEndpoint(actor:AuthActor,input:{channel:'apns'|'fcm'|'webpush'; registration:Record<string,string>; deviceId:string}):Promise<{endpointId:Id}>;
    deactivatePushEndpoint(actor:AuthActor,endpointId:Id):Promise<void>;
    selectPushEndpoint(userId:Id):Promise<{endpointId:Id; channel:'apns'|'fcm'|'webpush'}|null>;
    validateWebPushEndpoint(endpoint:string,allowedHosts:readonly string[]):URL;

**전송 계약:** `ApnsPushPort`, `FcmPushPort`, `WebPushPort`는 D2의 `DeliveryPort`를 구현한다. native iOS 등록은 `channel:'apns', registration:{token}`, Android는 `channel:'fcm', registration:{token}`이다. web은 `{endpoint,p256dh,auth}`이며 키는 base64url 형식을 검증한다. [Capacitor 8 공식 토큰 구분](https://capacitorjs.com/docs/apis/push-notifications#token).

- [ ] **실패 검증 작성:** 등록·해지의 소유권, 같은 기기/endpoint의 단일 소유권, APNs·FCM 어댑터 선택, 앱 우선·웹 대체 한 경로, 잘못된 웹 endpoint와 비밀 비노출을 작성한다.

        const first=await registerPushEndpoint(actorA,iosRegistration);
        const next=await registerPushEndpoint(actorB,iosRegistration);
        await expect(deactivatePushEndpoint(actorA,first.endpointId)).rejects.toMatchObject({code:'FORBIDDEN'});
        expect(await endpointOwner(next.endpointId)).toBe(actorB.userId);
        expect(await selectedChannel(actorB.userId)).toBe('apns');
        expect(()=>validateWebPushEndpoint('https://127.0.0.1/push',['fcm.googleapis.com'])).toThrow('INVALID_PUSH_ENDPOINT');

- [ ] **실패 확인:** `pnpm exec supabase test db`와 `pnpm exec vitest run tests/integration/push-endpoints.test.ts`를 실행한다. endpoint 정책·전송 포트 미구현으로 실패해야 한다.
- [ ] **등록 API 구현:** `POST /api/push-endpoints`, `DELETE /api/push-endpoints/:endpointId`에서 소유자를 `actor.userId`로 결정한다. DB `push_endpoints`는 채널·기기·등록 fingerprint·현재 소유자·소유 버전·활성/해지 시각을 보존한다. 같은 기기 또는 endpoint 재등록은 이전 연결을 원자적으로 해지하고 소유 버전을 올린다. 구회원의 늦은 DELETE는 새 소유 연결을 끄지 못한다.

같은 endpoint의 소유권 이전은 동일 `endpointId`를 유지하고 소유 버전을 올린다. 같은 회원이 해지 뒤 재등록해도 소유 버전을 올리며 이전 lease는 사용할 수 없다. 같은 기기에서 토큰이 바뀌면 이전 endpoint를 비활성화한다. 전송 작업은 claim 당시 소유자·버전과 현재 값을 함께 비교한다.

- [ ] **입력·출력 검증 구현:** Web Push는 공개 HTTPS·443·서버의 지원 푸시 서비스 host 허용목록만 허용한다. localhost·IP literal·userinfo·미승인 host·다른 port를 거부하고 전송 fetch는 redirect를 따라가지 않는다. 테스트 허용 URL은 `https://fcm.googleapis.com/wp/test-token`, 거부 예시는 `http://fcm.googleapis.com/push`, `https://user@fcm.googleapis.com/push`, `https://example.com/push`다. 실제 허용 host는 지원 브라우저의 공식 정보와 테스트 구독으로 확인해 서버 설정에 고정한다.
- [ ] **경로·전송 포트 구현:** 허용·활성 설치 앱을 우선하고 없으면 허용 웹 endpoint 하나를 선택한다. APNs topic·sandbox/production은 서버 설정, FCM은 서버 OAuth 자격, 웹은 서버 VAPID·구독 암호화로 전송한다. 등록 키·토큰·서비스 계정·APNs 비밀은 비공개 저장과 redaction을 적용하고 알림함·등록 응답에 포함하지 않는다.
- [ ] **로그아웃·웹 연결 구현:** 로그인 회원 변경 전 endpoint 해지를 요청한다. offline이면 이전 소유자의 해지 요청을 대기시키고 로컬 알림을 정리하며 새 계정 상세를 이전 알림에서 열지 않는다. 웹은 권한 거부·해지에서 재등록하지 않고 Service Worker 알림 클릭은 현재 인증으로 대상 상태를 조회한다. C3도 같은 API·일반 안내 payload를 사용한다.

푸시 `title`은 `농구 매칭`, `body`는 `새 안내가 있습니다. 앱 또는 웹에서 확인해 주세요.`다. payload는 `noticeIds`·`matchId`·`applicationId`만 담고 담당자 연락 경로·위치 조건·참가자 이름은 담지 않는다.

- [ ] **통과 확인:** DB·통합 검증에서 claim 뒤 endpoint 소유자 변경 시 이전 회원 전송 0회, 최신 소유자 유지, 앱+웹 동시 전달 0회, 웹 404/410 후 endpoint 비활성, raw 토큰·구독 키가 로그와 공개 JSON에 없음이 통과해야 한다. 기기 키 미설정은 `setup_required`로 남기며 실제 수신은 C3에서 별도 검증한다.
- [ ] **커밋:** 이 작업의 생성·수정 파일만 추가한다.

        git add supabase/migrations/202610130008_push_endpoints.sql supabase/tests/push_endpoint_permissions.sql apps/server/src/features/notifications/endpoints.ts apps/server/src/features/notifications/push-policy.ts apps/server/src/features/notifications/ports/apns.ts apps/server/src/features/notifications/ports/fcm.ts apps/server/src/features/notifications/ports/webpush.ts apps/web/src/features/notifications/web-push.ts apps/web/public/push-sw.js tests/integration/push-endpoints.test.ts apps/server/src/features/notifications/handlers.ts apps/server/src/features/notifications/dispatch.ts packages/core/src/notifications/contracts.ts apps/server/src/http/router.ts apps/web/src/features/auth/session.ts
        git commit -m "채널별 푸시 등록과 계정 해지 및 전송 포트 추가"

## 작업 D4. 알림톡 준비 상태·정기 Worker·통합 검증

**파일:** 생성 `apps/server/src/features/notifications/ports/disabled-alimtalk.ts`, `apps/server/src/jobs/notifications.ts`, `tests/integration/notifications-worker.test.ts`, `tests/e2e/notifications-flow.spec.ts`, `docs/qa/notifications.md`. 수정 `apps/server/src/index.ts`, `apps/server/wrangler.jsonc`, D2의 `dispatch.ts`, `packages/core/src/notifications/contracts.ts`.

**생성 계약:** `DisabledAlimtalkAdapter implements DeliveryPort`, `runNotificationTick(now:UtcInstant, workerId:Id):Promise<TickReport>`를 제공한다. `TickReport`는 `consumedEvents`, `claimedJobs`, `providerAccepted`, `suppressed`, `setupRequired`, `failed`, `unknown`의 정수 건수다. 외부 수신·읽음을 합쳐 성공 건수로 보고하지 않는다.

- [ ] **실패 검증 작성:** 서버 Worker 두 회차 동시 실행·지연 tick·결제와 변경 불참 후 반복 중단·알림톡 미설정·명확한 실패 재시도를 통합 검증한다.

        expect((await new DisabledAlimtalkAdapter().send(importantEnvelope)).status).toBe('setup_required');
        expect(alimtalkNetworkSpy).not.toHaveBeenCalled();
        await Promise.all([runNotificationTick(now,'w1'),runNotificationTick(now,'w2')]);
        expect(await pushesForMilestone(milestone)).toHaveLength(1);
        expect(await alimtalkJobsForReminder(milestone)).toHaveLength(0);

- [ ] **실패 확인:** `pnpm exec vitest run tests/integration/notifications-worker.test.ts`를 실행한다. scheduled 작업·미설정 어댑터 미구현으로 실패해야 한다.
- [ ] **알림톡 어댑터 구현:** 수락·참가 확정·경기 취소·경기 방식 변경의 최초 중요 안내만 채널별 한 번 계획한다. 반복 독촉·주장 반복 안내에는 알림톡 job을 만들지 않는다. 최초 기본 어댑터는 네트워크를 호출하지 않고 `{status:'setup_required', providerMessageId:null, reason:'ALIMTALK_PROVIDER_NOT_CONFIGURED'}`를 반환한다.
- [ ] **정기 Worker 구현:** `wrangler.jsonc`의 `triggers.crons`를 `['* * * * *']`로 설정하고 하나의 `scheduled`에서 A4 expireUnpaidApplications() → B3 runPaymentTick() → B4 runRefundTick() → runNotificationTick() 순서로 실행한다. 각 처리 오류는 상태·재시도 기록을 남기고 다른 작업이 영구 중단되지 않게 한다. DB server_now()로 현재 시각을 읽으며 HTTP 사용자의 now를 신뢰하지 않는다. 알림 tick은 미소비 `activity_records`·현재 열린 반복 구간·마지막 30분 경기 후보를 읽고 D1 계획 → D2 저장/claim/재검증 → D3/D4 포트 순서로 처리한다. [Workers Cron 공식 문서](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- [ ] **예외·결과 기록 구현:** 중복 이벤트는 receipt로 제외하고 지연된 반복 milestone은 쌓아서 보내지 않는다. 처리 상태가 `setup_required`인 작업은 설정 준비 상태로 남겨 매 분 성공처럼 재기록하지 않는다. 일시적 실패는 남은 유효 시간·현재 권한을 재검사하고, `unknown`은 동일 milestone 자동 재전송에서 제외한다. 반복 종료 후 알림함·미처리 신청 표시는 유지한다.
- [ ] **로컬 통합 통과 확인:** `pnpm exec supabase test db`, `pnpm exec vitest run packages/core/tests/notifications-planner.test.ts tests/integration/notifications-dispatch.test.ts tests/integration/push-endpoints.test.ts tests/integration/notifications-worker.test.ts`, `pnpm exec playwright test tests/e2e/inbox.spec.ts tests/e2e/notifications-flow.spec.ts`를 통과시킨다. 완료·만료·취소·확인 중·권한 회수 후 독촉 0회, 주장 안내 묶음, 변경 불참 뒤 부족 인원 재판정, 앱·웹 공통 알림함, 5분 경계·최대 30분을 모두 단언한다.
- [ ] **외부 검증 기록:** `pnpm --filter @basket/server exec wrangler dev --test-scheduled` 후 로컬 `/__scheduled`를 호출해 실제 handler 연결을 확인한다. 설정된 테스트 기기·브라우저에서는 APNs·FCM·Web Push 제공자 접수와 기기 표시·클릭을 구분해 `docs/qa/notifications.md`에 기록한다. 키·계약이 없으면 준비 필요로 남기며 알림톡 실제 업체 발송은 이 작업 완료로 주장하지 않는다.

        curl 'http://127.0.0.1:8787/__scheduled?cron=%2A%20%2A%20%2A%20%2A%20%2A'

로컬 tick 연결 확인은 네트워크 제공자 수신 검증과 별도로 기록한다. 로그에는 이벤트·작업 ID, 익명화한 오류 코드, 채널별 처리 상태만 남긴다.

- [ ] **커밋:** 이 작업의 생성·수정 파일만 추가한다.

        git add apps/server/src/features/notifications/ports/disabled-alimtalk.ts apps/server/src/jobs/notifications.ts tests/integration/notifications-worker.test.ts tests/e2e/notifications-flow.spec.ts docs/qa/notifications.md apps/server/src/index.ts apps/server/wrangler.jsonc apps/server/src/features/notifications/dispatch.ts packages/core/src/notifications/contracts.ts
        git commit -m "정기 알림 작업과 알림톡 준비 상태 통합 검증"

## 완료·연결 기준

1. D1~D4는 서버 시간·DB/RLS·fake 제공자 결과로 독립 검증되며 B의 결제 이벤트와 A5의 변경 불참 receipt를 재사용한다.
2. C3는 등록·해지 API와 알림함 API를 소비하고 실제 iOS·Android 권한·토큰·앱 종료 후 클릭을 확인한다. 브라우저 검증으로 기기 검증을 대신하지 않는다.
3. 중요 안내의 논리 기록·푸시 접수·알림톡 준비 상태·읽음은 서로 다른 근거다. 외부 미설정과 자동 검증 통과를 같은 완료 상태로 표시하지 않는다.

**세 줄 요약**

1. 서버 상태와 정해진 5분·30분 구간으로 알림을 계획하고 같은 안내의 알림함은 하나로 유지한다.
2. claim 뒤에도 결제·권한·기기 소유권을 재검사하며 APNs·FCM·웹 푸시 중 허용된 한 경로로 보낸다.
3. 알림톡은 중요 안내의 준비 상태만 연결하고 실제 업체 계약·발송 검증은 준비 후 진행한다.
