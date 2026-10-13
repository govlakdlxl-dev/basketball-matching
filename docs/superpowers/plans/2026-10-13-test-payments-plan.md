# B. 테스트 결제·누적 환불 구현 계획

> **에이전트 실행자:** superpowers:subagent-driven-development 또는 superpowers:executing-plans로 B1~B4를 순서대로 실행한다. 체크박스로 진행을 기록한다.

**목표:** 초기 플랫폼 수수료 0%의 테스트 결제를 서버 기한·자리 상태에 연결하고, 부분 환불 이후 전액 목표까지 중복 없이 처리한다.

**구조:** 금액·정책 계산은 packages/core, 승인·조회·환불 작업은 Workers, 접수 시각·멱등 키·원자적 자리 전이·원장은 PostgreSQL이 담당한다. PG 호출은 DB 트랜잭션 밖에서 수행하고 결과 불명확과 확정 실패를 구분한다.

**기술:** TypeScript, Vitest, Supabase PostgreSQL/pgTAP, Workers, 토스 테스트 환경용 어댑터.

**명세:** [승인된 상세 설계](../specs/2026-10-13-basketball-matching-design.md), [공통 계획·계약](2026-10-13-basketball-implementation-plan.md), [A. 공통 모집](2026-10-13-core-matching-plan.md). B1은 A1, B2~B3은 A4, B4는 A5 완료 후 실행한다.

## 공통 제약

1. “초기 플랫폼 수수료는 0%로 두고 이용을 검증한다.” 초기 주문은 initial_test_order·0bps만 허용한다. 500/1000bps는 calculator_only 계산 검증이다.
2. “모든 금액은 원 단위 정수다.” 공통 Won 검증과 bigint 중간 계산을 사용하며 음수·소수·안전 정수 초과를 거부한다.
3. “PG 비용은 확인 상태·부담 정책을 분리하고 미확인은 null과 사유로 둔다.” 실제 PG 비용·은행 지급·실결제 경로를 구현하지 않는다.
4. “결제 유예는 수락 후 30분과 경기 시작 중 빠른 시각이다.” 최초 유효 서버 승인 접수는 기한보다 엄격히 이르며, PG 결과 지연만으로 만료하지 않는다.
5. “주문마다 한 환불 요청만 처리 중으로 둔다.” 누적 목표를 보존하고 완료액을 뺀 차액만 처리한다. 결과 불명확이면 먼저 조회한다.
6. 공통 AuthActor.userId·AppState·PricingSnapshot의 *Krw·CancellationReceipt를 소비한다. getPaymentContext·cancelApplication·cancelMatch는 A4/A5 소유이며 다시 구현하지 않는다.
7. DB 잠금은 모집글→신청→주문→환불 순서다. 자리 반환과 환불 상태를 분리하며 취소 전이·환불 의도는 같은 트랜잭션에 남긴다.
8. 정책 A/B와 시간 경계는 테스트 전용이다. UTC 저장·한국 시간 표시·신청 당시 terms 보존·회원 소유권·비밀키 비노출을 적용한다.

## 검토 초점

1. 유효 승인 접수의 응답 유실·기한 후 결과 — verifying_payment 자리를 보류하고 같은 승인 시도를 재사용한다: B2~B3.
2. PG 환불 성공 뒤 서버 응답 유실 — 조회 증거로 한 번 반영하고 불명확한 호출을 무조건 재전송하지 않는다: B3~B4.
3. 부분 환불 중 팀 취소·전액 목표 재시도 — 진행 작업은 하나, 목표만 상향하며 총환불이 결제액을 넘지 않는다: B4.
4. 방식 변경 공지 전 취소·공지 후 일부 환불 — 해당 공지의 대상 신청만 전액 목표 자격을 갖는다: B4.
5. 무료 참가비·계산 전용 가격·키 변경 — 무료 경기의 PG 호출과 미래 수수료 주문·실결제 전환을 차단한다: B1~B3.

## 작업 B1. 누적 환불·시간 정책 순수 계산

**파일:** 수정 packages/core/src/{contracts.ts,money.ts}, packages/core/tests/money.test.ts. 생성 packages/core/src/refunds.ts, packages/core/tests/refunds.test.ts.

**소비:** A1의 quoteInitialTest(baseFeeKrw: Won), quoteFutureExample(baseFeeKrw: Won, rateBps: 500 | 1000), PricingSnapshot·PolicySnapshot·UtcInstant·Won. 기존 가격 함수를 복제하지 않는다.

**생산:** 아래 타입은 contracts.ts, 함수는 refunds.ts에 둔다.

```ts
type RefundRatioBps = 0 | 5000 | 10000;
type RefundTotals = { refundedKrw: Won; platformReturnedKrw: Won; teamDeductedKrw: Won };
type RefundDelta = { kind: 'none' | 'refund'; target: RefundTotals; additional: RefundTotals };
resolveRefundRatio(policy: PolicySnapshot, startsAt: UtcInstant, receivedAt: UtcInstant): RefundRatioBps;
calculateRefundTarget(pricing: PricingSnapshot, ratioBps: RefundRatioBps): RefundTotals;
calculateRefundDelta(target: RefundTotals, completed: RefundTotals): RefundDelta;
```

- [ ] **실패 검증:** refunds.test.ts에 정책 A의 2시간±1ms, 정책 B의 24시간·2시간±1ms, 처리 지연 시 고정 receivedAt, 목표 하향·0원·안전 정수 초과를 작성한다. money.test.ts에는 0/5/10%의 금액 보존을 추가한다.

        expect(resolveRefundRatio({version:'test-B-v1'},start,twoHoursBefore)).toBe(5000);
        expect(resolveRefundRatio({version:'test-B-v1'},start,oneMsAfterTwoHours)).toBe(0);
        expect(calculateRefundTarget(quoteInitialTest(10000),5000)).toEqual({refundedKrw:5000,platformReturnedKrw:0,teamDeductedKrw:5000});
        expect(calculateRefundDelta(full,half).additional.refundedKrw).toBe(5000);
        expect(calculateRefundDelta(half,full).kind).toBe('none');

- [ ] **실패 확인:** pnpm exec vitest run packages/core/tests/money.test.ts packages/core/tests/refunds.test.ts를 실행한다. 새 함수 미정의 또는 누적 차액 단언 실패를 확인한다.
- [ ] **구현:** 정책 A는 남은 시간 ≥2시간 100%, 미만 0%; B는 ≥24시간 100%, ≥2시간 50%, 미만 0%로 고정한다. 누적 목표는 총결제액·전체 플랫폼 수수료에 각각 비율을 적용해 내림하고 팀 차감은 두 금액의 차다. 달성·하향 목표는 target에 기존 완료액을 유지하고 additional은 세 필드 모두 0이다. 비일관 원장은 오류로 거부한다.
- [ ] **통과 확인:** 같은 명령이 모두 PASS여야 한다. 9,900원·5%는 결제 10,147/팀 9,652/플랫폼 495원, 10,000원·10%는 10,500/9,500/1,000원이다. 모든 비율에서 \(P-R=(T-R_T)+(F-R_F)\)를 단언하고 PG 미확인 값은 null을 유지한다.
- [ ] **커밋:** 아래 관련 파일만 포함한다.

        git add packages/core/src/contracts.ts packages/core/src/money.ts packages/core/src/refunds.ts packages/core/tests/money.test.ts packages/core/tests/refunds.test.ts
        git commit -m "테스트 정책과 누적 환불 차액 계산 추가"

## 작업 B2. 테스트 주문·기한 내 승인 접수

**파일:** 수정 packages/core/src/contracts.ts, apps/server/src/http/router.ts. 생성 supabase/migrations/202610130004_test_orders.sql, supabase/tests/test_orders.sql, apps/server/src/features/payments/{commands.ts,queries.ts}, tests/integration/payment-deadline.test.ts.

**소비:** A4 getPaymentContext(actor: AuthActor, applicationId: Id): Promise<PaymentContext>와 A1 서버 가격·기한 함수. PaymentContext의 신청·소유권·보존 terms를 사용하고 요청에서 금액·권한·접수 시각을 받지 않는다.

**생산:** 타입은 contracts.ts, 명령은 commands.ts, 조회는 queries.ts에 둔다.

```ts
type PaymentStatus = 'created' | 'approval_pending' | 'paid' | 'failed' | 'unknown' | 'needs_review';
type TestOrder = { id: Id; applicationId: Id; teamId: Id; ownerId: Id; environment: 'test'; terms: TermsSnapshot; pricingVersion: string; paymentDeadlineAt: UtcInstant; status: PaymentStatus };
type ApprovalReceipt = { attemptId: Id; orderId: Id; receivedAt: UtcInstant; status: PaymentStatus };
createTestOrder(actor: AuthActor, input: {applicationId: Id; requestId: Id}): Promise<TestOrder>;
acceptApproval(actor: AuthActor, input: {orderId: Id; paymentKey: string; requestId: Id}): Promise<ApprovalReceipt>;
getTestOrder(actor: AuthActor, orderId: Id): Promise<TestOrder>;
```

- [ ] **실패 검증:** 다른 회원·무료 경기·calculator_only·금액/상태 위조 요청, 동일 키의 다른 입력, 중복 주문·승인, 경계 시각과 기기 시각 변경을 검증한다. 본인 조회만 허용한다.

        expect((await createAsOwner(paidApplication)).terms.pricing.platformFeeKrw).toBe(0);
        expect(await orderCount(paidApplication.id)).toBe(1);
        expect((await submitAt(deadlineMinus1ms)).receivedAt).toBe(deadlineMinus1ms);
        await expect(submitAt(deadline)).rejects.toMatchObject({code:'PAYMENT_DEADLINE_EXPIRED'});
        expect(await applicationState()).toBe('verifying_payment');

- [ ] **실패 확인:** pnpm exec supabase test db와 pnpm exec vitest run tests/integration/payment-deadline.test.ts를 실행해 주문 테이블·접수 전이 미구현 실패를 확인한다.
- [ ] **구현:** test_orders·approval_attempts를 만들고 신청별 테스트 주문 하나, 주문별 유효 승인 시도 하나, command_receipts의 회원·명령·requestId·입력 hash 유일성을 적용한다. createTestOrder는 양수 참가비·0bps·initial_test_order만 허용하며 terms·금액·기한·가격 버전·PG 비용 미확정을 보존한다.
- [ ] **접수 전이:** 트랜잭션에서 DB 시각으로 소유권·모집 상태·기한을 다시 검사하고 유효 시도와 최초 receivedAt를 기록하며 awaiting_payment→verifying_payment로 전환한다. 동일 입력 재시도는 기한 이후에도 기존 receipt를 반환한다. 유효 시도 없는 기한 만료만 자리를 반환하며 PG 호출을 여기서 기다리지 않는다.
- [ ] **통과 확인:** 같은 두 명령이 PASS여야 한다. DB 접수는 기한−1ms 허용·기한과 같거나 이후 거부, 전화기 시계는 결과 무관, 승인 확인 중은 자리 하나 유지, 동일 요청은 같은 attemptId여야 한다. POST /api/test-orders와 POST /api/test-orders/:id/approval, GET /api/test-orders/:id를 연결한다.
- [ ] **커밋:** 주문·접수 관련 파일만 포함한다.

        git add packages/core/src/contracts.ts apps/server/src/http/router.ts apps/server/src/features/payments/commands.ts apps/server/src/features/payments/queries.ts supabase/migrations/202610130004_test_orders.sql supabase/tests/test_orders.sql tests/integration/payment-deadline.test.ts
        git commit -m "서버 기한 내 테스트 주문과 승인 접수 연결"

## 작업 B3. 테스트 PG 어댑터·승인 조회·결과 정리

**파일:** 수정 packages/core/src/contracts.ts, apps/server/src/index.ts, apps/server/src/http/router.ts. 생성 apps/server/src/features/payments/{pg-port.ts,toss-test.ts,fake-pg.ts,worker.ts}, supabase/migrations/202610130005_payment_results.sql, supabase/tests/payment_results.sql, tests/integration/payment-reconciliation.test.ts, docs/qa/test-pg.md.

**소비:** B2 TestOrder·ApprovalReceipt·영속 승인 시도. 복귀 URL·클라이언트 성공 상태는 PG 검증을 시작하는 자료이며 참가 확정 근거로 사용하지 않는다.

**생산:** PG 전용 타입·포트는 pg-port.ts, 결과 정리는 worker.ts, PaymentStatus는 공유 contracts.ts를 소비한다.

```ts
type PgEvidence = {environment:'test'; orderId:Id; paymentKey:string; currency:'KRW'; paymentAmountKrw:Won; approved:boolean; refundedKrw:Won; refunds:PgRefundEvidence[]};
type PgRefundEvidence = {providerRefundId:string; requestId:Id|null; amountKrw:Won};
type PgResult = {kind:'confirmed'; evidence:PgEvidence} | {kind:'definitive_failure'; code:string} | {kind:'unknown'; reason:string};
interface TestPgAdapter {
  readonly environment:'test'; readonly capabilities:{approvalIdempotency:boolean;refundIdempotency:boolean};
  approve(input:{orderId:Id;paymentKey:string;amountKrw:Won;requestId:Id}):Promise<PgResult>;
  lookup(input:{orderId:Id;paymentKey:string}):Promise<PgResult>;
  refund(input:{orderId:Id;paymentKey:string;additionalKrw:Won;requestId:Id;reason:string}):Promise<PgResult>;
}
processApproval(attemptId:Id):Promise<PaymentStatus>;
reconcilePayment(orderId:Id):Promise<PaymentStatus>;
runPaymentTick():Promise<{processed:number;unknown:number;needsReview:number}>;
createTossTestAdapter(config:{mode:'test';secretKey:string}):TestPgAdapter;
createFakePgAdapter(scenario:'success'|'declined'|'timeout_then_success'|'mismatch'):TestPgAdapter;
```

- [ ] **실패 검증:** 가짜 PG로 승인 응답 유실·조회 성공, 기한 이후 정상 결과, 주문/금액 불일치, 이미 취소된 경기의 늦은 승인, 중복 결과, 실결제 키 설정 거부를 작성한다.

        expect(await processApproval(validAttempt.id)).toBe('unknown');
        expect(await heldSlots(match.id)).toBe(1);
        expect(await reconcilePayment(validOrder.id)).toBe('paid');
        expect(await applicationState()).toBe('confirmed');
        expect(await reconcilePayment(mismatchedOrder.id)).toBe('needs_review');
        expect(await applicationStateOf(cancelledMatchOrder)).toBe('cancelled');

- [ ] **실패 확인:** pnpm exec supabase test db와 pnpm exec vitest run tests/integration/payment-reconciliation.test.ts를 실행해 PG 포트·결과 정리 미구현 실패를 확인한다.
- [ ] **구현 준비:** 명세의 토스 공식 환경·승인·조회·취소 문서를 구현 시 다시 읽고 필드·테스트 키 판정·멱등 기능·결과 확인 근거를 어댑터에 기록한다. 설정이 없으면 CONFIG_REQUIRED로 종료하고 실키·live 모드는 거부한다. 지원하지 않는 제공자 멱등 기능을 true로 선언하지 않는다.
- [ ] **결과 전이:** 외부 호출 전 영속 작업을 확보하고 호출 후 잠금 순서로 결과를 적용한다. 서버 주문·금액·통화·테스트 환경을 검증한 정상 승인만 paid·confirmed와 payment.confirmed·roster.changed를 원자 기록한다. 기한 내 receipt는 결과 지연만으로 만료하지 않는다. 타임아웃은 unknown·자리 보류, 확정 실패는 failed·자리 반환, 모순은 needs_review다.
- [ ] **예외 처리:** 기한 내 유효 접수 없는 승인 또는 이미 참여 불가능한 경기의 승인은 강제 참가 확정하지 않는다. 취소된 신청은 자리 반환을 유지하고 취소 원인에 따른 B4의 누적 환불 의도 또는 needs_review로 연결한다. 조회가 승인 여부를 확정하지 못하면 실패·0원으로 만들지 않는다. 동일 결과는 이벤트·원장을 한 번만 변경한다.
- [ ] **실행 연결:** 승인 HTTP 접수 뒤 waitUntil(processApproval(attemptId))로 실행하되 작업은 DB에 먼저 보존한다. scheduled handler는 runPaymentTick()에서 미처리 승인·unknown 조회 후보를 claim하고 결과를 정리한다. D4가 같은 handler에 알림 tick을 추가한다. 동일 회차·중단 후 재실행은 결과를 한 번만 적용한다.
- [ ] **통과 확인:** 위 명령과 B2 검증이 PASS여야 한다. PG 재전송은 제공자 멱등 보장 때만 같은 requestId로 하며, 보장 없는 불명확 요청은 조회 후 확인 또는 needs_review로 남긴다. 실제 테스트 키가 준비되면 승인·조회·취소 결과만 docs/qa/test-pg.md에 비밀 없이 기록한다. 미준비는 설정 필요다.
- [ ] **커밋:** 어댑터·결과 정리·QA 관련 파일만 포함한다.

        git add packages/core/src/contracts.ts apps/server/src/index.ts apps/server/src/http/router.ts apps/server/src/features/payments/pg-port.ts apps/server/src/features/payments/toss-test.ts apps/server/src/features/payments/fake-pg.ts apps/server/src/features/payments/worker.ts supabase/migrations/202610130005_payment_results.sql supabase/tests/payment_results.sql tests/integration/payment-reconciliation.test.ts docs/qa/test-pg.md
        git commit -m "테스트 PG 승인 조회와 불명확 결과 정리 추가"

## 작업 B4. 원자적 취소 의도·누적 환불·테스트 원장

**파일:** 수정 packages/core/src/contracts.ts, apps/server/src/features/payments/worker.ts, apps/server/src/index.ts, apps/server/src/http/router.ts, apps/web/src/app/router.ts. 생성 supabase/migrations/202610130006_refund_intents.sql, supabase/tests/refund_atomicity.sql, apps/server/src/features/refunds/{worker.ts,queries.ts}, apps/web/src/features/payments/{view.ts,return.ts}, tests/integration/cumulative-refunds.test.ts, tests/e2e/test-payment-flow.spec.ts.

**소비:** A5 cancelApplication·cancelMatch·CancellationReceipt·FormatNotice, B1 환불 계산, B3 TestPgAdapter·reconcilePayment. 공개 취소 API를 새로 만들지 않는다.

**생산:** 타입은 contracts.ts, 작업은 refunds/worker.ts, 소유자 조회는 refunds/queries.ts에 둔다.

```ts
type RefundStatus = 'not_required'|'queued'|'processing'|'completed'|'failed'|'unknown'|'needs_review';
type RefundRecord = {id:Id;orderId:Id;receiptIds:Id[];ratioBps:RefundRatioBps;target:RefundTotals;completed:RefundTotals;status:RefundStatus};
processNextRefund(orderId:Id):Promise<RefundRecord>;
getRefundRecord(actor:AuthActor,orderId:Id):Promise<RefundRecord|null>;
runRefundTick():Promise<{processed:number;unknown:number;needsReview:number}>;
// SQL: enqueue_refund_intent(p_receipt_id uuid) returns uuid
```

웹 view.ts는 beginTestPayment(applicationId:Id):Promise<void>, return.ts는 handlePaymentReturn(url:string):Promise<TestOrder|null>를 제공한다. 본인 서버 주문의 보존 금액으로 테스트 결제창을 열고 허용 복귀 경로·주문 연결을 검사한 뒤 B2 승인/조회 API를 호출한다. URL의 성공·금액 값을 확정 근거로 쓰지 않는다. GET /api/test-orders/:id/refund는 본인 조회만 허용한다. C2는 이 복귀 처리를 새로 만들지 않고 앱 링크에 연결한다.

- [ ] **실패 검증:** cumulative-refunds.test.ts와 refund_atomicity.sql에 50% 완료/진행 중 전액 목표 상향·중복 요청, PG 환불 성공 후 응답 유실, 목표 하향, 원장 불일치, 환불 의도 삽입 실패 시 취소 전체 롤백을 작성한다.

        expect((await afterPersonalCancel()).completed.refundedKrw).toBe(5000);
        expect((await afterHostCancel()).completed.refundedKrw).toBe(10000);
        expect(pgRefundAmounts()).toEqual([5000,5000]);
        expect(await activeRefundAttemptCount(order.id)).toBeLessThanOrEqual(1);
        expect(await applicationStateAfterRefundFailure()).toBe('cancelled');
        expect(await heldSlotsAfterRefundFailure()).toBe(0);
        await expect(cancelWithIntentInsertFailure()).rejects.toMatchObject({code:'REFUND_INTENT_WRITE_FAILED'});
        expect(await stateAfterIntentRollback()).toBe('confirmed');
        expect(await receiptCountAfterIntentRollback()).toBe(0);

- [ ] **방식 변경 검증:** 공지 당시 활성 신청을 보존한 뒤 개인 취소로 일부 환불한 대상 신청의 불참은 잔액 전액 목표다. 공지 전 이미 취소된 신청은 대상에서 제외한다. 미결제 불참은 PG 호출 0회, 시작 후 변경·분쟁은 운영 확인이며 자동 무환불로 바꾸지 않는다.

        expect(notice.affectedApplicationIds).not.toContain(cancelledBeforeNotice.id);
        await expect(declineByNonTarget()).rejects.toMatchObject({code:'FORMAT_CHANGE_NOT_APPLICABLE'});
        expect((await declineTargetAfterPartialRefund()).target.refundedKrw).toBe(10000);
        expect(pgCallsFor(unpaidDecline)).toHaveLength(0);

- [ ] **실패 확인:** pnpm exec supabase test db와 pnpm exec vitest run tests/integration/cumulative-refunds.test.ts를 실행해 의도·누적 원장 미구현 실패를 확인한다.
- [ ] **원자적 연결:** refund_intents·refund_attempts·test_ledger_entries를 만들고 enqueue_refund_intent를 A5의 기존 취소 DB 전이 안에서 receipt 생성과 함께 호출한다. A5 권한·취소·자리·roster.changed 로직은 재사용한다. 후속 별도 요청으로 의도를 만드는 방식은 금지한다. 주문 미생성·미승인이어도 취소 의도를 보존해 늦은 승인 정리와 연결하되 미결제 PG 환불은 생성하지 않는다.
- [ ] **목표·작업:** personal은 receipt.receivedAt·terms.policy, host_cancelled와 유효 format_change_declined는 100%를 적용한다. 팀 취소는 이전 부분 환불 주문도 처리한다. 방식 변경은 formatChangeId·affectedApplicationIds·불참 접수 구간을 확인한다. 주문별 미해결 환불 작업의 유일 제약을 두고 processing/unknown 중 새 목표는 상향만 한다.
- [ ] **완료 원장:** 먼저 PG 조회로 앞선 작업의 완료 증거를 정리하고 완료액을 뺀 차액만 요청한다. 증거 불충분·초과·불일치는 needs_review로 남긴다. 확인된 작업의 세 환불 금액·제공자 환불 ID·requestId를 유일 원장에 한 번 기록한다. 0원 차액은 PG 호출 없이 완료한다. 실패·불명확 기록과 receipt는 삭제하지 않는다.
- [ ] **실행 연결:** 서버 scheduled handler에서 runPaymentTick() 다음 runRefundTick()을 실행한다. 영속 환불 의도의 유효 후보를 claim하고 unknown은 조회부터 정리한다. 취소 API 응답은 환불 접수 상태를 보여주며 외부 PG를 DB 트랜잭션 안에서 기다리지 않는다. Worker 재시작 후에도 환불이 처리되는 통합 단언을 넣는다.
- [ ] **화면·통과 확인:** 위 DB·통합 검증과 pnpm exec playwright test tests/e2e/test-payment-flow.spec.ts가 PASS여야 한다. 참가자 화면에는 테스트 표시·팀 참가비·플랫폼 수수료 0원·총결제액·환불 처리 중/실패를 쉽게 표시한다. 운영용 테스트 원장에서 PG 비용 미확인·PG 비용 미반영 팀 기준액을 구분한다. 초기 10,000원→5,000원→잔액 5,000원, 미래 계산 전용 10,250원→5,125원→잔액 5,125원을 검증한다. 은행 지급 호출은 0회다.
- [ ] **커밋:** 취소 연결·환불·테스트 원장 관련 파일만 포함한다.

        git add packages/core/src/contracts.ts apps/server/src/features/payments/worker.ts apps/server/src/index.ts apps/server/src/http/router.ts apps/server/src/features/refunds/worker.ts apps/server/src/features/refunds/queries.ts apps/web/src/app/router.ts apps/web/src/features/payments/view.ts apps/web/src/features/payments/return.ts supabase/migrations/202610130006_refund_intents.sql supabase/tests/refund_atomicity.sql tests/integration/cumulative-refunds.test.ts tests/e2e/test-payment-flow.spec.ts
        git commit -m "원자적 취소와 누적 환불 및 테스트 원장 연결"

## 완료·연결 기준

B1~B4의 내부 계산·로컬 DB·통합·웹 검증을 독립 증거로 기록한다. 외부 테스트 PG 검증은 준비된 경우에만 별도 확인하고 앱 복귀는 C2가 실제 양 OS에서 검증한다. 알림은 payment.confirmed·application.cancelled·match.cancelled·roster.changed와 현재 AppState를 소비한다. 실제 계약·PG 비용 분담·실결제·팀 지급 승인을 완료한 것으로 보고하지 않는다.
