import type {MatchSummary,ApplicationRecord,PublicFacility} from '@basket/core/contracts';
import type {MyTeam} from '../../../../server/src/features/accounts/handlers';
import {api} from '../auth/session';
import {el,dateLabel,timeLabel,stateNames,positionNames,actionError} from '../ui';
export async function hostingPanel(teams:MyTeam[],refresh:()=>Promise<void>) {
 const root=el('section','stack');
 const allowed=teams.filter(t=>t.status==='approved' && t.active && ['captain','secretary'].includes(t.role));
 const [facilities,matches]=await Promise.all([api<PublicFacility[]>('/facilities'),api<MatchSummary[]>('/me/hosting')]);
 if(allowed.length) root.append(publishForm(allowed,facilities,refresh));
 for(const match of matches) root.append(hostCard(match));
 return root;
}
function publishForm(teams:MyTeam[],facilities:PublicFacility[],refresh:()=>Promise<void>) {
 const form=el('form','card');form.innerHTML=`<h3>새 게스트 모집</h3><label>모집 팀<select name="teamId"></select></label><label>농구장<select name="facilityId"></select></label>
 <div class="grid2"><label>경기 시작 (한국 시간)<input name="startsAt" type="datetime-local" required></label><label>경기 종료 (한국 시간)<input name="endsAt" type="datetime-local" required></label></div>
 <div class="grid2"><label>경기 방식<select name="playersPerTeam"><option value="5">5대5</option><option value="4">4대4</option><option value="3">3대3</option></select></label><label>예정 팀 수<input name="teamCount" type="number" value="2" min="2" required></label></div>
 <label>기존 예정 인원<input name="existingPlanned" type="number" min="0" value="9" required></label><div class="grid3"><label>가드 모집<input name="guard" type="number" min="0" value="1" required></label><label>포워드 모집<input name="forward" type="number" min="0" value="0" required></label><label>센터 모집<input name="center" type="number" min="0" value="0" required></label></div>
 <div class="grid2"><label>기본 참가비 (원)<input name="baseFeeKrw" type="number" min="0" value="10000" required></label><label>테스트 환불 정책<select name="policy"><option value="test-A-v1">A · 2시간 전까지 전액</option><option value="test-B-v1">B · 24시간 전까지 전액, 2시간 전까지 50%</option></select></label></div>
 <p class="muted">초기 플랫폼 수수료 0% · 테스트 정책입니다. 실제 결제 연결 전에는 돈을 받지 않아요.</p>
 <label>모이는 곳<input name="meetingPoint" value="체육관 입구" required maxlength="1000"></label><label>교대 방식<textarea name="rotationDescription" required maxlength="1000">주장이 인원에 맞춰 교대 시간을 조율합니다.</textarea></label><label>게스트 구성<textarea name="guestComposition" required maxlength="1000">혼자 오는 게스트도 함께 플레이할 수 있도록 팀을 섞습니다.</textarea></label><label>주장의 진행<textarea name="captainCoordination" required maxlength="1000">주장이 팀 편성과 패스·플레이 참여를 조율합니다.</textarea></label><label>대관 안내<textarea name="reservationNote" required maxlength="1000" placeholder="대관 확보 여부·주최자 확인 내용을 작성해 주세요."></textarea></label><label>예상 출전 시간 (분, 선택)<input name="expectedPlayingMinutes" type="number" min="0"></label><button class="btn" type="submit">게스트 모집 공개</button><p role="status"></p>`;
 const select=(name:string)=>form.elements.namedItem(name) as HTMLSelectElement;
 for(const team of teams){const option=el('option','',team.name);option.value=team.id;select('teamId').append(option);}
 for(const facility of facilities){const option=el('option','',`${facility.name}${facility.locationStatus==='unverified'?' · 주최자 등록·미확인':''}`);option.value=facility.id;select('facilityId').append(option);}
 const now=new Date(Date.now()+86400000);now.setUTCHours(11,0,0,0);const local=(time:Date)=>new Date(time.getTime()+32400000).toISOString().slice(0,16);
 select('startsAt').value=local(now);select('endsAt').value=local(new Date(now.getTime()+7200000));
 select('reservationNote').value='주최자가 대관 정보를 확인한 뒤 안내합니다.';
 const status=form.querySelector<HTMLElement>('[role=status]')!,button=form.querySelector<HTMLButtonElement>('[type=submit]')!,requestId=crypto.randomUUID();
 form.onsubmit=async event=>{
  event.preventDefault();button.disabled=true;
  try {const value=Object.fromEntries(new FormData(form));
   await api('/matches','POST',{teamId:value.teamId,facilityId:value.facilityId,startsAt:new Date(`${value.startsAt}:00+09:00`).toISOString(),endsAt:new Date(`${value.endsAt}:00+09:00`).toISOString(),playersPerTeam:Number(value.playersPerTeam),teamCount:Number(value.teamCount),existingPlanned:Number(value.existingPlanned),guestSlots:{guard:Number(value.guard),forward:Number(value.forward),center:Number(value.center)},baseFeeKrw:Number(value.baseFeeKrw),policy:{version:value.policy},meetingPoint:value.meetingPoint,rotationDescription:value.rotationDescription,guestComposition:value.guestComposition,captainCoordination:value.captainCoordination,reservationNote:value.reservationNote,expectedPlayingMinutes:value.expectedPlayingMinutes?Number(value.expectedPlayingMinutes):null,requestId});
   await refresh();
  } catch(error){status.textContent=actionError(error);button.disabled=false;}
 };return form;
}
function hostCard(match:MatchSummary) {
 const card=el('article','card');card.dataset.testid=`hosting-${match.id}`;card.append(el('h3','',match.facility.name),el('p','muted',`${dateLabel(match.startsAt)} · ${timeLabel(match.startsAt)}–${timeLabel(match.endsAt)}`));
 const roster=el('p','notice'),list=el('div','stack');
 const describe=(m:MatchSummary)=>{roster.textContent=`기존 예정 ${m.roster.existingPlanned}명 · 앱 확정 ${m.roster.confirmedGuests}명 · 결제 대기 ${m.roster.awaitingPayment+m.roster.verifyingPayment}명 · 남은 자리 ${m.roster.availableGuests}명`;};describe(match);
 const button=el('button','btn sec','신청자 보기');button.type='button';card.append(roster,button,list);
 async function load() {
  list.replaceChildren();let apps:(ApplicationRecord & {nickname:string})[];
  try {apps=await api(`/matches/${match.id}/applications`);} catch(error){list.append(el('p','error',actionError(error)));return;}
  if(!apps.length) list.append(el('p','muted','아직 신청자가 없어요.'));
  for(const a of apps) {
   const row=el('section','applicant-row');row.append(el('strong','',`${a.nickname} · ${positionNames[a.position]}`),el('span','badge',stateNames[a.state]));
   if(a.paymentDeadlineAt && a.state==='awaiting_payment') row.append(el('p','muted',`${timeLabel(a.paymentDeadlineAt)}까지 결제 대기`));
   if(a.state==='pending') {
    const actions=el('div','row'),accept=el('button','btn','수락'),reject=el('button','btn sec','거절'),message=el('p','error');accept.type=reject.type='button';
    const acceptId=crypto.randomUUID(),rejectId=crypto.randomUUID();
    async function act(kind:'accept'|'reject') {accept.disabled=reject.disabled=true;try {await api(`/applications/${a.id}/${kind}`,'POST',{requestId:kind==='accept'?acceptId:rejectId,...(kind==='reject'?{reason:'팀 모집 조건과 맞지 않아 거절했습니다.'}:{})});const latest=await api<MatchSummary>(`/matches/${match.id}`);describe(latest);await load();} catch(error){message.textContent=actionError(error);accept.disabled=reject.disabled=false;}}
    accept.onclick=()=>{void act('accept');};reject.onclick=()=>{void act('reject');};actions.append(accept,reject);row.append(actions,message);
   }
   list.append(row);
  }
 }
 button.onclick=()=>{void load();};return card;
}
