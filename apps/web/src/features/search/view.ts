import type {Facility,MatchSummary} from '@basket/core/contracts';
import {api,session} from '../auth/session';
import {defaultPreferences,readDevicePreferences} from '../preferences/view';
import type {Preferences} from '@basket/core/preferences';
import {mapView} from '../map/view';
import {classifyMatches} from './controller';
import {matchCard} from '../matches/card';
type PublicFacility=Omit<Facility,'registeredBy'>;
function element<K extends keyof HTMLElementTagNameMap>(tag:K,className:string,text?:string) {
 const node=document.createElement(tag);node.className=className;if(text) node.textContent=text;return node;
}
export async function searchView(root:HTMLElement) {
 const filters=element('section','filter-summary');
 const loading=element('p','muted','가까운 경기와 시설을 불러오는 중…');root.append(filters,loading);
 let prefs=readDevicePreferences() || defaultPreferences(),facilities:PublicFacility[],matches:MatchSummary[],hasOrigin=Boolean(readDevicePreferences());
 try {
  if(session()) {const saved=await api<Preferences|null>('/me/preferences');prefs=saved || defaultPreferences();hasOrigin=Boolean(saved);}
  [facilities,matches]=await Promise.all([api<PublicFacility[]>('/facilities'),api<MatchSummary[]>('/matches')]);
 } catch {loading.textContent='경기와 시설 정보를 불러오지 못했어요. 연결을 확인해 주세요.';return;}
 loading.remove();
 const chips=element('div','row');chips.append(element('span','chip',`${prefs.mode==='subway'?'지하철':'자차'} ${prefs.maxMinutes}분 이내`),element('span','chip',`${prefs.dateFrom.slice(5)} ~ ${prefs.dateTo.slice(5)}`));
 const link=element('a','text-link','조건 바꾸기');link.href='#/preferences';filters.append(chips,link);
 const list=element('div','facility-list');
 const map=mapView({type:'show_points',points:facilities.map(f=>({id:f.id,point:f.point,label:f.name}))},event=>{
  const chosen=facilities.find(f=>f.point.lat===event.point.lat && f.point.lng===event.point.lng);
  for(const card of list.children) {card.classList.toggle('selected',(card as HTMLElement).dataset.id===chosen?.id);}
  if(chosen) list.querySelector<HTMLElement>(`[data-id="${CSS.escape(chosen.id)}"]`)?.scrollIntoView({behavior:'smooth',block:'nearest'});
 });root.append(map);
 const matchSection=element('section','stack');matchSection.append(element('h3','section-title','지금 모집 중인 경기'));
 const rows=await classifyMatches(matches,prefs,hasOrigin),matched=rows.filter(row=>row.status==='matched'),unknown=rows.filter(row=>row.status==='unknown');
 for(const row of matched) matchSection.append(matchCard(row.match,row.route));
 if(!matched.length) {
  const empty=element('div','card empty-state');empty.append(element('span','empty-icon','⌕'),element('h4','',matches.length?'맞는 경기를 아직 찾지 못했어요':'첫 모집을 준비하고 있어요'),element('p','muted',matches.length?(unknown.length?'아래의 이동 시간 미확인 경기를 확인하거나 조건을 바꿔 주세요.':'조건에 맞는 모집 자리가 없어요. 일정을 바꾸거나 나중에 다시 확인해 주세요.'):'아직 공개된 모집글이 없어요. 팀 등록과 담당자 확인 후 실제 경기를 올릴 수 있어요.'));
  const action=element('a','btn sec',matches.length?'내 조건 바꾸기':'우리 팀 등록하기');action.href=matches.length?'#/preferences':'#/hosting';empty.append(action);matchSection.append(empty);
 }
 root.append(matchSection);
 if(unknown.length) {const section=element('section','stack');section.append(element('h3','section-title','이동 시간 확인이 필요한 경기'),element('p','muted',hasOrigin?'일정·포지션은 맞지만 경로를 확인하지 못했어요. 길찾기를 확인한 뒤 신청해 주세요.':'출발지를 저장하면 이동 시간을 확인할 수 있어요.'));for(const row of unknown) section.append(matchCard(row.match,row.route));root.append(section);}
 const facilitySection=element('section','stack');facilitySection.append(element('h3','section-title','실제 실내 농구장'),element('p','muted','시설 등록은 경기 모집·대관 확정을 뜻하지 않아요.'));
 for(const [i,f] of facilities.entries()) {
  const card=element('article','card facility-card');card.dataset.id=f.id;
  const meta=element('div','row');meta.append(element('span','facility-number',String(i+1)),element('span','badge',f.region==='seoul'?'서울 · 시설':'인천 · 시설'));
  // 실내 여부를 확인한 공식 시설만 '실내' 표시합니다.
  if(f.registration==='operator' && f.basketballUseStatus==='verified') (meta.lastElementChild as HTMLElement).textContent=`${f.region==='seoul'?'서울':'인천'} · 실내`;
  const checked=f.locationStatus==='verified' && f.basketballUseStatus==='verified';meta.append(element('span',checked?'badge ok':'badge caution',checked?'출처 확인':'주최자 등록 · 미확인'));
  card.append(meta,element('h4','',f.name),element('p','muted',f.address));
  const footer=element('div','row');
  const directions=element('a','text-link','카카오맵 길찾기 ↗');directions.href=`https://map.kakao.com/link/to/${encodeURIComponent(f.name)},${f.point.lat},${f.point.lng}`;directions.target='_blank';directions.rel='noopener noreferrer';footer.append(directions);
  if(f.sourceUrl) {try {const url=new URL(f.sourceUrl);if(url.protocol==='https:'){const source=element('a','text-link','공식 안내 ↗');source.href=url.href;source.target='_blank';source.rel='noopener noreferrer';footer.append(source);}} catch { /* 링크 형식이 잘못되면 문자 정보만 표시합니다. */ }}
  card.append(footer);list.append(card);
 }
 facilitySection.append(list);root.append(facilitySection);
}
