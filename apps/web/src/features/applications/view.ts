import type {ApplicationRecord} from '@basket/core/contracts';
import {api,session} from '../auth/session';
import {authView} from '../auth/view';
import {el,dateLabel,timeLabel,stateNames,positionNames,feeLabel} from '../ui';
export async function applicationsView(root:HTMLElement) {
 if(!session()) {root.append(authView(),el('p','muted','로그인하면 신청과 참가 상태를 확인할 수 있어요.'));return;}
 let rows:ApplicationRecord[];try {rows=await api('/me/applications');} catch {root.append(el('p','notice','참여 내역을 불러오지 못했어요. 다시 접속해 주세요.'));return;}
 if(!rows.length) {root.append(el('div','card empty-state','아직 신청한 경기가 없어요.'));return;}
 for(const a of rows) {
  const card=el('article','card');card.dataset.testid=`application-${a.id}`;card.append(el('span','badge',stateNames[a.state]),el('h3','',a.terms.facility.name),el('p','muted',`${dateLabel(a.terms.startsAt)} · ${timeLabel(a.terms.startsAt)}–${timeLabel(a.terms.endsAt)}`),el('p','',`${positionNames[a.position]} · ${feeLabel(a.terms.pricing.paymentAmountKrw)}`));
  if(a.state==='awaiting_payment') card.append(el('p','notice',`${timeLabel(a.paymentDeadlineAt!)}까지 결제 대기 · 테스트 결제 연결 준비 중`));
  if(a.state==='verifying_payment') card.append(el('p','notice','서버에서 결제 결과를 확인하고 있어요. 다시 결제하지 말고 결과를 확인해 주세요.'));
  const link=el('a','text-link','경기 확인');link.href=`#/matches/${a.matchId}`;card.append(link);root.append(card);
 }
}
