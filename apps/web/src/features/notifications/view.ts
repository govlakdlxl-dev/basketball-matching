import type {InboxNotice} from '@basket/core/notifications/contracts';
import {api,session} from '../auth/session';
import {authView} from '../auth/view';
import {el,dateLabel,timeLabel,actionError} from '../ui';
import {webPushControls} from './web-push';
import {nativePlatformKind} from '@basket/mobile';
import {nativePushControls} from './native-push';
const titles={'application.accepted':'신청 수락','payment.confirmed':'참가 확정','match.cancelled':'경기 취소','format.changed':'경기 방식 변경','match.proceeding_reported':'주최자 진행 안내','captain.pending':'미처리 신청','captain.shortage':'인원 안내'} as const;
export async function notificationsView(root:HTMLElement,noticeId?:string){
 if(!session()){root.append(authView(),el('p','muted','로그인하면 본인의 경기 안내를 확인할 수 있어요.'));return;}
 root.append(el('p','muted','앱과 웹의 안내 기록과 읽음 상태를 함께 관리해요. 실제 발송 여부와 읽음은 구분합니다.'));
 root.append(nativePlatformKind()?nativePushControls():webPushControls());
 try{
  const rows=noticeId?[await api<InboxNotice>(`/notifications/${noticeId}`)]:await api<InboxNotice[]>('/notifications/inbox');
  if(!rows.length){root.append(el('div','card empty-state','아직 받은 안내가 없어요.'));return;}
  for(const n of rows){const card=el('article','card'),badge=el('span','badge',n.readAt?'읽음':'안 읽음'),status=el('p','form-status');status.setAttribute('role','status');card.append(badge,el('h3','',titles[n.kind]),el('p','',n.text),el('p','muted',`${dateLabel(n.createdAt)} · ${timeLabel(n.createdAt)} 기록`));
   if(!n.readAt){const read=el('button','btn sec','읽음으로 표시');read.onclick=async()=>{read.disabled=true;try{await api(`/notifications/${n.id}/read`,'POST',{});badge.textContent='읽음';read.remove();}catch(e){status.textContent=actionError(e);read.disabled=false;}};card.append(read);}
   const link=el('a','text-link',n.kind.startsWith('captain.')?'모집 상태 확인':'참여 상태 확인');link.href=n.kind.startsWith('captain.')?'#/hosting':'#/applications';card.append(link,status);root.append(card);
  }
 }catch(e){root.append(el('p','notice',actionError(e)));}
}
