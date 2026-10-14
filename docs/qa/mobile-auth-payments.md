# 앱 로그인·세션·결제 복귀

1. **준비한 흐름**: 설치 앱은 외부 HTTPS 브라우저에서 카카오 또는 iOS Apple 로그인을 시작한다. 시작 시 OS 보관소에 한 건의 10분 일회성 거래를 남기고 같은 state의 콜백만 교환한다. Supabase PKCE verifier도 같은 OS 보관소를 사용한다. 이메일·닉네임으로 다른 계정을 병합하지 않는다. 현재 카카오·Apple 제공자는 미설정이다.
2. **세션 보관**: iOS는 Keychain `WhenUnlockedThisDeviceOnly`, Android는 Keystore AES/GCM 키와 앱 전용 암호문 저장소다. 앱 런타임 또는 보관소 실패 시 localStorage로 전환하지 않는다. `pnpm --filter @basket/mobile sync`는 native 모드 자산을 빌드하여 런타임 표식을 포함한다.
3. **지도와 브리지**: iOS native 메시지 수신 proxy는 OS가 제공하는 main frame 여부와 로컬 발신 URL origin을 확인한다. Android custom WebView는 legacy Java interface 등록을 최초 로드 전부터 거부한다. 현대 WebMessageListener 미지원 환경은 native 오류 화면으로 차단하고 설치 실패는 보관소를 사용할 수 없게 처리한다. 기존 지도 IPC 검사만으로 native bridge 보안을 대신하지 않는다. 실제 iOS·Android에서 외부 iframe의 raw 호출 차단과 정상 Vault 접근을 추가 검증해야 한다.
4. **결제 복귀**: 앱은 설정한 `VITE_PUBLIC_WEB_ORIGIN`의 HTTPS checkout을 외부 브라우저로 연다. 웹의 주문 한정 티켓으로 서버가 결제를 확인한다. 앱 복귀는 주문 ID만 받아 현재 회원의 주문 상태를 재조회한다. URL의 성공 표시나 paymentKey를 참가 확정의 근거로 사용하지 않는다. 제공자 취소 후에도 참여 내역에서 상태를 확인한다.
5. **남은 실제 확인**: Xcode·JDK·Android SDK, HTTPS API·지도·웹 주소, 카카오 로그인·Supabase redirect 허용 목록, Apple 제공자·서명, 토스 테스트 키가 필요하다. 실제 기기 로그인 성공/취소·이메일 미제공·Apple·카드사 이동·앱 종료 후 복귀와 한국 시간은 아직 확인하지 못했다. 저장소 소스·TypeScript 검증이 앱 빌드 성공을 뜻하지 않는다.

공식 근거: [Supabase 앱 복귀](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [Capacitor App](https://capacitorjs.com/docs/apis/app), [Apple 프레임 정보](https://developer.apple.com/documentation/webkit/wkscriptmessage/frameinfo), [Android bridge 보안](https://developer.android.com/privacy-and-security/risks/insecure-webview-native-bridges), [Keychain](https://developer.apple.com/documentation/security/keychain-services), [Keystore](https://developer.android.com/privacy-and-security/keystore), [토스 WebView](https://docs.tosspayments.com/guides/v2/webview).
