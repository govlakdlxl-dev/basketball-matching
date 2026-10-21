# 기기 알림·계정 변경 검증

1. **연결 코드**: Capacitor Push Notifications 8.1.3을 고정했다. iOS APNs·Android FCM을 구분한다. 등록/오류 listener를 permission 요청 및 OS 등록에 앞서 연결한다. 권한 요청은 알림함의 사용자가 선택한 버튼으로 실행한다. 앱 복귀는 이미 연결한 계정·허용 상태에서만 재확인하며 권한 거부는 경기 조회를 막지 않는다.
2. **계정 변경**: 서버 등록은 현재 회원과 소유 버전을 보존한다. 로그아웃은 등록 해지·도착 알림·iOS 배지·OS 등록·로컬 세션을 정리한다. 오프라인 서버 해지는 ID·버전만 저장한다. 이전 회원의 늦은 해지/등록 응답은 새 회원 연결을 덮지 않는다. 알림 클릭은 UUID 안내 경로로 이동해 현재 회원의 서버 권한으로 상세를 조회한다.
3. **탈퇴**: 금융·모집 미처리는 기존 준비 함수가 확인한다. 탈퇴 준비에서 push endpoint를 비활성화하고 등록 비밀을 제거한다. Auth 삭제 실패는 비공개 요청으로 남겨 정기 작업에서 재처리한다. 탈퇴 완료 이벤트는 한 번만 기록한다.
4. **현재 검증**: 자동 검증은 등록 중 계정 교체·권한 거부·서버 소유권·오프라인 정리·Auth 실패 재처리·웹 알림함과 읽음·결제 뒤 독촉 중단을 포함한다. native 자산 생성과 양 OS 동기화는 성공했다. 실제 양 OS 빌드는 도구 부재로 확인되지 않았다.
5. **기기 확인 대기**: iOS 서명·Push capability·APNs HTTP/2 제공자, Android Firebase `google-services.json`·서비스 계정, 웹 VAPID·Safari 구독 host, 실제 iOS/Android 기기가 필요하다. 전경·배경·종료 수신/클릭·허용/거부·배지 정리·로그아웃 중 수신·외부 지도 raw bridge 차단은 실제 기기 확인 전 완료로 표시하지 않는다. 개인 Firebase 파일·서명 자료는 Git 제외다.

공식 근거: [Capacitor Push Notifications](https://capacitorjs.com/docs/apis/push-notifications), [앱 로그인·복귀 검증](mobile-auth-payments.md), [서버 푸시 포트 검증](push-ports.md).
