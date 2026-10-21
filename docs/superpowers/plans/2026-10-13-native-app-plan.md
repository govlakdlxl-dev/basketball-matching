# C. iOS·Android 설치 앱 구현 계획

> **에이전트 실행자:** superpowers:subagent-driven-development 또는 superpowers:executing-plans로 체크박스 작업을 실행한다.

**목표:** 웹과 같은 회원·경기를 사용하는 설치 앱을 만들고 지도·로그인·결제 복귀·푸시를 양 OS에서 검증한다.

**구조:** A의 웹 빌드 자산을 Capacitor 앱에 포함한다. 네이티브 연결은 apps/mobile의 어댑터로 격리하고, 알림 등록·기록은 D의 서버 API를 사용한다. 외부 링크는 인증·권한·결제의 증거가 아니라 현재 상태를 조회하는 진입점이다.

**기술:** Capacitor 8, iOS/Swift/SPM/Xcode, Android/Kotlin/Android Studio, Supabase OAuth, 공식 Push Notifications·App 플러그인.

**명세:** [상세 설계](../specs/2026-10-13-basketball-matching-design.md), [공통 계획](2026-10-13-basketball-implementation-plan.md), [A](2026-10-13-core-matching-plan.md), [B](2026-10-13-test-payments-plan.md), [D](2026-10-13-notifications-plan.md).

## 공통 제약

iOS·Android 모두 첫 버전, 앱 주력·웹 병행, 카카오 로그인 우선·Apple 대안, 외부 설정·기기 검증을 웹 통과와 구분한다. 스토어 구매·공개는 별도 전환이며 코드 구현 단계에서 지출하지 않는다. 기본 앱 ID와 이름은 로컬 개발용 값이며 공개 브랜드로 확정하지 않는다.

## 검토 초점

1. 지도 iframe의 잘못된 출처·nonce — 선택 좌표·네이티브 기능 호출로 받아들이지 않는다: C1.
2. 시작하지 않은 로그인·재사용된 콜백 — 다른 계정 세션으로 전환하지 않는다: C2.
3. 결제 복귀 전 앱 종료 — 성공을 추측하지 않고 B의 주문 상태를 조회한다: C2.
4. 휴대폰 시간대·폰 시계 변경 — 서버 상태·한국 시간 표시가 유지된다: C2.
5. 오프라인 로그아웃·계정 변경 — 이전 안내·세션을 정리하고 새 계정에서 이전 신청을 읽지 못한다: C3.

## 작업 C1. 양 OS 빌드와 지도·플랫폼 연결을 초기에 검증

**선행:** A3. A4 이후의 전체 흐름을 만들기 전에 실행한다.

**파일:** 생성 apps/mobile/{package.json,capacitor.config.ts,src/bridge.ts}, apps/web/src/platform/runtime.ts, apps/mobile/ios/App/App/Info.plist, apps/mobile/ios/App/App/AppDelegate.swift, apps/mobile/android/app/src/main/AndroidManifest.xml, apps/mobile/android/app/src/main/java/dev/basket/pilot/MainActivity.kt, apps/mobile/ios와 android의 Capacitor 생성 프로젝트, tests/integration/native-map-bridge.test.ts, docs/qa/mobile-build.md. 수정 apps/web/package.json의 workspace 의존성.

**입출력 계약:** packages/core/src/contracts.ts의 Point·Id와 A3의 core map-protocol.ts 타입을 소비한다. apps/mobile/src/bridge.ts는 createNativePlatform(): PlatformAdapter를 제공하고, web runtime은 createWebPlatform(): PlatformAdapter를 제공한다. PlatformAdapter는 kind:'web'|'ios'|'android', openExternal(url: string):Promise<void>, subscribeToLinks(listener:(url:string)=>void):Promise<()=>void>다. validateMapEvent(value:unknown, context:MapTrustContext):MapEvent|null은 A3 웹 protocol.ts가 소유한다.

- [ ] 지도 출처·nonce 검증을 작성한다. 허용 HTTPS 지도 화면의 point_selected만 처리하고 다른 출처·이전 요청 nonce·잘못된 좌표·임의 실행 명령은 거부한다.

        expect(validateMapEvent(forgedMessage,wrongOriginContext)).toBeNull();
        expect(validateMapEvent(validPointMessage,currentContext)?.type).toBe('point_selected');

- [ ] pnpm exec vitest run tests/integration/native-map-bridge.test.ts를 실행해 연결 미구현 실패를 확인한다. Xcode 26 이상·Android Studio 2025.2.1 이상과 SDK를 준비하고 빌드 환경 버전을 docs/qa/mobile-build.md에 기록한다.
- [ ] 로컬 개발 이름 “농구 매칭 개발판”, 앱 ID dev.basket.pilot, 복귀 scheme basketpilot를 사용한다. webDir는 ../web/dist다. 모바일 패키지는 @basket/mobile이고 bridge.ts를 package export로 내보내 web의 runtime이 가져오게 한다. web의 workspace 의존성에 mobile을 추가하되 mobile은 web을 import하지 않아 순환을 만들지 않는다. Capacitor 8 계열 core·cli·ios·android·App 플러그인을 고정하고 web 빌드 뒤 pnpm --filter @basket/mobile exec cap add ios 및 cap add android로 생성한다. 상용 서버 URL을 앱 전체 원격 실행 주소로 넣지 않고 빌드 자산을 포함한다. 지도는 등록된 HTTPS map.html 구성요소로 연결하고 출처·nonce·자료 형태를 검사한다. 네이티브 브리지·서버 비밀을 지도 iframe에 노출하지 않는다.
- [ ] 단위 검증·웹 빌드 후 pnpm --filter @basket/mobile exec cap sync를 실행한다. Android는 apps/mobile/android에서 ./gradlew assembleDebug, iOS는 설치된 simulator destination을 확인한 뒤 xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build를 apps/mobile/ios/App에서 실행한다. 두 빌드 성공과 화면·키보드·뒤로가기·지도 핀 선택을 확인한다. HTTPS 배포·키가 없으면 실제 지도 검증은 준비 필요로 기록한다.
- [ ] 설정·생성 프로젝트·브리지·검증 기록만 “양 OS 앱 빌드와 지도 연결 추가”로 커밋한다. 빌드 결과물·local.properties·서명 키는 제외한다.

## 작업 C2. 카카오·Apple 로그인과 PG 복귀를 상태 조회에 연결

**선행:** A2·A4·B2~B3, C1. 로그인 연결 준비는 C1 뒤 독립적으로 진행할 수 있다.

**파일:** 생성 apps/mobile/src/{links.ts,auth-storage.ts}, apps/mobile/ios/App/App/SessionVaultPlugin.swift, apps/mobile/android/app/src/main/java/dev/basket/pilot/SessionVaultPlugin.kt, apps/web/src/platform/session-storage.ts, apps/web/src/features/auth/callback.ts, tests/integration/mobile-return.test.ts, docs/qa/mobile-auth-payments.md. 수정 A2 session.ts, B4 payments/return.ts, C1 AppDelegate.swift·Info.plist·AndroidManifest.xml·MainActivity.kt·Xcode 프로젝트의 plugin 소스 등록 및 서버 OAuth 제공자 설정 기록.

**입출력 계약:** parseAppLink(url:string): AppLink|null을 links.ts에 둔다. AppLink는 {kind:'auth';code:string}, {kind:'payment';orderId:Id;paymentKey:string|null}, {kind:'match';matchId:Id}, {kind:'notice';noticeId:Id} 중 하나다. 허용 scheme basketpilot와 설정된 HTTPS 앱 링크의 알려진 경로만 인정한다. AuthSessionStorage는 get():Promise<string|null>, set(value:string):Promise<void>, clear():Promise<void>이고 web은 본인 세션만 저장하며 native는 OS 보관소를 사용한다.

- [ ] 콜백·종료 후 복귀 검증을 작성한다. 미시작/재사용 auth code, 임의 scheme·경로, 다른 회원 주문, 위조 성공 표시를 거부한다. 정상 로그인은 내부 회원 ID를 유지하고 결제 복귀 후 B의 서버 결과를 조회한다.

        expect(parseAppLink('evil://payment/return?paid=true')).toBeNull();
        expect(parseAppLink('basketpilot://payment/return?orderId=order-1')?.kind).toBe('payment');
        await handlePaymentReturn(forgedSuccessUrl);
        expect((await getTestOrder(memberA,order.id)).status).toBe('created');
        expect((await getPaymentContext(memberA,order.applicationId)).application.state).toBe('awaiting_payment');

- [ ] pnpm exec vitest run tests/integration/mobile-return.test.ts를 실행해 복귀·세션 연결 미구현 실패를 확인한다.
- [ ] 로그인은 보존한 일회성 PKCE 거래와 Supabase 인증 결과로 완료한다. iOS Apple 대안을 포함하고, 이메일·닉네임만으로 계정을 병합하지 않는다. iOS는 Keychain, Android는 Keystore의 비추출 암호키로 암호화한 앱 전용 저장소에 세션·PKCE verifier를 보관한다. JWT·refresh token을 외부 지도 화면·로그에 전달하지 않는다. 카드사 이동과 앱 복귀는 토스 웹뷰 안내의 scheme·외부 앱 처리로 구현하며 결제 결과는 B의 getTestOrder/acceptApproval을 통해 확인한다. 결제 key가 없거나 결과가 불명확하면 조회 상태를 유지한다.
- [ ] 같은 검증과 양 OS 실제 기기에서 로그인 성공·취소·이메일 미제공 재로그인, Apple 로그인, 카드사 이동·복귀·앱 종료 후 복귀, 한국 시간 표시를 확인한다. 회귀 URL 로그에는 code·paymentKey·토큰을 남기지 않는다. 외부 키·서명·테스트 계정이 없으면 해당 행을 준비 필요로 기록한다.
- [ ] 로그인·복귀·보관소 관련 파일만 “설치 앱 로그인과 테스트 결제 복귀 연결”로 커밋한다.

## 작업 C3. 기기 푸시·알림 클릭·계정 변경 통합 검증

**선행:** D3·D4, C2, B4.

**파일:** 생성 apps/mobile/src/push.ts, apps/mobile/ios/App/App/App.entitlements, tests/integration/device-session.test.ts, docs/qa/mobile-notifications.md. 수정 C1 AppDelegate.swift·AndroidManifest.xml·네이티브 프로젝트의 Push capability/FCM 설정, C2 auth/session 및 links.ts, D2 apps/web/src/features/notifications/view.ts 및 mobile/package.json의 공식 Push Notifications 플러그인 의존성. 기기별 Firebase 설정·서명 자료는 로컬 비공개 설정으로 두고 Git에 추가하지 않는다.

**입출력 계약:** D3의 등록·해지 및 D2의 알림함·읽음 HTTP API를 소비한다. 서버 내부 계약은 registerPushEndpoint(actor,{channel,registration,deviceId}), deactivatePushEndpoint(actor,endpointId), listInbox(actor), markNoticeRead(actor,noticeId)다. native는 iOS APNs·Android FCM을 구분한다. registerDevicePush():Promise<{endpointId:Id}|{status:'permission_denied'}>, unregisterDevicePush():Promise<{status:'completed'|'pending'}>를 push.ts에 제공하고 현재 로그인 토큰으로 HTTP를 호출한다.

- [ ] 같은 기기의 회원 교체·해지 지연·알림 클릭을 검증한다. A 로그아웃 후 B 로그인에서 A의 신청·조건·알림을 표시하지 않고, A의 늦은 해지 요청은 B 등록을 끄지 않는다. 권한 거부로 앱의 신청 조회가 막히지 않는다.

        await expect(getInboxNotice(memberB,memberANotice.id)).rejects.toMatchObject({code:'FORBIDDEN'});
        expect(await newMemberEndpointActiveAfterOldLogout()).toBe(true);

- [ ] pnpm exec vitest run tests/integration/device-session.test.ts를 실행해 기기 연결·계정 정리 미구현 실패를 확인한다.
- [ ] 공식 앱 푸시 플러그인으로 OS 허용·토큰 등록·클릭을 연결한다. 로그아웃 시 기기 등록 해지·이미 도착한 알림·배지·로컬 세션을 정리한다. 오프라인 해지는 pending으로 보존하고 새 회원 연결과 충돌하지 않게 재시도한다. 푸시 본문은 일반 안내·ID만 담고 클릭 뒤 현재 로그인으로 서버 소유권·진행 상태를 조회한다. 앱 복귀·재접속 시 알림함을 새로 읽는다.
- [ ] 같은 검증 후 실제 iOS·Android·웹에서 foreground/background/종료 상태, 허용·거부·해지, 결제 완료 후 독촉 중단, 원래 방식 변경→불참→잔액 전액 환불을 확인한다. 실제 푸시 접수·읽음·DB 상태를 분리해 docs/qa/mobile-notifications.md에 기록하고 웹·서버 build/typecheck/필수 검증을 함께 통과시킨다.
- [ ] 기기·알림 통합 파일과 검증 근거만 “기기 알림과 계정 변경 및 최종 모바일 흐름 검증”으로 커밋한다.

## 완료·공개 조건

로컬 빌드와 실제 기기·외부 테스트를 분리해 보고한다. 두 OS의 필수 검증이 끝나기 전 웹 성공만으로 앱 완료를 주장하지 않는다. 앱 등록 이름·도메인·서명 계정·스토어 등록비·심사 자료를 정한 뒤 공개 전환한다.

참고: [앱 링크](https://capacitorjs.com/docs/apis/app), [앱 푸시](https://capacitorjs.com/docs/apis/push-notifications), [Supabase 복귀](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [토스 웹뷰](https://docs.tosspayments.com/guides/v2/webview), [Apple 로그인 조건](https://developer.apple.com/app-store/review/guidelines/#login-services), [Apple 비밀 저장](https://developer.apple.com/documentation/security/keychain-services), [Android 암호키 저장](https://developer.android.com/privacy-and-security/keystore).
