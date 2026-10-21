# 푸시 제공자 연결 검증

1. **로컬에서 확인한 범위**: 등록·소유 버전·계정 교체·claim 뒤 소유권 변경·웹 endpoint 허용 목록·일반 안내 payload·전송 포트를 검증했다. 테스트는 실제 사용자 기기로 발송하지 않는다. 접수 결과와 읽음 기록은 별개다.
2. **APNs**: iOS 토큰은 길이를 고정하지 않고 hex 형식을 검사한다. ES256 JWT, topic, 환경, 만료 시각을 연결했다. 서버의 HTTP/2 지원이 검증된 transport를 주입하기 전에는 `setup_required`다. Workers의 일반 fetch를 HTTP/2 보장으로 간주하지 않는다. 서명 계정·인증키·기기 토큰·실제 수신은 준비 필요다.
3. **FCM**: 서비스 계정의 RS256 JWT를 OAuth access token으로 교환한 후 HTTP v1으로 전송한다. 문자열 data와 명시 TTL을 사용한다. Firebase 프로젝트·앱 설정·서비스 계정·실제 수신은 준비 필요다.
4. **웹**: VAPID와 AES128GCM을 사용한다. 현재 허용 host는 Chrome의 `fcm.googleapis.com`, Firefox의 `updates.push.services.mozilla.com`이다. Safari는 실제 구독 host 확인 후 허용 목록에 추가해야 한다. 공개 VAPID 키만 웹 환경에 넣는다. 권한은 사용자의 버튼 선택으로만 요청한다. 로그아웃 해지 실패는 ID·소유 버전만 저장하고 토큰은 저장하지 않는다.
5. **보안 경계**: 구독 키·기기 토큰·서버 비밀은 공개 응답에 없다. 제공자 오류 내용을 그대로 응답·로그에 넣지 않는다. 웹 endpoint의 redirect는 차단한다. 클릭은 알려진 내부 안내 경로로만 이동하고 본인 상세 조회 권한을 재검사한다.

공식 근거: [APNs 요청](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns), [가변 길이 APNs 토큰](https://developer.apple.com/documentation/uikit/uiapplicationdelegate/application(_:didregisterforremotenotificationswithdevicetoken:)), [FCM 서버 인증](https://firebase.google.com/docs/cloud-messaging/auth-server), [FCM 오류](https://firebase.google.com/docs/cloud-messaging/error-codes), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292), [WebCrypto Web Push](https://github.com/block65/webcrypto-web-push), [Workers node:http2 제한](https://developers.cloudflare.com/workers/runtime-apis/nodejs/http2/).
