import type {PolicySnapshot} from '@basket/core/contracts';
import {el,dateLabel,timeLabel} from '../ui';
export function refundPolicyView(terms:{policy:PolicySnapshot;startsAt:string},preview=false){
 const box=el('section','refund-policy stack');box.append(el('strong','',preview?'모집글의 테스트 환불 정책':'신청 당시 테스트 환불 정책'));
 const version=terms.policy.version;if(!['test-A-v1','test-B-v1'].includes(version))throw new Error('INVALID_POLICY');
 box.append(el('p','',version==='test-A-v1'?'개인 취소: 시작 2시간 전까지 100% 환불, 그 이후 0% 환불.':'개인 취소: 시작 24시간 전까지 100%, 24시간 미만부터 2시간 전까지 50%, 2시간 미만 0% 환불.'));
 const start=Date.parse(terms.startsAt),boundaries=version==='test-A-v1'?[2]:[24,2];
 for(const hours of boundaries){const at=new Date(start-hours*3600000).toISOString();box.append(el('p','muted',`${hours}시간 전 기준: ${dateLabel(at)} ${timeLabel(at)} · 한국 시간`));}
 box.append(el('p','muted','취소는 서버에 접수된 시각으로 판단합니다.'),el('p','notice','주최자 취소·방식 변경으로 불참: 전액 환불 기준'));return box;
}
