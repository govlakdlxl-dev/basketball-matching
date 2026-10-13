import type {MatchSummary} from '@basket/core/contracts';
import type {RouteEstimate} from '@basket/core/search';
import {el,dateLabel,timeLabel,feeLabel,positionNames} from '../ui';
export function matchCard(match:MatchSummary,route?:RouteEstimate) {
 const card=el('article','card match-card');card.dataset.testid=`match-${match.id}`;
 const top=el('div','match-top');top.append(el('strong','match-time',timeLabel(match.startsAt)),el('span','slot-badge',match.roster.availableGuests?`${match.roster.availableGuests}자리`:'자리 마감'));card.append(top);
 card.append(el('p','muted',`${dateLabel(match.startsAt)} · ${timeLabel(match.endsAt)} 종료`),el('h4','',match.facility.name));
 const roles=Object.entries(match.roster.positionSlots).filter(([,value])=>value.available>0).map(([pos,value])=>`${positionNames[pos as keyof typeof positionNames]} ${value.available}`).join(' · ');
 card.append(el('p','positions',roles || '결제 대기·확정 인원이 자리를 차지하고 있어요.'));
 const meta=el('div','row');meta.append(el('span','chip',`${match.playersPerTeam}대${match.playersPerTeam}`),el('span','chip',feeLabel(match.baseFeeKrw)));card.append(meta);
 card.append(el('p','muted',match.guestComposition));
 if(route) card.append(el('p',route.status==='available'?'route-label':'route-label caution',route.status==='available'?`${route.mode==='subway'?'지하철 · 도보 포함':'자차'} 약 ${Math.ceil(route.durationSeconds/60)}분 · 조회 시점 기준`:'이동 시간 미확인'));
 const link=el('a','btn sec','경기 자세히 보기');link.href=`#/matches/${match.id}`;card.append(link);return card;
}
