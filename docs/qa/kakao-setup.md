# 카카오 연결 상태와 설정 준비

## 1. 한 페이지 안내

2026-10-18 기준 **로컬 Supabase의 카카오 제공자와 웹 로그인 버튼을 활성화**했습니다. 사용자는 카카오디벨로퍼스의 로그인 ON·리디렉션 등록·키 저장을 확인했습니다. 내장 브라우저의 카카오 인증 화면에서 브라우저 설정 안내가 나타났고, 일반 Chrome에서는 등록하지 않은 세 동의항목을 요청해 `KOE205`가 재현됐습니다. 웹·설치 앱 코드를 닉네임만 요청하도록 수정했으며, 실제 화면에 남은 미설정 항목도 `profile_nickname` 하나임을 확인했습니다. 사용자가 닉네임 동의 설정 저장을 확인한 뒤 Chrome에서 KOE205 없이 회원번호·닉네임 제공 동의 화면이 나타났습니다. 사용자가 직접 동의한 뒤 Chrome 웹에서 실제 복귀·계정 생성·세션 교환을 확인했습니다. 현재 기본 조건(지하철 30분)을 계정에 저장하고 새로고침·로그아웃 후 재로그인해도 복원되는 것을 확인했습니다. 인증 코드는 주소에서 제거됐고, 같은 카카오 계정이 중복 생성되지 않았으며 이메일 없는 계정으로 검증했습니다. 기존 `04_시안_카카오맵/config.js`와 지도 시안은 보존합니다.

| 연결 | 현재 상태 | 설정 위치 |
|---|---|---|
| 카카오 지도 JavaScript SDK | 실제 표시 확인 | 기존 `config.js`·등록 도메인 |
| 카카오 로그인 | Chrome 웹의 실제 가입·로그인·조건 저장·새로고침·재로그인 확인 | 루트 `.env`·`supabase/config.toml`, 카카오 로그인 동의항목 |
| 장소 검색·지하철 경로 | REST 키 준비 필요 | 서버 `KAKAO_REST_KEY` |
| 자동차 경로 | 해당 API 설정·키 준비 필요 | 서버 `KAKAO_MOBILITY_REST_KEY` |

지도와 로그인은 별도 설정입니다. 로그인에는 카카오 앱의 REST API 키와 활성화한 로그인 보안 설정에 따른 Client Secret을 Supabase 제공자에 연결합니다. 카카오에 등록하는 리디렉션은 Supabase의 `/auth/v1/callback`이며, 우리 앱 복귀 URL은 Supabase의 Site URL·허용 리디렉션에 설정합니다. 로컬 예시는 카카오 쪽 `http://127.0.0.1:54321/auth/v1/callback`, 웹 복귀 `http://127.0.0.1:5173/auth/callback`입니다. 설정한 실제 Supabase 주소에 맞춰 확인해야 합니다. [Supabase 카카오 로그인](https://supabase.com/docs/guides/auth/social-login/auth-kakao)

우리 회원 식별은 인증 사용자 ID를 사용하며 이메일을 필수로 요구하지 않습니다. Kakao 제공자의 이메일 선택 설정과 닉네임 동의를 연결했고 실제 이메일 없는 계정으로 재로그인을 확인했습니다. 현재 로컬 `VITE_KAKAO_LOGIN_ENABLED=true`입니다. 동의 취소, 다른 카카오 계정 전환, 아이폰·안드로이드 실제 복귀는 별도 검증이 남아 있습니다.

`email_optional=true`는 이메일 없는 로그인을 허용하는 설정이며 기본 요청 scope를 제거하지 않습니다. 현재 Auth는 기본적으로 이메일·프로필 사진·닉네임을 요청하므로, 웹·설치 앱 모두 `queryParams: {scope: 'profile_nickname'}`으로 요청 항목을 줄입니다. `options.scopes`는 기본값에 추가돼 이 문제를 해결하지 못합니다. 공개 queryParams API를 사용하지만 기본 scope 덮어쓰기 의미는 전용 설정 계약보다 현재 Auth 구현에 의존합니다. Auth `v2.197.0`과 실제 SDK를 통과한 최종 인가 요청을 회귀 테스트하므로, Auth 업그레이드 때 이 테스트를 다시 확인해야 합니다. 과거 동의로 이메일이 응답에 들어오는 경우까지 이메일 저장 금지를 보장하는 설정은 아닙니다. [공식 Auth 구현](https://github.com/supabase/auth/blob/v2.197.0/internal/api/provider/kakao.go)

카카오 설정은 앱 선택 → **카카오 로그인 → 동의항목 → 닉네임(profile_nickname) [설정]**에서 합니다. 현재 안내한 동의 목적은 '농구 매칭 서비스에서 회원을 표시하고 참가자를 구분하기 위해 사용'입니다. 이메일·프로필 사진 권한은 이번 요청에서 제외합니다. [동의항목 설정](https://developers.kakao.com/docs/ko/kakaologin/prerequisite), [KOE205 공식 안내](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting)

내장 브라우저의 '브라우저 설정을 확인해 주세요'는 카카오 계정 인증 단계의 별도 문제입니다. 카카오는 쿠키·사이트 데이터 등 브라우저 환경을 확인하도록 안내합니다. 이번에는 브라우저 보안 설정을 바꾸지 않고 일반 Chrome에서 **서비스 로그인 버튼으로 새 절차를 시작**해 원인을 분리했습니다. 기존 인증 주소를 다른 브라우저에 복사하면 PKCE 저장소가 달라질 수 있으므로 복사하지 않습니다. [카카오 고객센터](https://cs.kakao.com/helps_html/1073209942)

로컬 키 입력 파일은 프로젝트 루트의 `.env`입니다. `SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID`에는 REST API 키, `SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET`에는 해당 키의 Client Secret을 입력합니다. `.env.example`은 빈 입력 예시이며 실제 `.env`는 Git 제외·권한 600으로 보관합니다. `supabase/config.toml`은 비밀 값을 직접 넣지 않고 `env(...)`로 참조합니다. 키 변경 후에는 로컬 Supabase를 데이터 보존 방식으로 재시작해야 합니다. 이번 재시작 전후 회원·신청·경기 수가 보존됐고, 실행 중인 Auth와 비공개 파일의 값이 일치함을 확인했습니다. 값 자체는 검증 출력에 포함하지 않았습니다. [로컬 설정 공식 안내](https://supabase.com/docs/guides/local-development/managing-config)

이전에 표시된 `bad_oauth_callback`·`OAuth state parameter missing`은 외부 로그인 결과를 받는 경로에서 state가 없다는 뜻입니다. 로컬 콜백 주소를 로그인 시작 없이 요청했을 때 같은 오류가 재현됐습니다. 사용자의 실제 진입 경로가 확인되지 않았으므로 직접 방문했다고 단정하지 않습니다. 정상 시작은 서비스 로그인 버튼 → Supabase authorize → 카카오 → Supabase callback → 서비스 callback이며, state 검사를 생략해서 해결하지 않습니다. 제공자 활성화와 키 연결은 별도로 확인합니다.

장소·이동 시간 조회는 JavaScript 지도 키로 대신 호출하지 않습니다. REST 키는 `apps/server/.dev.vars`에 두며 `VITE_` 변수로 보내지 않습니다. 지하철은 도보·환승 포함 총 시간(초)을 사용하고 버스가 섞인 경로를 지하철 결과로 표시하지 않습니다. 조회 실패·키 미설정은 **이동 시간 미확인**입니다. 경기 시작 시점의 소요 시간을 보장하지 않으며 조회 시점 기준으로 표시합니다. [카카오 장소·대중교통 API](https://developers.kakao.com/docs/ko/kakaomap/rest-api), [자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions.html)

## 2. 실제 설정 후 확인

1. 키 값은 채팅에 보내지 않고 각 제공자 설정 또는 Git 제외 파일에 보관합니다.
2. Chrome 웹의 로그인 성공·조건 저장·새로고침·재로그인은 확인했습니다. 동의 취소·다른 카카오 계정 전환은 추가로 확인합니다.
3. 서울·인천 시설 각각의 장소 검색·지하철·자동차 경로를 실제 응답으로 확인합니다.
4. 설치 앱은 등록된 HTTPS API·지도 주소와 양 OS 복귀·도메인 검증을 별도로 진행합니다.

## 3. 세 줄 요약

- 기존 카카오 지도는 새 화면에서 실제 동작을 확인했습니다.
- Chrome 웹에서 이메일 없는 실제 카카오 로그인·계정 조건 저장·새로고침·재로그인을 확인했습니다.
- 동의 취소·다른 계정 전환, REST 장소·경로와 설치 앱 복귀는 별도로 검증합니다.
