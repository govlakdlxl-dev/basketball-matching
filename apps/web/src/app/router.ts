import { initializeSession, onSessionChanged } from '../features/auth/session';
import { preferencesView } from '../features/preferences/view';
import {searchView} from '../features/search/view';
import {hostingView} from '../features/facilities/view';
import {matchDetail} from '../features/matches/detail';
import {applicationsView} from '../features/applications/view';
import {operatorView} from '../features/operations/view';

export const routes = [
  ['/matches', '경기 찾기', '⌕'], ['/applications', '참여 내역', '✓'],
  ['/notifications', '알림', '◉'], ['/hosting', '모집', '+'], ['/preferences', '내 조건', '≡'],
] as const;

export function mountRouter(root: HTMLElement) {
  root.innerHTML = `<div class="wrap"><header class="brand"><div><p class="eyebrow">BASKETBALL · GUEST</p><h1>가까운 코트에서<br>함께 뛰어요</h1><p class="sub">서울·인천 실내 농구 게스트 매칭</p></div><span class="ball-mark" aria-hidden="true">◌</span></header><main id="content" tabindex="-1"></main><p class="connection" role="status" id="connection"></p></div><nav class="tabs" aria-label="주 메뉴"><div class="in"></div></nav>`;
  const main = root.querySelector<HTMLElement>('#content')!;
  const nav = root.querySelector<HTMLElement>('.tabs .in')!;
  for (const [path, label, icon] of routes) {
    const link = document.createElement('a');
    link.className = 'tab'; link.href = `#${path}`;
    const mark = document.createElement('span'); mark.className = 'tab-icon'; mark.setAttribute('aria-hidden', 'true'); mark.textContent = icon;
    const text = document.createElement('span'); text.textContent = label;
    link.append(mark, text); nav.append(link);
  }
  function render() {
    const path = location.hash.slice(1) || '/matches';
    const detail=path.match(/^\/matches\/([0-9a-f-]{36})$/i);
    const selected = routes.find(route => route[0] === path) ?? routes[0];
    for (const link of nav.querySelectorAll('a')) {
      if (link.getAttribute('href') === `#${selected[0]}`) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    main.replaceChildren();
    const title = document.createElement('h2'); title.className = 'page-title'; title.textContent = detail?'경기 상세':selected[1]; main.append(title);
    // 이전 계정·경로의 비동기 응답은 분리된 컨테이너에 남아 현재 화면에 섞이지 않습니다.
    const panel=document.createElement('div');panel.className='page-view';main.append(panel);
    const card = document.createElement('section'); card.className = 'card empty-state';
    const heading = document.createElement('h3');
    const body = document.createElement('p'); body.className = 'muted';
    const copy = ({
      '/matches': ['내 일정에 맞는 경기를 한눈에', '출발지와 가능한 시간을 저장하면 가까운 경기를 모아 보여드려요.'],
      '/applications': ['신청한 경기를 여기서 확인하세요', '수락, 결제 기한, 참가 확정 상태를 함께 확인할 수 있어요.'],
      '/notifications': ['새로운 안내가 모이는 곳', '경기와 신청에 관한 중요한 안내를 여기서 확인하세요.'],
      '/hosting': ['우리 팀의 게스트를 모집하세요', '팀 등록과 담당자 확인을 마치면 모집을 시작할 수 있어요.'],
      '/preferences': ['내가 갈 수 있는 경기', '출발지, 이동수단, 최대 이동 시간과 가능한 시간대를 정해 보세요.'],
    } as const)[selected[0]];
    heading.textContent = copy[0]; body.textContent = copy[1]; card.append(heading, body);
    if (selected[0] === '/matches') {
      const action = document.createElement('a'); action.className = 'btn'; action.href = '#/preferences'; action.textContent = '내 조건 설정'; card.append(action);
    }
    if(path==='/operator') void operatorView(panel);
    else if(detail) void matchDetail(panel,detail[1]!);
    else if (selected[0] === '/preferences') void preferencesView(panel);
    else if(selected[0]==='/applications') void applicationsView(panel);
    else if(selected[0]==='/matches') void searchView(panel);
    else if(selected[0]==='/hosting') void hostingView(panel);
    else panel.append(card);
  }
  window.addEventListener('hashchange', render); render();
  onSessionChanged(render); void initializeSession();
  const status = root.querySelector<HTMLElement>('#connection')!;
  fetch(`${import.meta.env.VITE_API_BASE_URL || '/api'}/clock`).then(async response => {
    if (!response.ok) throw new Error('CONNECTION_FAILED');
    const { now } = await response.json() as { now: string };
    status.textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date(now));
  }).catch(() => { status.textContent = '연결을 확인하고 다시 접속해 주세요.'; });
}
