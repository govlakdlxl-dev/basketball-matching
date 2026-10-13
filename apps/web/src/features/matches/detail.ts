import type {MatchSummary,ApplicationRecord,Position} from '@basket/core/contracts';
import {api,session} from '../auth/session';
import {authView} from '../auth/view';
import {el,dateLabel,timeLabel,feeLabel,positionNames,stateNames,actionError} from '../ui';
export async function matchDetail(root:HTMLElement,id:string) {
 let match:MatchSummary;try {match=await api<MatchSummary>(`/matches/${encodeURIComponent(id)}`);} catch {root.append(el('p','notice','모집글을 찾지 못했어요. 숨김·팀 상태·연결을 확인해 주세요.'));return;}
 const hero=el('section','card match-detail');hero.append(el('p','eyebrow',`${dateLabel(match.startsAt)} · ${timeLabel(match.startsAt)}–${timeLabel(match.endsAt)}`),el('h3','',match.facility.name),el('p','muted',match.facility.address),el('strong','match-time',`${match.playersPerTeam}대${match.playersPerTeam} · ${feeLabel(match.baseFeeKrw)}`));
 const details=el('dl','match-info');
 for(const [label,value] of [['모집 팀',match.teamName],['모이는 곳',match.meetingPoint],['교대 방식',match.rotationDescription],['게스트 구성',match.guestComposition],['주장의 진행',match.captainCoordination],['대관 안내',match.reservationNote],['예상 출전 시간',match.expectedPlayingMinutes===null?'주최자에게 확인':`${match.expectedPlayingMinutes}분 · 주최자 안내`]]) {details.append(el('dt','',label),el('dd','',value));}
 hero.append(details,el('p','muted',`기존 예정 ${match.roster.existingPlanned}명 · 앱 확정 ${match.roster.confirmedGuests}명 · 결제 대기 ${match.roster.awaitingPayment+match.roster.verifyingPayment}명`));
 const link=el('a','text-link','카카오맵 길찾기 ↗');link.href=`https://map.kakao.com/link/to/${encodeURIComponent(match.facility.name)},${match.facility.point.lat},${match.facility.point.lng}`;link.target='_blank';link.rel='noopener noreferrer';hero.append(link);root.append(hero);
 if(!session()) {root.append(authView(),el('p','muted','신청하려면 로그인해 주세요.'));return;}
 const own=await api<ApplicationRecord[]>('/me/applications').catch(()=>[]);
 const existing=own.find(a=>a.matchId===id && ['pending','awaiting_payment','verifying_payment','confirmed'].includes(a.state));
 if(existing) {root.append(el('p','notice',stateNames[existing.state]));const mine=el('a','btn','참여 내역 확인');mine.href='#/applications';root.append(mine);return;}
 const form=el('form','card');form.append(el('h3','','게스트 신청'));
 const label=el('label','','신청 포지션'),select=el('select');
 for(const pos of ['guard','forward','center'] as const) if(match.roster.positionSlots[pos].available>0) {const option=el('option','',`${positionNames[pos]} · ${match.roster.positionSlots[pos].available}자리`);option.value=pos;select.append(option);}
 label.append(select);form.append(label,el('p','muted',match.baseFeeKrw===0?'주장이 수락하면 참가가 확정돼요.':'주장이 수락하면 결제할 수 있어요. 수락 후 최대 30분이며 경기 시작을 넘기지 않아요.'),el('p','notice',`테스트 환불 정책 ${match.policy.version.includes('-A-')?'A · 시작 2시간 전까지 전액':'B · 24시간 전까지 전액, 2시간 전까지 50%'} · 주최자 취소·방식 변경으로 불참하면 전액 환불 기준`));
 const button=el('button','btn','신청 보내기');button.disabled=!select.options.length || match.recruitmentStatus!=='open';const status=el('p','form-status');status.setAttribute('role','status');form.append(button,status);
 const requestId=crypto.randomUUID();form.onsubmit=async event=>{event.preventDefault();button.disabled=true;try {await api(`/matches/${id}/applications`,'POST',{position:select.value as Position,requestId});status.textContent='신청을 보냈어요. 주장의 수락을 기다려 주세요.';} catch(error){status.textContent=actionError(error);button.disabled=false;}};root.append(form);
}
