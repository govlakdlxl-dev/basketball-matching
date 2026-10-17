# 카카오 연결 상태와 설정 준비

## 1. 한 페이지 안내

2026-10-18 기준 **로컬 Supabase의 카카오 제공자와 웹 로그인 버튼을 활성화**했습니다. 사용자는 카카오디벨로퍼스의 로그인 ON·리디렉션 등록·키 저장을 확인했습니다. 서비스 버튼에서 카카오계정 로그인 화면까지 이동했으며, 본인 인증·동의 후 서비스 복귀와 세션 생성은 아직 확인하지 않았습니다. 기존 `04_시안_카카오맵/config.js`를 재사용했고 `localhost:8000` 지도 화면에서 실제 타일·시설 핀·카드 선택을 확인했습니다. 지도 키는 코드 저장소에 포함하지 않습니다.

| 연결 | 현재 상태 | 설정 위치 |
|---|---|---|
| 카카오 지도 JavaScript SDK | 실제 표시 확인 | 기존 `config.js`·등록 도메인 |
| 카카오 로그인 | 로컬 서버·버튼 활성화 · 카카오계정 화면 이동 확인 · 실제 복귀 대기 | 루트 `.env`·`supabase/config.toml`, 카카오 리디렉션 |
| 장소 검색·지하철 경로 | REST 키 준비 필요 | 서버 `KAKAO_REST_KEY` |
| 자동차 경로 | 해당 API 설정·키 준비 필요 | 서버 `KAKAO_MOBILITY_REST_KEY` |

지도와 로그인은 별도 설정입니다. 로그인에는 카카오 앱의 REST API 키와 활성화한 로그인 보안 설정에 따른 Client Secret을 Supabase 제공자에 연결합니다. 카카오에 등록하는 리디렉션은 Supabase의 `/auth/v1/callback`이며, 우리 앱 복귀 URL은 Supabase의 Site URL·허용 리디렉션에 설정합니다. 로컬 예시는 카카오 쪽 `http://127.0.0.1:54321/auth/v1/callback`, 웹 복귀 `http://127.0.0.1:5173/auth/callback`입니다. 설정한 실제 Supabase 주소에 맞춰 확인해야 합니다. [Supabase 카카오 로그인](https://supabase.com/docs/guides/auth/social-login/auth-kakao)

우리 회원 식별은 인증 사용자 ID를 사용하며 이메일을 필수로 요구하지 않습니다. Kakao 제공자의 이메일 선택 설정과 필요한 동의 항목을 확인한 뒤 실제 이메일 없는 계정의 재로그인을 검증합니다. 현재 로컬 `VITE_KAKAO_LOGIN_ENABLED=true`이며, 실제 성공·거절·재로그인은 계속 확인해야 합니다.

로컬 키 입력 파일은 프로젝트 루트의 `.env`입니다. `SUPABASE_AUTH_EXTERNAL_KAKAO_CLIENT_ID`에는 REST API 키, `SUPABASE_AUTH_EXTERNAL_KAKAO_SECRET`에는 해당 키의 Client Secret을 입력합니다. `.env.example`은 빈 입력 예시이며 실제 `.env`는 Git 제외·권한 600으로 보관합니다. `supabase/config.toml`은 비밀 값을 직접 넣지 않고 `env(...)`로 참조합니다. 키 변경 후에는 로컬 Supabase를 데이터 보존 방식으로 재시작해야 합니다. 이번 재시작 전후 회원·신청·경기 수가 보존됐고, 실행 중인 Auth와 비공개 파일의 값이 일치함을 확인했습니다. 값 자체는 검증 출력에 포함하지 않았습니다. [로컬 설정 공식 안내](https://supabase.com/docs/guides/local-development/managing-config)

현재 URL의 `bad_oauth_callback`·`OAuth state parameter missing`은 외부 로그인 결과를 받는 경로에서 state가 없다는 뜻입니다. 로컬 콜백 주소를 로그인 시작 없이 요청했을 때 같은 오류가 재현됐습니다. 사용자의 실제 진입 경로가 확인되지 않았으므로 직접 방문했다고 단정하지 않습니다. 정상 시작은 서비스 로그인 버튼 → Supabase authorize → 카카오 → Supabase callback → 서비스 callback이며, state 검사를 생략해서 해결하지 않습니다. 제공자 활성화와 키 연결은 별도로 확인합니다.

장소·이동 시간 조회는 JavaScript 지도 키로 대신 호출하지 않습니다. REST 키는 `apps/server/.dev.vars`에 두며 `VITE_` 변수로 보내지 않습니다. 지하철은 도보·환승 포함 총 시간(초)을 사용하고 버스가 섞인 경로를 지하철 결과로 표시하지 않습니다. 조회 실패·키 미설정은 **이동 시간 미확인**입니다. 경기 시작 시점의 소요 시간을 보장하지 않으며 조회 시점 기준으로 표시합니다. [카카오 장소·대중교통 API](https://developers.kakao.com/docs/ko/kakaomap/rest-api), [자동차 길찾기](https://developers.kakaomobility.com/guide/navi-api/directions.html)

## 2. 실제 설정 후 확인

1. 키 값은 채팅에 보내지 않고 각 제공자 설정 또는 Git 제외 파일에 보관합니다.
2. 로그인 성공·취소·재로그인과 계정 전환 시 이전 조건 제거를 확인합니다.
3. 서울·인천 시설 각각의 장소 검색·지하철·자동차 경로를 실제 응답으로 확인합니다.
4. 설치 앱은 등록된 HTTPS API·지도 주소와 양 OS 복귀·도메인 검증을 별도로 진행합니다.

## 3. 세 줄 요약

- 기존 카카오 지도는 새 화면에서 실제 동작을 확인했습니다.
- 카카오 로그인 서버·버튼과 카카오계정 화면 연결을 확인했으며 실제 로그인 완료는 대기 중입니다.
- 본인 로그인 후 계정 조건 저장·재로그인을 확인하고, REST 장소·경로와 설치 앱 복귀는 별도로 검증합니다.
