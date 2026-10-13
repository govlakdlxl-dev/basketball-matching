import type {ApplicationRecord,FormatNotice,MatchSummary,RefundRecord} from '@basket/core/contracts';
import {api,auth} from '../auth/session';
import {el,timeLabel,actionError,feeLabel} from '../ui';
export type OwnFormatNotice={applicationId:string;notice:Omit<FormatNotice,'actorId'|'affectedApplicationIds'>;acknowledged:boolean;declined?:boolean};
export function formatChoice(application:ApplicationRecord,row:OwnFormatNotice,refresh:()=>Promise<void>) {
 const root=el('section','notice');root.append(el('strong','',`주최자 변경 · ${row.notice.previousPlayersPerTeam}대${row.notice.previousPlayersPerTeam} → ${row.notice.currentPlayersPerTeam}대${row.notice.currentPlayersPerTeam}`),el('p','',`${row.notice.reason} · ${timeLabel(row.notice.announcedAt)} 안내`));
 if(row.declined)root.append(el('p','','변경으로 불참을 접수했어요. 환불 상태를 확인해 주세요.'));
 else if(row.acknowledged) root.append(el('p','','변경 내용을 확인하고 계속 참가를 선택했어요.'));
 else root.append(el('p','','원래 신청 조건을 보존했어요. 계속 참가하거나 변경으로 불참을 선택해 주세요.'));
 if(!row.declined&&['pending','awaiting_payment','verifying_payment','confirmed','cancelled'].includes(application.state)) {
  const actions=el('div','stack'),status=el('p','error');status.setAttribute('role','status');
  if(!row.acknowledged&&application.state!=='cancelled'){const accept=el('button','btn sec','변경 후 계속 참가');accept.type='button';const id=crypto.randomUUID();accept.onclick=async()=>{accept.disabled=true;try {await api(`/applications/${application.id}/format-acknowledgement`,'POST',{noticeId:row.notice.id,requestId:id});await refresh();}catch(error){status.textContent=actionError(error);accept.disabled=false;}};actions.append(accept);}
  const decline=el('button','btn sec','변경으로 불참 · 전액 환불 대상');decline.type='button';const id=crypto.randomUUID();decline.onclick=async()=>{
   decline.disabled=true;
   try {await api(`/applications/${application.id}/cancel`,'POST',{cause:'format_change_declined',formatChangeId:row.notice.id,requestId:id});await refresh();}
   catch(error){status.textContent=error instanceof Error && error.message==='LATE_CHANGE_NEEDS_REVIEW'?'경기 시작 이후의 변경은 운영 확인이 필요해요. 아래에서 제보해 주세요.':actionError(error);decline.disabled=false;}
  };actions.append(decline);root.append(actions,status);
 }
 return root;
}
export function issueForm(matchId:string|null,facilityId:string|null) {
 const form=el('form','card');const label=el('label','','운영자에게 알릴 내용'),text=el('textarea');text.required=true;text.maxLength=2000;label.append(text);const button=el('button','btn sec','제보 보내기'),status=el('p','form-status');status.setAttribute('role','status');form.append(label,button,status);const requestId=crypto.randomUUID();
 form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try {await api('/issues','POST',{matchId,facilityId,text:text.value,requestId});status.textContent='제보를 접수했어요. 운영자가 확인할 수 있도록 기록했습니다.';}catch(error){status.textContent=actionError(error);button.disabled=false;}};return form;
}
export function hostOperations(match:MatchSummary,refresh:()=>Promise<void>) {
 const root=el('details');root.append(el('summary','','진행 안내·방식 변경·취소'));
 const form=el('form','stack');form.innerHTML='<label>참가자에게 안내할 내용<textarea name="reason" required maxlength="1000"></textarea></label><div class="grid2"><label>변경할 경기 방식<select name="players"><option value="4">4대4</option><option value="3">3대3</option><option value="5">5대5</option></select></label><button type="button" class="btn sec format-change">경기 방식 변경 안내</button></div><button class="btn sec" type="submit">그대로 진행 안내</button><p class="muted">주최자 안내로 기록합니다. 현장 참석이나 실제 경기 진행을 확인한 정보가 아니에요.</p><button type="button" class="btn sec cancel-match">경기 취소 준비</button><button type="button" class="btn cancel-confirm" hidden>경기 취소 확정 · 전액 환불 대상</button><p role="status"></p>';
 const status=form.querySelector<HTMLElement>('[role=status]')!,reason=()=> (form.elements.namedItem('reason') as HTMLTextAreaElement).value;
 const formatId=crypto.randomUUID(),proceedId=crypto.randomUUID(),cancelId=crypto.randomUUID();
 form.querySelector<HTMLButtonElement>('.format-change')!.onclick=async event=>{const button=event.currentTarget as HTMLButtonElement;button.disabled=true;try {await api(`/matches/${match.id}/format-notices`,'POST',{playersPerTeam:Number((form.elements.namedItem('players') as HTMLSelectElement).value),reason:reason(),requestId:formatId});await refresh();}catch(error){status.textContent=actionError(error);button.disabled=false;}};
 form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector<HTMLButtonElement>('[type=submit]')!;button.disabled=true;try {await api(`/matches/${match.id}/proceeding`,'POST',{reason:reason(),requestId:proceedId});status.textContent='주최자의 진행 안내를 기록했어요.';}catch(error){status.textContent=actionError(error);button.disabled=false;}};
 const confirm=form.querySelector<HTMLButtonElement>('.cancel-confirm')!;form.querySelector<HTMLButtonElement>('.cancel-match')!.onclick=()=>{confirm.hidden=false;status.textContent='신청자에게 취소가 안내되고 전액 환불 대상으로 기록됩니다.';};
 confirm.onclick=async()=>{confirm.disabled=true;try {await api(`/matches/${match.id}/cancel`,'POST',{requestId:cancelId});await refresh();}catch(error){status.textContent=actionError(error);confirm.disabled=false;}};
 root.append(form);return root;
}
export function deletionView() {
 const root=el('details','account-delete');root.append(el('summary','','계정 탈퇴'));const status=el('p','form-status');status.setAttribute('role','status');const prepare=el('button','btn sec','탈퇴 준비'),button=el('button','btn sec','회원정보 정리하고 탈퇴');prepare.type=button.type='button';button.hidden=true;
 root.append(el('p','muted','참가·환불·마지막 팀 담당 업무가 남아 있으면 먼저 해결해야 해요. 탈퇴해도 거래·운영 처리 기록은 필요한 범위에서 보존합니다.'),prepare,button,status);
 prepare.onclick=()=>{button.hidden=false;status.textContent='탈퇴가 가능하면 인증 계정과 개인 조건을 정리합니다. 계속하려면 아래 탈퇴 버튼을 눌러 주세요.';};
 button.onclick=async()=>{button.disabled=true;try {const result=await api<{status:string}>('/me/deletion','POST',{});if(result.status==='needs_resolution'){status.textContent='참가·환불·팀 담당 업무 또는 개인정보 정리가 남아 있어요. 운영자에게 확인해 주세요.';button.disabled=false;}else {status.textContent='탈퇴 처리를 완료했어요.';await auth?.auth.signOut();}}catch(error){status.textContent=actionError(error);button.disabled=false;}};return root;
}
export async function operatorView(root:HTMLElement) {
 type Dashboard={teams:{id:string;name:string;status:string;contactRoute:string;evidence:string}[];issues:{id:string;text:string;status:string}[];matches:MatchSummary[]};
 let data:Dashboard;try {data=await api('/operator/dashboard');}catch {root.append(el('p','notice','운영자 권한과 연결을 확인해 주세요.'));return;}
 root.append(el('h3','section-title','테스트 결제 원장'),el('p','muted','실제 출금·팀 지급이 없는 테스트 기록입니다. PG 비용과 부담 방식은 미확인입니다.'));
 try {const ledger=await api<{orderId:string;paymentStatus:string;paymentAmountKrw:number;platformFeeKrw:number;teamBasisKrw:number;refund:RefundRecord|null}[]>('/operator/test-ledger');for(const order of ledger){const card=el('article','card');card.append(el('span','badge',`테스트 · ${order.paymentStatus}`),el('p','',`결제 기준액 ${feeLabel(order.paymentAmountKrw)} · 플랫폼 수수료 ${feeLabel(order.platformFeeKrw)}`),el('p','',`팀 기준액 ${feeLabel(order.teamBasisKrw)} · PG 비용 미반영`),el('p','muted','PG 비용 미확인 · 실제 지급액 아님'));if(order.refund)card.append(el('p','',`환불 ${order.refund.status} · 누적 완료 ${feeLabel(order.refund.completed.refundedKrw)}`));root.append(card);}}catch{root.append(el('p','notice','테스트 원장을 불러오지 못했어요.'));}
 root.append(el('h3','section-title','팀 등록 검토'));
 for(const team of data.teams){const card=el('article','card');card.append(el('h4','',team.name),el('p','muted',`${team.status} · ${team.contactRoute}`),el('p','',team.evidence));const reason=el('textarea');reason.placeholder='검토 사유';reason.setAttribute('aria-label',`${team.name} 검토 사유`);const actions=el('div','row'),status=el('p','form-status');
  for(const [decision,label] of [['approved','승인'],['needs_info','추가 정보 요청'],['rejected','거절']]) {const button=el('button','btn sec',label),requestId=crypto.randomUUID();button.onclick=async()=>{button.disabled=true;try {await api(`/operator/teams/${team.id}/review`,'POST',{decision,reason:reason.value,requestId});status.textContent='검토를 기록했어요.';}catch(error){status.textContent=actionError(error);button.disabled=false;}};actions.append(button);}card.append(reason,actions,status);root.append(card);
 }
 root.append(el('h3','section-title','접수된 제보'));for(const issue of data.issues){const card=el('article','card');card.append(el('span','badge',issue.status),el('p','',issue.text));root.append(card);}
 root.append(el('h3','section-title','모집 운영'));for(const match of data.matches){const card=el('article','card');card.append(el('h4','',`${match.teamName} · ${match.facility.name}`));const reason=el('textarea');reason.placeholder='조치 사유';const row=el('div','row'),status=el('p','form-status');for(const [action,label] of [['hide','공개 목록에서 숨김'],['stop_recruitment','새 모집 중단']]) {const button=el('button','btn sec',label),requestId=crypto.randomUUID();button.onclick=async()=>{button.disabled=true;try {await api(`/operator/matches/${match.id}/moderation`,'POST',{action,reason:reason.value,requestId});status.textContent='운영 조치를 기록했어요.';}catch(error){status.textContent=actionError(error);button.disabled=false;}};row.append(button);}card.append(reason,row,status,hostOperations(match,async()=>{root.replaceChildren();await operatorView(root);}));root.append(card);}
}
