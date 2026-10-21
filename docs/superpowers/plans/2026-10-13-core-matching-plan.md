# A. 공통 모집 기능 구현 계획

> **에이전트 실행자:** superpowers:subagent-driven-development 또는 superpowers:executing-plans로 체크박스 작업을 순서대로 실행한다.

**목표:** 서로 다른 회원이 실제 시설을 사용한 모집에 신청하고 승인 팀 담당자의 판단을 공유하는 웹·서버 기능을 만든다.

**구조:** 순수 도메인 규칙과 공통 타입은 packages/core에, 인증·명령은 Workers에, 원자적 권한·정원 처리는 PostgreSQL에 둔다. 공개 목록과 개인 조건·신청을 분리한다.

**기술:** TypeScript/Vite, Supabase Auth/PostgreSQL/pgTAP, Workers, Vitest/Playwright.

**명세:** [상세 설계](../specs/2026-10-13-basketball-matching-design.md), [공통 계획·계약](2026-10-13-basketball-implementation-plan.md).

## 공통 제약

전체 공통 계획의 제약을 적용한다. 첫 요율 0%, 서울·인천 실내 중심, 승인 팀의 주장·총무만 모집, 조건 저장 후 접속할 때 표시, 원본 시안·예시 후기를 실제 데이터로 공개하지 않음, UTC 저장·한국 시간 표시, 신청 당시 조건 보존이다.

## 검토 초점

1. 시설·팀 설명의 HTML 문자열 — 문자로 렌더링한다: A3·A5.
2. 전송 완료 뒤 응답 유실 — 같은 명령 재시도는 같은 결과다: A4.
3. 기기 시간대·시계가 다름 — 서버 시각·한국 시간 조건이 유지된다: A1·A3.
4. 참가비 0원 — 서버 수락으로 무료 참가를 확정하고 PG를 요구하지 않는다: A4.
5. 권한 중단·탈퇴 요청 — 신규 모집은 차단하되 기존 신청·처리 경로는 남긴다: A2·A5.

## 작업 A1. 공통 계약·시각·가격과 실행 가능한 화면 틀

**파일:** 생성 package.json, pnpm-workspace.yaml, tsconfig.base.json, vitest.config.ts, playwright.config.ts, .gitignore, .env.example, packages/core/{package.json,src/contracts.ts,src/time.ts,src/money.ts,tests/time.test.ts,tests/money.test.ts}, apps/web/{package.json,index.html,src/main.ts,src/app/router.ts,src/styles/theme.css,src/styles/layout.css,vite.config.ts}, apps/server/{package.json,wrangler.jsonc,src/index.ts}. 원본은 reference/original-prototype.html 참고 사본으로 보존한다.

**입출력 계약:** 공통 계획 4절의 타입을 정의·내보낸다. calculatePaymentDeadline(acceptedAt: UtcInstant, startsAt: UtcInstant): UtcInstant, quoteInitialTest(baseFeeKrw: Won): PricingSnapshot & {platformRateBps: 0; purpose: 'initial_test_order'}, quoteFutureExample(baseFeeKrw: Won, rateBps: 500 | 1000): PricingSnapshot & {purpose: 'calculator_only'}를 제공한다. GET /api/clock은 {now: UtcInstant}를 반환한다.

- [ ] 실패 검증을 작성한다. 19시 경기·18시 10분 수락은 18시 40분 기한, 18시 50분 수락은 19시 기한, 10,000원 초기 계산은 결제·팀 10,000원/플랫폼 0원, 9,900원·5% 별도 예시는 10,147원/9,652원/495원이다.

        expect(calculatePaymentDeadline('2026-10-13T09:50:00Z','2026-10-13T10:00:00Z')).toBe('2026-10-13T10:00:00Z');
        expect(quoteInitialTest(10000).paymentAmountKrw).toBe(10000);
        expect(quoteFutureExample(9900,500).teamBasisKrw).toBe(9652);

- [ ] 프로젝트 도구를 해당 산출물에 필요한 범위로 준비한다. 패키지 이름은 @basket/core·@basket/web·@basket/server, 공통 타입·함수는 core의 package exports로 내보낸다. 루트에 Vitest·Playwright 실행 설정과 typecheck/build 스크립트를 두고 E2E는 로컬 웹·Worker만 실행한다. pnpm exec vitest run packages/core/tests/time.test.ts packages/core/tests/money.test.ts를 실행한다. 함수 미정의로 실패해야 한다.
- [ ] 계약·정수 가격·시간 함수를 구현한다. 음수·소수·안전 정수 범위 초과는 거부한다. 기본 서체·색·560px 화면·하단 탭을 기존 시안에서 옮기고 Vite 빌드·시계 API를 연결한다. 제품 패키지는 정확한 안정 버전으로 고정한다.
- [ ] 같은 검증과 pnpm --filter @basket/web build를 실행한다. 시간·가격 단언 통과, dist 생성, 모바일 폭에서 탭·문구 확인이 완료 기준이다. CSS를 그대로 따라 쓰는 테스트는 만들지 않는다.
- [ ] 해당 생성 파일·lockfile·원본 참고 사본만 추가하고 “공통 계약과 서버 기준 시간 및 초기 무료 가격 추가”로 커밋한다.

## 작업 A2. 공유 DB·회원·역할·개인 조건

**파일:** 생성 supabase/config.toml, supabase/migrations/202610130001_core.sql, supabase/tests/core_permissions.sql, apps/server/src/{infra/database.ts,http/auth.ts,http/router.ts,features/accounts/handlers.ts}, apps/web/src/features/auth/{session.ts,view.ts}, packages/core/src/preferences.ts, tests/integration/auth-permissions.test.ts, tests/integration/fixtures/database.ts. 수정 apps/web/src/app/router.ts.

**입출력 계약:** requireActor(request: Request): Promise<AuthActor>, getPreferences(actor: AuthActor): Promise<Preferences | null>, savePreferences(actor: AuthActor, input: Preferences): Promise<Preferences>. Preferences는 origin: Point, mode: 'subway' | 'car', maxMinutes: 양의 정수, dateFrom/dateTo: YYYY-MM-DD, weekdays: 1~7 배열, earliestStartMinute/latestStartMinute: 0~1439, latestEndMinute: number | null, position: Position | null이다.

**HTTP·검증 경계:** GET/PUT /api/me/preferences는 본인 actor만 사용한다. POST /api/teams는 {name,contactRoute,evidence} 등록 요청, POST /api/operator/teams/:id/review는 {decision:'approved'|'needs_info'|'rejected',reason}를 받으며 운영자만 허용한다. profiles에는 클라이언트가 변경할 수 있는 role 열을 두지 않는다. 테스트 DB fixture는 createDatabaseFixture():Promise<{memberA:AuthActor;memberB:AuthActor;captain:AuthActor;reset():Promise<void>}>를 제공한다. DB 판정 시각은 server_now() 기본 clock_timestamp()이며, 로컬 전용 fixture만 시각을 고정한다. 외부 HTTP의 now·actor 입력은 받지 않고 테스트 도구는 localhost DB만 연결한다.

reviewTeam(actor:AuthActor,input:{teamId:Id;decision:'approved'|'needs_info'|'rejected';reason:string;requestId:Id}):Promise<void>와 updateTeamMember(actor:AuthActor,input:{teamId:Id;userId:Id;role:'captain'|'secretary'|'member';active:boolean;requestId:Id}):Promise<void>를 서버에 둔다. 검토는 운영자, 담당 변경은 운영자 또는 현재 주장에게만 허용하고 자기 팀 범위를 검사한다. 팀 요청·승인·담당 변경 이력을 activity_records에 남긴다.

- [ ] DB 권한 검증을 작성한다. 회원 A만 A의 조건을 조회·변경하고 B는 거부된다. 프로필 role 입력·다른 팀 담당자 사칭·비활성 담당자·미승인 팀은 권한을 얻지 못한다. 날짜 역전·좌표 범위 오류·요일 오류는 저장되지 않는다.

        expect((await clientB.from('profiles').select('preferences').eq('id',memberA.userId)).data).toEqual([]);
        expect((await clientA.from('profiles').update({role:'operator'}).eq('id',memberA.userId)).error).not.toBeNull();

위 clientA/clientB는 테스트 안에서 각 회원 JWT를 가진 Supabase 클라이언트로 생성한다. 공통 fixture에 setLocalDatabaseTime(instant:UtcInstant):Promise<void>를 두고 local DB에서만 server_now()를 일시 교체·복구한다. DB 통합 검증은 직렬 실행해 서로의 기준 시각을 바꾸지 않으며 운영 마이그레이션에는 테스트용 시각·설정 테이블을 포함하지 않는다.

- [ ] 로컬 컨테이너 런타임·프로젝트 Supabase CLI를 준비하고 pnpm exec supabase start 및 pnpm exec supabase test db를 실행한다. 아직 권한 테이블·정책이 없어 실패해야 한다. 외부 운영 DB는 연결하지 않는다.
- [ ] profiles, teams, team_memberships, facilities, refund_policies, matches, applications, activity_records, command_receipts를 정의한다. profile의 개인 조건은 소유자 전용이며 모집자 응답에는 허용된 별칭·포지션만 서버가 투영한다. 역할 변경·운영자 승인 함수만 권한을 바꾸며 운영 역할은 서버 관리 정보로 확인한다. requireActor는 토큰 검증을 거치고 역할은 DB의 현재 값으로 재검사한다.
- [ ] 같은 DB 검증과 pnpm exec vitest run tests/integration/auth-permissions.test.ts를 통과시킨다. 카카오 OAuth·이메일 없는 계정 재로그인은 설정된 환경에서 별도로 확인하며 자동 메일을 요구하지 않는다. 계정 변경 시 화면의 이전 회원 상태·조건을 비운다.
- [ ] DB·인증·조건 관련 파일만 “회원 소유권과 승인 팀 권한 연결”로 커밋한다.

## 작업 A3. 실제 시설·지도·개인 조건 검색

**파일:** 생성 apps/server/src/features/facilities/{handlers.ts,kakao-local.ts}, apps/server/src/features/routes/kakao-routing.ts, apps/web/{map.html,src/features/map/{frame.ts,protocol.ts,view.ts},src/features/facilities/view.ts,src/features/search/{view.ts,controller.ts}}, packages/core/src/{search.ts,map-protocol.ts}, data/verified-facilities.json, tests/integration/routes.test.ts, tests/e2e/facilities-search.spec.ts. 수정 공통 contracts.ts, 서버·웹 router.ts.

**입출력 계약:** saveFacility(input: FacilityInput, actor: AuthActor): Promise<Facility>, searchPlaces(query: string): Promise<PlaceCandidate[]>, estimateRoute(input: {origin: Point; facilityId: Id; mode: 'subway' | 'car'}): Promise<RouteEstimate>, matchesPreferences(match: SearchableMatch, prefs: Preferences, route: RouteEstimate): 'matched' | 'unmatched' | 'unknown'. SearchableMatch={startsAt:UtcInstant,endsAt:UtcInstant,recruitmentStatus:'open'|'closed'|'cancelled',positionsAvailable:Position[]}를 search.ts에 둔다. A4 실제 조회 결과는 MatchRoster.positionSlots의 available>0 포지션을 이 입력으로 투영한다. A3 E2E 경기 값은 테스트 fixture이며 실제 모집으로 게시하지 않는다. RouteEstimate={status:'available',durationSeconds:number,queriedAt:UtcInstant,basis:'query_time',mode:'subway'|'car',provider:string} | {status:'unknown',reason:string}다.

**타입·지도 경계:** contracts.ts의 FacilityInput={name,address,point:Point,region:'seoul'|'incheon',registration:'operator'|'map_search'|'manual_pin',sourceUrl:string|null,evidence:string}, Facility=FacilityInput & {id:Id,registeredBy:Id,locationStatus:'unverified'|'verified',basketballUseStatus:'unverified'|'verified',verifiedAt:UtcInstant|null}, PlaceCandidate={providerId:string,name,address,point:Point}다. 확인 필드는 서버가 운영 역할로만 변경하고 주최자 등록 값은 unverified다. POST /api/facilities, GET /api/places?q=, POST /api/routes로 연결한다. 장소·경로 공개 조회에는 길이 제한·호출 제한·시간 제한을 두며 REST 비밀은 서버에 둔다.

map-protocol.ts의 MapCommand={type:'show_points',nonce:string,points:{id:Id,point:Point,label:string}[]} | {type:'pick_point',nonce:string,center:Point}, MapEvent={type:'ready',nonce:string} | {type:'point_selected',nonce:string,point:Point} | {type:'error',nonce:string,code:string}다. MapTrustContext={origin:string,expectedOrigin:string,source:unknown,expectedSource:unknown,nonce:string}, validateMapEvent(value:unknown,context:MapTrustContext):MapEvent|null은 웹 protocol.ts가 구현한다. frame별 허용 HTTPS origin·event.source·현재 nonce를 모두 검사한다. 네이티브 부모는 허용된 로컬 origin을 지도 구성요소 초기 설정에 전달하되 '*', 임의 origin 반사·실행 명령은 허용하지 않는다.

- [ ] 경로·등록 검증을 작성한다. 1,800초는 30분 조건 충족, 1,801초는 미충족, API 실패는 unknown, 버스 포함 경로를 지하철 결과로 표시하지 않음, 최대 60분 설정에서 가까운 10분 경기도 포함이다. 검색 없는 장소 등록과 악성 이름의 문자 표시도 확인한다.

        expect(matchesPreferences(match,prefs,{status:'unknown',reason:'NO_ROUTE'})).toBe('unknown');
        await expect(page.getByText('<img src=x onerror=alert(1)>',{exact:true})).toBeVisible();

- [ ] pnpm exec vitest run tests/integration/routes.test.ts 및 pnpm exec playwright test tests/e2e/facilities-search.spec.ts를 실행한다. 경로·저장·검색 화면 미구현으로 실패해야 한다.
- [ ] 출처를 다시 확인한 서울·인천 실내 시설을 각각 최소 1곳부터 등록한다. 공식 페이지의 이름·주소·좌표·확인 항목을 기록하고 예약 가능·샤워실 등을 추측하지 않는다. 승인 담당자의 지도 검색·수동 이름/주소/핀 등록을 구현한다. 카카오 지도 HTTPS 화면을 map.html에 분리하고 출처·요청 nonce·자료 형태를 검사하는 MapCommand/MapEvent를 protocol.ts에 정의한다. 지도 페이지에는 인증·결제 비밀을 전달하지 않는다.
- [ ] 같은 검증을 통과시키고 원본 카드 스타일로 조건 수정·저장·빈 목록·미확인 경로·고정 경기 날짜를 확인한다. 실제 경로 응답은 공식 필드·단위를 어댑터에서 확인하고 도보를 두 번 더하지 않는다. 키 미설정은 API 호출 성공으로 보고하지 않는다.
- [ ] 시설 데이터·지도·검색 관련 파일만 “실제 시설 등록과 저장 조건 검색 연결”로 커밋한다.

## 작업 A4. 모집·신청·수락·정원과 두 회원 흐름

**파일:** 생성 supabase/migrations/202610130002_applications.sql, supabase/tests/application_capacity.sql, apps/server/src/features/matches/{commands.ts,queries.ts}, apps/server/src/features/applications/commands.ts, apps/web/src/features/{matches/{card.ts,detail.ts},applications/view.ts,hosting/view.ts}, tests/integration/application-capacity.test.ts, tests/e2e/core-flow.spec.ts. 수정 공통 contracts.ts, 서버·웹 router.ts.

**입출력 계약:** publishMatch(actor: AuthActor, input: MatchInput, requestId: Id): Promise<MatchSummary>, submitApplication(actor: AuthActor, input: {matchId: Id; position: Position; requestId: Id}): Promise<ApplicationRecord>, acceptApplication(actor: AuthActor, input: {applicationId: Id; requestId: Id}): Promise<ApplicationRecord>, rejectApplication(actor:AuthActor,input:{applicationId:Id;reason:string;requestId:Id}):Promise<ApplicationRecord>, getPaymentContext(actor: AuthActor, applicationId: Id): Promise<PaymentContext>, getMatchRoster(matchId: Id): Promise<MatchRoster>다.

expireUnpaidApplications():Promise<number>는 서버·DB 시각으로 awaiting_payment만 만료시킨다. 조회·신청·수락 처리 전에 해당 경기의 만료 대기를 정리하고 application.expired·roster.changed를 원자 기록한다. verifying_payment는 이 함수로 만료하지 않는다.

**공유 타입:** contracts.ts에 MatchInput={teamId,facilityId,startsAt,endsAt,playersPerTeam:3|4|5,teamCount:number,existingPlanned:number,guestSlots:Record<Position,number>,baseFeeKrw:Won,policy:PolicySnapshot,meetingPoint:string,rotationDescription:string,guestComposition:string,captainCoordination:string,reservationNote:string,expectedPlayingMinutes:number|null}, MatchSummary=MatchInput & {id:Id,facility:Facility,recruitmentStatus:'open'|'closed'|'cancelled',formatVersion:number,roster:MatchRoster}, ApplicationRecord={id:Id,matchId:Id,applicantId:Id,position:Position,state:AppState,submittedAt:UtcInstant,acceptedAt:UtcInstant|null,paymentDeadlineAt:UtcInstant|null,terms:TermsSnapshot}, PaymentContext={application:ApplicationRecord,teamId:Id,recruitmentStatus:MatchSummary['recruitmentStatus']}를 정의한다. 시간 필드는 UtcInstant, ID는 Id다. 모든 수량은 0 이상 정수, teamCount는 2 이상이며 총 계획 인원·포지션 합·경기 방식의 관계를 검증한다.

**조회·이벤트:** getMatchNotificationContext(matchId:Id):Promise<MatchNotificationContext>를 서버 전용으로 제공한다. MatchNotificationContext={match:{id:Id,startsAt:UtcInstant,recruitmentStatus:MatchSummary['recruitmentStatus']},roster:MatchRoster,applications:ApplicationRecord[],activeCaptainIds:Id[]}이며 A5가 formatNotices·cancellations를 확장한다. POST /api/matches, GET /api/matches, GET /api/matches/:id, POST /api/matches/:id/applications, POST /api/applications/:id/accept 및 /reject로 연결한다. 공개 경기 조회에 비공개 신청을 섞지 않고 담당자의 신청 목록은 현재 팀 권한을 검사한다.

- [ ] 마지막 전체 자리·포지션 자리의 동시 수락 검증, 동일 신청·수락 재시도 검증, 다른 포지션 자동 배정 거부 검증, 무료 경기 PG 미호출 검증을 작성한다.

        const results = await Promise.allSettled([acceptApplication(captain,{applicationId:appA.id,requestId:'accept-a'}),acceptApplication(captain,{applicationId:appB.id,requestId:'accept-b'})]);
        expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
        expect((await getMatchRoster(match.id)).awaitingPayment).toBe(1);

- [ ] pnpm exec supabase test db와 pnpm exec vitest run tests/integration/application-capacity.test.ts를 실행해 미구현 정원 전이로 실패를 확인한다.
- [ ] 모집글→신청 잠금과 불변 terms 스냅숏을 구현한다. command_receipts는 actor·명령·requestId·입력 hash를 유일하게 기록하고 같은 입력만 같은 결과를 반환한다. 유효 결제 대기·확인 중·확정이 자리를 점유하며 만료 대기는 반환한다. 0원 참가비는 서버 수락으로 confirmed, 양수는 awaiting_payment로 전환한다. 신청 대기는 자리 차감이 없다.
- [ ] DB·동시 검증과 두 회원 E2E를 통과시킨다. 담당자의 수락이 신청자에게 전달되고 기존 예정 인원·앱 확정·결제 대기·신규 모집 가능 수가 구분되어야 한다. 날짜가 재접속으로 바뀌지 않아야 한다.
- [ ] 모집·신청·정원 관련 파일만 “공유 신청과 원자적 게스트 수락 연결”로 커밋한다.

## 작업 A5. 주최자 진행 안내·방식 변경·운영 관리

**파일:** 생성 supabase/migrations/202610130003_operations.sql, supabase/tests/operations_permissions.sql, apps/server/src/features/operations/commands.ts, apps/server/src/features/applications/cancellation.ts, apps/web/src/features/operations/view.ts, tests/integration/operations.test.ts, tests/e2e/host-announcement.spec.ts. 수정 공통 contracts.ts, A4 queries.ts, 서버·웹 router.ts.

**입출력 계약:** cancelApplication(actor: AuthActor, input: {applicationId: Id; cause:'personal'|'format_change_declined'; formatChangeId:Id|null; requestId:Id}): Promise<CancellationReceipt>, cancelMatch(actor: AuthActor, input:{matchId:Id; requestId:Id}): Promise<CancellationReceipt[]>, announceFormatChange(actor: AuthActor, input:{matchId:Id; playersPerTeam:3|4|5; reason:string; requestId:Id}): Promise<FormatNotice>. FormatNotice는 id·matchId·version·previous/currentPlayersPerTeam·actorId·announcedAt·affectedApplicationIds다. requestAccountDeletion(actor: AuthActor): Promise<{status:'needs_resolution'|'completed'}>를 제공한다.

**진행·운영 계약:** reportProceeding(actor:AuthActor,input:{matchId:Id;reason:string;requestId:Id}):Promise<{matchId:Id;reportedBy:Id;reportedAt:UtcInstant;source:'host_report'}>, reportIssue(actor:AuthActor,input:{matchId:Id|null;facilityId:Id|null;text:string;requestId:Id}):Promise<{issueId:Id}>, moderateMatch(actor:AuthActor,input:{matchId:Id;action:'hide'|'stop_recruitment';reason:string;requestId:Id}):Promise<void>를 제공한다. POST /api/applications/:id/cancel, /api/matches/:id/cancel, /api/matches/:id/format-notices, /api/matches/:id/proceeding, /api/issues, /api/operator/matches/:id/moderation, /api/me/deletion로 연결한다. MatchNotificationContext에 formatNotices:FormatNotice[]·cancellations:CancellationReceipt[]·hostReports:{id:Id;reportedBy:Id;reportedAt:UtcInstant;reason:string}[]를 추가한다. 진행 기재는 match.proceeding_reported 이벤트를 생성하며 현장 참석이나 신청 인원 수를 바꾸지 않는다.

- [ ] 권한 중단 이후 기존 기록·운영 처리, 4대4 안내의 출처·버전·불참, 장소·일시·금액·정책 직접 변경 거부, 마지막 담당자 탈퇴 요청의 미처리 경기 보존을 검증한다.

        expect(notice.affectedApplicationIds).toContain(activeApplication.id);
        expect(notice.affectedApplicationIds).not.toContain(cancelledBeforeNotice.id);
        expect((await cancelApplication(memberA,{applicationId:activeApplication.id,cause:'format_change_declined',formatChangeId:notice.id,requestId:'decline-1'})).cause).toBe('format_change_declined');

- [ ] pnpm exec supabase test db와 pnpm exec vitest run tests/integration/operations.test.ts를 실행해 전이·권한 미구현 실패를 확인한다.
- [ ] 승인·숨김·제보·모집 중단·설명 보충·주최자 진행 안내를 이력으로 구현한다. 방식 변경은 당시 활성 신청을 대상으로 안내하고 불참 시 자리 반환·CancellationReceipt·roster.changed를 같은 트랜잭션에 기록한다. 팀 취소는 이전 부분 환불 신청도 포함해 신청별 receipt를 보존한다. 이벤트는 activity_records에 원자적으로 남기고 서버만 생성한다. 탈퇴는 남은 경기·환불 처리 필요를 표시한 후 해결·개인 정보 정리·기기 연결 해지로 완료하며 기록을 임의 삭제하지 않는다.
- [ ] 같은 검증과 pnpm exec playwright test tests/e2e/host-announcement.spec.ts를 통과시킨다. 화면은 주최자 기재를 현장 검증으로 표현하지 않는다. 동의하지 않은 변경을 자동 동의로 표시하지 않는다.
- [ ] 운영·취소 관련 파일만 “주최자 진행 안내와 변경 불참 및 운영 기록 추가”로 커밋한다.

## 완료·연결 기준

공통 웹·DB 기능은 두 계정으로 독립 검증된다. 양수 참가비의 결제는 B가 연결하고, 취소 receipt의 환불은 B4가 소비한다. 지급·계약 승인까지 완료한 서비스로 공개하지 않는다. C1은 A3 뒤에 먼저 수행하고 앱의 지도·복귀 문제를 확인한 다음 공통 흐름을 확대한다.
