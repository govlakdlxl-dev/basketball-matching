import {api,session} from '../auth/session';
import {authView} from '../auth/view';
import type {MyTeam} from '../../../../server/src/features/accounts/handlers';
import type {PlaceCandidate,Point} from '@basket/core/contracts';
import {mapView} from '../map/view';
import {hostingPanel} from '../hosting/view';

export async function hostingView(root:HTMLElement) {
 root.append(authView());if(!session()) return;
 let teams:MyTeam[];
 try {teams=await api<MyTeam[]>('/me/teams');} catch {const p=document.createElement('p');p.textContent='팀 정보를 불러오지 못했어요.';root.append(p);return;}
 const statusNames:Record<string,string>={pending:'확인 대기',approved:'모집 가능',needs_info:'추가 정보 필요',rejected:'승인되지 않음',suspended:'모집 중지'};
 for(const team of teams) {
  const card=document.createElement('section');card.className='card';const heading=document.createElement('h3');heading.textContent=team.name;const text=document.createElement('p');text.className='muted';text.textContent=`${statusNames[team.status] || '확인 필요'} · ${team.role==='captain'?'주장':team.role==='secretary'?'총무':'팀원'}${team.active?'':' · 비활성'}`;card.append(heading,text);if(team.reviewReason){const reason=document.createElement('p');reason.textContent=team.reviewReason;card.append(reason);}root.append(card);
 }
 if(!teams.length) {
  const form=document.createElement('form');form.className='card';form.innerHTML='<h3>우리 팀 등록 요청</h3><p class="muted">운영자가 팀과 담당자 정보를 확인한 후 모집할 수 있어요.</p><label>팀 이름<input name="name" required maxlength="80"></label><label>담당자 연락 경로<input name="contactRoute" required maxlength="300" placeholder="팀 공식 연락 경로 또는 운영자에게 전달할 방법"></label><label>확인할 팀 정보<textarea name="evidence" required maxlength="2000" placeholder="활동 지역·농구장·기존 모집 자료 등을 알려주세요."></textarea></label><button class="btn">팀 등록 요청</button><p role="status"></p>';
  const requestId=crypto.randomUUID();form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button')!;button.disabled=true;const body=Object.fromEntries(new FormData(form));try {await api('/teams','POST',{...body,requestId});await hostingViewRefresh(root);} catch {form.querySelector('[role=status]')!.textContent='팀 등록 요청을 보내지 못했어요. 다시 시도해 주세요.';button.disabled=false;}};root.append(form);
 }
 try {root.append(await hostingPanel(teams,()=>hostingViewRefresh(root)));} catch {const error=document.createElement('p');error.textContent='모집 정보를 불러오지 못했어요. 다시 접속해 주세요.';root.append(error);}
 if(teams.some(t=>t.status==='approved' && t.active && ['captain','secretary'].includes(t.role))) root.append(facilityForm());
}
async function hostingViewRefresh(root:HTMLElement){root.replaceChildren();await hostingView(root);}
function facilityForm() {
 const form=document.createElement('form');form.className='card';form.innerHTML='<h3>농구장 추가</h3><p class="muted">검색에 없는 농구장은 이름·주소를 직접 쓰고 핀을 선택할 수 있어요. 운영자 확인 전에는 미확인 표시로 공개됩니다.</p><div class="row"><label class="grow">카카오 장소 검색<input name="query" placeholder="농구장·체육관 이름" maxlength="80"></label><button type="button" class="btn sec search-button">검색</button></div><div class="place-results stack"></div><label>농구장 이름<input name="name" required maxlength="160"></label><label>주소<input name="address" required maxlength="300"></label><label>지역<select name="region"><option value="seoul">서울</option><option value="incheon">인천</option></select></label><div class="pin-picker"></div><p class="chosen-point muted">지도에서 농구장 위치를 골라 주세요.</p><label>농구 가능 여부를 확인할 정보<textarea name="evidence" required maxlength="2000"></textarea></label><button class="btn" type="submit">미확인 농구장으로 등록</button><p role="status"></p>';
 let point:Point|null=null,registration='manual_pin';const pin=form.querySelector<HTMLElement>('.pin-picker')!,status=form.querySelector<HTMLElement>('[role=status]')!;
 function picker(center:Point) {pin.replaceChildren(mapView({type:'pick_point',center},event=>{point=event.point;form.querySelector('.chosen-point')!.textContent=`선택 위치 · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;}));}
 picker({lat:37.54,lng:126.93});
 form.querySelector<HTMLButtonElement>('.search-button')!.onclick=async()=>{
  const query=(form.elements.namedItem('query') as HTMLInputElement).value;const results=form.querySelector<HTMLElement>('.place-results')!;results.replaceChildren();
  try {const places=await api<PlaceCandidate[]>(`/places?q=${encodeURIComponent(query)}`);for(const place of places){const button=document.createElement('button');button.type='button';button.className='btn sec';button.textContent=`${place.name} · ${place.address}`;button.onclick=()=>{(form.elements.namedItem('name') as HTMLInputElement).value=place.name;(form.elements.namedItem('address') as HTMLInputElement).value=place.address;point=place.point;registration='map_search';picker(point);form.querySelector('.chosen-point')!.textContent=`선택 위치 · ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;results.replaceChildren();};results.append(button);}if(!places.length) status.textContent='검색 결과가 없어요. 직접 이름·주소를 쓰고 핀을 선택해 주세요.';}
  catch {status.textContent='장소 검색을 연결하지 못했어요. 직접 입력과 지도 핀 선택을 이용해 주세요.';}
 };
 const requestId=crypto.randomUUID();form.onsubmit=async event=>{event.preventDefault();if(!point){status.textContent='농구장 위치를 선택해 주세요.';return;}const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;try {const data=Object.fromEntries(new FormData(form));await api('/facilities','POST',{name:data.name,address:data.address,region:data.region,evidence:data.evidence,point,registration,sourceUrl:null,requestId});status.textContent='농구장을 등록했어요. 운영자 확인 전까지 미확인 표시로 공개됩니다.';}catch {status.textContent='농구장을 등록하지 못했어요. 입력과 팀 권한을 확인해 주세요.';button.disabled=false;}};
 return form;
}
