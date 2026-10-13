# 설치 앱 빌드 검증 · 2026-10-14

## 1. 한 페이지 기록

웹·공유 서버와 같은 흐름을 iOS·Android의 Capacitor 앱에서 사용합니다. 개발판 이름은 **농구 매칭 개발판**, ID는 `dev.basket.pilot`, 복귀 스킴은 `basketpilot`입니다. 앱은 웹 빌드 자산을 포함하고, 지도만 별도의 등록된 HTTPS `map.html`에 연결합니다.

| 항목 | 확인 결과 |
|---|---|
| Node.js | 번들 v24.19.0 |
| Capacitor core/cli/iOS/Android | 8.5.3 고정 |
| App / Browser 플러그인 | 8.1.2 / 8.0.5 고정 |
| iOS 프로젝트 생성 | 성공 · SPM 기본 구성 |
| Android 프로젝트 생성 | 성공 · 기본 Java MainActivity 유지 |
| `cap sync` | 양 OS 성공 |
| 네이티브 어댑터·지도 신뢰·CORS·본문 제한 | 자동 검증 6개 통과 |
| Xcode / iOS 빌드 | 전체 Xcode 없음. `xcodebuild` 실행은 CLT만 선택돼 실패 |
| Android 빌드 | Java Runtime 없음. `./gradlew assembleDebug` 실행 실패 |
| 실제 설치 앱 지도·키보드·뒤로가기·복귀 | 빌드 도구와 HTTPS 환경 준비 후 확인 필요 |

Android의 로컬 앱 origin은 Capacitor 8 기본인 `https://localhost`로 명시했습니다. iOS는 `capacitor://localhost`입니다. API의 `ALLOWED_ORIGINS`와 지도 빌드의 `VITE_MAP_PARENT_ORIGINS`에 정확한 origin을 설정해야 합니다. 임의 origin이나 `*`를 허용하지 않습니다.

기존 웹 지도는 `http://localhost:8000`의 시안 `config.js`를 재사용해 실제 타일·핀을 확인했습니다. 이 로컬 HTTP 예외는 설치 앱의 운영 HTTPS 지도 검증을 대신하지 않습니다. `VITE_API_BASE_URL`에는 앱에서 접근 가능한 HTTPS API 주소를 설정하고, `VITE_MAP_ORIGIN`에는 카카오에 등록한 HTTPS 지도 주소를 사용해야 합니다. 현재 로컬 웹의 `/api` 설정만 포함한 빌드로는 휴대폰에서 서버에 연결할 수 없습니다.

## 2. 도구 준비 후 실행

1. 전체 Xcode 26 이상, Android Studio 2025.2.1 이상과 SDK API 36·JDK를 준비합니다. 설치·계정·라이선스 절차는 사용자 환경에서 완료해야 합니다. [공식 환경 안내](https://capacitorjs.com/docs/getting-started/environment-setup)
2. 저장소에서 `pnpm --filter @basket/web build`, `pnpm --filter @basket/mobile exec cap sync`를 실행합니다.
3. `apps/mobile/android`에서 `./gradlew assembleDebug`를 실행합니다.
4. `apps/mobile/ios/App`에서 `xcodebuild -project App.xcodeproj -scheme App -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`를 실행합니다.
5. 로그인·지도 핀·키보드·뒤로가기·결제 복귀는 실제 앱에서 검증하고 이 기록을 갱신합니다. 실결제는 아직 활성화하지 않습니다.

## 3. 세 줄 요약

- 양 OS 프로젝트 생성과 동기화, 플랫폼 연결의 자동 검증을 마쳤습니다.
- Xcode·JDK·Android SDK가 준비되지 않아 네이티브 빌드 성공은 확인하지 못했습니다.
- 앱의 HTTPS API·지도 설정과 실제 기기 검증은 별도로 남아 있습니다.
