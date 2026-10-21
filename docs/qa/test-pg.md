# 테스트 결제 확인

1. 현재 실제 토스 테스트 키는 설정되지 않았습니다. 로컬 통합 검증은 가짜 PG로 승인·조회·응답 유실·취소 이후 늦은 결과를 검사합니다. 실제 토스 결제창과 PG 결과는 별도 확인이 필요합니다.
2. 개별 결제창의 `test_ck_`·`test_sk_` 한 세트만 지원합니다. 서버의 `TEST_PG_MODE=toss`, `TOSS_TEST_SECRET_KEY`와 웹의 공개 테스트 클라이언트 키를 설정합니다. 실제 키와 `live` 모드는 거부합니다. 새 `gck/gsk` 결제창 방식은 현재 어댑터와 혼용할 수 없습니다.
3. 서버 승인·조회·카드 취소는 `/v1/payments/confirm`, `/v1/payments/orders/{orderId}`, `/v1/payments/{paymentKey}/cancel`을 사용합니다. Basic 인증은 비밀키와 콜론을 인코딩하고, 모든 POST에 영속 멱등 키를 사용합니다. 승인 결과는 주문·결제키·금액·KRW·카드·완료 상태를 확인합니다. 취소는 `cancels` 중 `DONE`과 잔액 일치를 확인하며 카드의 `cancelRequestId`를 자체 요청 ID로 사용하지 않습니다.
4. 타임아웃·5xx·처리 중·조회 실패는 결과 미확인입니다. 먼저 조회하며, 주문 부재 응답과 제공자 멱등 지원이 확인된 경우에만 같은 POST 키로 복구합니다. 토스 보장 15일보다 짧은 14일로 재전송을 제한합니다. 조회 불능을 실패나 0원 환불로 바꾸지 않습니다.
5. 가짜 PG는 `TEST_PG_MODE=fake`, `ALLOW_LOCAL_TEST_PG=true`와 localhost Supabase에서만 허용합니다. 증거는 로컬 DB에 보존하므로 Worker가 재시작돼도 조회할 수 있습니다. 금융 기록과 실제 돈은 구분됩니다. PG 설정 변경 시 기존 주문의 제공자를 자동 바꾸지 않습니다.

공식 근거(2026-10-14 확인): [키 종류](https://docs.tosspayments.com/reference/using-api/api-keys), [인증·멱등 헤더](https://docs.tosspayments.com/reference/using-api/authorization), [API·결제 객체](https://docs.tosspayments.com/reference), [오류 코드](https://docs.tosspayments.com/reference/error-codes), [개별 SDK](https://docs.tosspayments.com/sdk/v2/js/payment), [복귀와 10분 승인 조건](https://docs.tosspayments.com/guides/v2/payment-window/integration).

실제 키 준비 후 확인할 항목: 카드 테스트 승인 1회, 본인 주문 조회, 부분 취소→잔액 취소, 응답 유실 후 중복 없이 복구, 실패/중단 복귀, 웹과 설치 앱 복귀. 비밀키·결제키·개인 결제 정보를 QA 기록에 남기지 않습니다.

6. 브라우저에서 ‘테스트 결제하기’→‘로컬 테스트 승인’→서버 승인 확인→개인 50% 환불→팀 취소 잔액 환불을 확인했습니다. 실제 PG 카드 인증 결과와는 구분합니다. 결제 복귀는 256비트 주문 전용 토큰을 해시로 보관하고 최초 유효 승인 접수·멱등 요청에 연결합니다. 로그인 세션이 사라져도 복귀 접수는 가능하며, 회원의 주문 조회에는 로그인이 필요합니다. 초기 발급은 최대 15분·결제 기한까지, 유효 승인 재시도의 복귀 토큰은 발급 후 최대 1시간입니다.
7. 취소 접수와 환불 의도는 같은 DB 트랜잭션의 trigger로 기록합니다. 의도 저장 실패는 취소·자리 반환을 함께 되돌립니다. 원장과 PG 증거가 맞지 않으면 원장을 일부 변경하지 않고 운영 확인으로 둡니다. 진행 중 환불은 하나이며 신규 전액 목표는 상향만 합니다. 금융 미처리가 남아 있으면 탈퇴를 보류합니다.
