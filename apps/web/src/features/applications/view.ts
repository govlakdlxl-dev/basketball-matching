import type {ApplicationRecord,TestOrder} from '@basket/core/contracts';
import {api,session} from '../auth/session';
import {authView} from '../auth/view';
import {el,dateLabel,timeLabel,stateNames,positionNames,feeLabel,actionError} from '../ui';
import {formatChoice,issueForm} from '../operations/view';
import type {OwnFormatNotice} from '../operations/view';
import {paymentPanel} from '../payments/view';
export async function applicationsView(root:HTMLElement) {
 if(!session()) {root.append(authView(),el('p','muted','로그인하면 신청과 참가 상태를 확인할 수 있어요.'));return;}
 let rows:ApplicationRecord[],notices:OwnFormatNotice[],orders:TestOrder[];try {[rows,notices,orders]=await Promise.all([api<ApplicationRecord[]>('/me/applications'),api<OwnFormatNotice[]>('/me/format-notices'),api<TestOrder[]>('/me/test-orders')]);} catch {root.append(el('p','notice','참여 내역을 불러오지 못했어요. 다시 접속해 주세요.'));return;}
 if(!rows.length) {root.append(el('div','card empty-state','아직 신청한 경기가 없어요.'));return;}
 for(const a of rows) {
  const card=el('article','card');card.dataset.testid=`application-${a.id}`;card.append(el('span','badge',stateNames[a.state]),el('h3','',a.terms.facility.name),el('p','muted',`${dateLabel(a.terms.startsAt)} · ${timeLabel(a.terms.startsAt)}–${timeLabel(a.terms.endsAt)}`),el('p','',`${positionNames[a.position]} · ${feeLabel(a.terms.pricing.paymentAmountKrw)}`));
  const notice=notices.find(n=>n.applicationId===a.id);if(notice) card.append(formatChoice(a,notice,async()=>{root.replaceChildren();await applicationsView(root);}));
  if(a.terms.pricing.paymentAmountKrw>0)card.append(await paymentPanel(a,orders.find(o=>o.applicationId===a.id)));
  if(a.state==='verifying_payment') card.append(el('p','notice','서버에서 결제 결과를 확인하고 있어요. 다시 결제하지 말고 결과를 확인해 주세요.'));
  const link=el('a','text-link','경기 확인');link.href=`#/matches/${a.matchId}`;card.append(link);root.append(card);
  if(['pending','awaiting_payment','verifying_payment','confirmed'].includes(a.state)) {
   const cancel=el('button','btn sec','개인 사정으로 신청 취소'),confirm=el('button','btn sec','정책 확인 후 취소 접수'),status=el('p','form-status');confirm.hidden=true;status.setAttribute('role','status');const requestId=crypto.randomUUID();
   cancel.onclick=()=>{confirm.hidden=false;status.textContent='결제한 경우 신청 당시 정책과 서버 접수 시각으로 환불을 처리합니다. 주최자 변경 불참은 위의 전용 선택을 이용해 주세요.';};
   confirm.onclick=async()=>{confirm.disabled=true;try {await api(`/applications/${a.id}/cancel`,'POST',{cause:'personal',formatChangeId:null,requestId});root.replaceChildren();await applicationsView(root);}catch(error){status.textContent=actionError(error);confirm.disabled=false;}};card.append(cancel,confirm,status);
  }
  if(notice) root.append(issueForm(a.matchId,a.terms.facility.id));
 }
}
