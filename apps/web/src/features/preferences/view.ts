import type { Preferences } from '@basket/core/preferences';
import { validatePreferences } from '@basket/core/preferences';
import { api, session } from '../auth/session';
import { authView } from '../auth/view';
import {mapView} from '../map/view';
import {deletionView} from '../operations/view';

const DEVICE_KEY = 'basketball-device-preferences-v1';
export function defaultPreferences(): Preferences {
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + 7);
  return { origin: { lat: 37.5665, lng: 126.978 }, mode: 'subway', maxMinutes: 30, dateFrom: today, dateTo: last.toISOString().slice(0, 10), weekdays: [1, 2, 3, 4, 5, 6, 7], earliestStartMinute: 0, latestStartMinute: 1439, latestEndMinute: null, position: null };
}
export function readDevicePreferences(): Preferences | null {
  try { const text = localStorage.getItem(DEVICE_KEY); return text ? validatePreferences(JSON.parse(text)) : null; } catch { return null; }
}
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const minute = (text: string) => { const [h, m] = text.split(':').map(Number); return h! * 60 + m!; };

export async function preferencesView(root: HTMLElement) {
  root.append(authView());
  const loading = document.createElement('p'); loading.className = 'muted'; loading.textContent = '조건을 불러오는 중…'; root.append(loading);
  const signedIn = Boolean(session());
  let prefs = signedIn ? defaultPreferences() : readDevicePreferences() || defaultPreferences();
  try { if (signedIn) prefs = await api<Preferences | null>('/me/preferences') || prefs; }
  catch { loading.textContent = '저장한 조건을 불러오지 못했어요. 다시 접속해 주세요.'; return; }
  loading.remove();
  const form = document.createElement('form'); form.className = 'card preference-form';
  form.innerHTML = `<h3>내가 갈 수 있는 경기</h3><p class="muted">원하는 일정과 이동 시간을 저장해 두세요.</p>
    <p class="origin-label muted">출발지 · 지도에서 위치를 선택해 주세요.</p><button type="button" class="btn sec origin-button">지도에서 출발지 선택</button><div class="origin-map" hidden></div>
    <details><summary>좌표 직접 입력</summary><div class="origin-picker"><label>출발지 위도<input name="lat" type="number" step="any" min="-90" max="90" required></label><label>출발지 경도<input name="lng" type="number" step="any" min="-180" max="180" required></label></div></details>
    <div class="grid2"><label>이동수단<select name="mode"><option value="subway">지하철 · 도보 포함</option><option value="car">자차</option></select></label><label>최대 이동 시간 (분)<input name="maxMinutes" type="number" min="1" max="1440" required></label></div>
    <p class="muted">지하철 30분, 자차 15분을 기본으로 추천해요. 더 멀리 갈 수 있는 날은 직접 바꿔 주세요.</p>
    <div class="grid2"><label>시작 날짜<input type="date" name="dateFrom" required></label><label>마지막 날짜<input type="date" name="dateTo" required></label></div>
    <fieldset><legend>참여 가능한 요일</legend><div class="weekdays"></div></fieldset>
    <div class="grid2"><label>경기 시작 · 이 시간부터<input name="earliest" type="time" required></label><label>경기 시작 · 이 시간까지<input name="latest" type="time" required></label></div>
    <button type="button" class="btn sec" id="after-work">퇴근 후 · 평일 18시 이후</button>
    <div class="grid2"><label>경기 종료 · 이 시간까지<input name="end" type="time"></label><label>내 포지션<select name="position"><option value="">모든 포지션</option><option value="guard">가드</option><option value="forward">포워드</option><option value="center">센터</option></select></label></div>
    <p class="muted">종료 시간을 비워두면 끝나는 시간은 제한하지 않아요.</p><button class="btn" type="submit"></button><p class="form-status" role="status"></p>`;
  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;
  field('lat').value = String(prefs.origin.lat); field('lng').value = String(prefs.origin.lng);
  const originMap=form.querySelector<HTMLElement>('.origin-map')!,originLabel=form.querySelector<HTMLElement>('.origin-label')!;
  const showOrigin=()=>{originLabel.textContent=`출발지 · ${Number(field('lat').value).toFixed(5)}, ${Number(field('lng').value).toFixed(5)}`;};
  if(readDevicePreferences() || signedIn) showOrigin();
  form.querySelector<HTMLButtonElement>('.origin-button')!.onclick=()=>{
    originMap.hidden=!originMap.hidden;
    if(!originMap.hidden && !originMap.children.length) originMap.append(mapView({type:'pick_point',center:{lat:Number(field('lat').value),lng:Number(field('lng').value)}},event=>{field('lat').value=String(event.point.lat);field('lng').value=String(event.point.lng);showOrigin();}));
  };
  (field('lat') as HTMLInputElement).onchange=showOrigin;(field('lng') as HTMLInputElement).onchange=showOrigin;
  for (const name of ['mode', 'maxMinutes', 'dateFrom', 'dateTo'] as const) field(name).value = String(prefs[name]);
  field('earliest').value = clock(prefs.earliestStartMinute); field('latest').value = clock(prefs.latestStartMinute); field('end').value = prefs.latestEndMinute === null ? '' : clock(prefs.latestEndMinute); field('position').value = prefs.position || '';
  const weekdays = form.querySelector<HTMLElement>('.weekdays')!;
  for (const [i, day] of ['월', '화', '수', '목', '금', '토', '일'].entries()) {
    const label = document.createElement('label'); const input = document.createElement('input'); input.type = 'checkbox'; input.name = 'weekday'; input.value = String(i + 1); input.checked = prefs.weekdays.includes(i + 1); label.append(input, day); weekdays.append(label);
  }
  (field('mode') as HTMLSelectElement).onchange = () => { field('maxMinutes').value = field('mode').value === 'car' ? '15' : '30'; };
  form.querySelector<HTMLButtonElement>('#after-work')!.onclick = () => {
    field('earliest').value = '18:00'; field('latest').value = '23:59';
    for (const input of form.querySelectorAll<HTMLInputElement>('[name=weekday]')) input.checked = Number(input.value) <= 5;
  };
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!; submit.textContent = signedIn ? '내 계정에 조건 저장' : '이 기기에 조건 저장';
  const status = form.querySelector<HTMLElement>('.form-status')!;
  form.onsubmit = async event => {
    event.preventDefault(); status.className = 'form-status'; submit.disabled = true;
    try {
      const input = validatePreferences({ origin: { lat: Number(field('lat').value), lng: Number(field('lng').value) }, mode: field('mode').value, maxMinutes: Number(field('maxMinutes').value), dateFrom: field('dateFrom').value, dateTo: field('dateTo').value, weekdays: [...form.querySelectorAll<HTMLInputElement>('[name=weekday]:checked')].map(input => Number(input.value)), earliestStartMinute: minute(field('earliest').value), latestStartMinute: minute(field('latest').value), latestEndMinute: field('end').value ? minute(field('end').value) : null, position: field('position').value || null });
      if (signedIn) await api('/me/preferences', 'PUT', input); else localStorage.setItem(DEVICE_KEY, JSON.stringify(input));
      status.textContent = signedIn ? '계정에 조건을 저장했어요.' : '이 기기에 조건을 저장했어요.';
    } catch { status.classList.add('error'); status.textContent = '날짜·요일·시작 시간 범위를 확인하고 다시 시도해 주세요.'; }
    finally { submit.disabled = false; }
  };
  root.append(form);
  if(signedIn) root.append(deletionView());
}
