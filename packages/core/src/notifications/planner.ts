import type {DomainEvent,UtcInstant,ApplicationRecord} from '../contracts';
import {parseInstant} from '../time';
import type {NotificationPlan,NotificationSnapshot,NoticeDraft,ReminderWindow,DeliveryDraft} from './contracts';
const step=300000;
const utc=(ms:number)=>new Date(ms).toISOString().replace('.000Z','Z');
const active=(a:ApplicationRecord)=>['pending','awaiting_payment','verifying_payment','confirmed'].includes(a.state);
export function planNotifications(event:DomainEvent|null,snapshot:NotificationSnapshot,now:UtcInstant):NotificationPlan{
 const t=parseInstant(now),start=parseInstant(snapshot.match.startsAt),open=snapshot.match.recruitmentStatus==='open'&&t<start;
 const plan:NotificationPlan={notices:[],deliveries:[],windows:[]};
 const notices=new Map<string,NoticeDraft>();
 function notice(a:ApplicationRecord|null,recipientId:string,logicalKey:string,kind:NoticeDraft['kind'],text:string,isActionable=false,targetVersion:number|null=null){const n={logicalKey,recipientId,matchId:snapshot.match.id,applicationId:a?.id??null,kind,text,isActionable,targetVersion};notices.set(recipientId+'|'+logicalKey,n);return n;}
 function delivery(n:NoticeDraft,milestone:string,dueAt:string,expiresAt:string|null,critical=false){if(expiresAt&&t>=parseInstant(expiresAt))return;for(const transport of (critical?['push','alimtalk']:['push']) as DeliveryDraft['transport'][]){plan.deliveries.push({logicalKeys:[n.logicalKey],recipientId:n.recipientId,matchId:n.matchId,milestone,transport,dueAt,expiresAt});}}
 function window(n:NoticeDraft,kind:ReminderWindow['kind'],anchorAt:string,endsAt:string){const existing=snapshot.windows.find(w=>w.kind===kind&&w.recipientId===n.recipientId&&w.matchId===n.matchId&&(kind!=='payment'||w.logicalKey===n.logicalKey));if(existing)return existing;const w={logicalKey:n.logicalKey,recipientId:n.recipientId,matchId:n.matchId,kind,anchorAt,endsAt};plan.windows.push(w);return w;}
 function repeat(n:NoticeDraft,w:ReminderWindow){const anchor=parseInstant(w.anchorAt),end=parseInstant(w.endsAt),index=Math.floor((t-anchor)/step),due=anchor+index*step;if(index<1||t>=end||due>=end)return;delivery(n,'repeat:'+utc(due),utc(due),w.endsAt);}
 for(const a of snapshot.applications){
  if(open&&a.state==='awaiting_payment'&&a.acceptedAt&&a.paymentDeadlineAt&&t<parseInstant(a.paymentDeadlineAt)){
   const n=notice(a,a.applicantId,`application:${a.id}:payment`,'application.accepted','신청이 수락되었습니다. 결제 기한까지 참가비를 결제해 주세요.',true),w=window(n,'payment',a.acceptedAt,a.paymentDeadlineAt);
   if(event?.kind==='application.accepted'&&event.applicationId===a.id)delivery(n,'initial',event.occurredAt,a.paymentDeadlineAt,true);
   else repeat(n,w);
  }
  if(a.state==='confirmed'&&event?.applicationId===a.id&&['application.accepted','payment.confirmed'].includes(event.kind)){
   const n=notice(a,a.applicantId,`application:${a.id}:confirmed`,'payment.confirmed','참가가 확정되었습니다. 참여 내역에서 경기와 모임 장소를 확인해 주세요.');delivery(n,'initial',event.occurredAt,null,true);
  }
 }
 const pending=snapshot.applications.filter(a=>a.state==='pending').sort((a,b)=>parseInstant(a.submittedAt)-parseInstant(b.submittedAt)||a.id.localeCompare(b.id));
 if(open){for(const captain of new Set(snapshot.activeCaptainIds)){
  if(pending.length){
   const old=snapshot.windows.find(w=>w.kind==='captain_pending'&&w.recipientId===captain&&w.matchId===snapshot.match.id),key=old?.logicalKey??`match:${snapshot.match.id}:captain:${captain}:pending:${pending[0]!.id}`;
   const n=notice(null,captain,key,'captain.pending',`미처리 신청 ${pending.length}건이 있습니다. 포지션과 인원을 확인해 수락·거절을 처리해 주세요.`,true),w=window(n,'captain_pending',now,utc(Math.min(t+1800000,start)));
   if(event?.kind==='application.submitted'&&pending.some(a=>a.id===event.applicationId))delivery(n,'event:'+event.id,event.occurredAt,utc(Math.min(parseInstant(event.occurredAt)+1800000,start)));
   else if(!old&&!event)delivery(n,'initial',now,w.endsAt);
   repeat(n,w);
  }
  if(t>=start-1800000&&(snapshot.roster.guestTargetShortage>0||snapshot.roster.minimumPlayerShortage>0)){
   const r=snapshot.roster,text=r.minimumPlayerShortage>0?`진행 최소 인원 ${r.minimumPlayerShortage}명 부족 · 게스트 목표 ${r.guestTargetShortage}명 남음. 주장이 진행·방식 변경·취소를 결정해 안내해 주세요.`:`진행 최소 인원은 확보 · 게스트 목표 ${r.guestTargetShortage}명 남음. 결제 대기 ${r.awaitingPayment}명·결제 확인 중 ${r.verifyingPayment}명입니다.`;
   const n=notice(null,captain,`match:${snapshot.match.id}:captain:${captain}:shortage`,'captain.shortage',text,true),w=window(n,'captain_shortage',utc(start-1800000),snapshot.match.startsAt);
   if(t<start-1800000+step)delivery(n,'initial',utc(start-1800000),w.endsAt);else repeat(n,w);
  }
 }}
 if(event?.matchId===snapshot.match.id){
  if(event.kind==='match.cancelled'&&snapshot.match.recruitmentStatus==='cancelled'){
   for(const recipient of new Set(snapshot.applications.map(a=>a.applicantId))){const n=notice(null,recipient,`match:${snapshot.match.id}:cancelled`,'match.cancelled','주최자가 경기를 취소했습니다. 결제한 참가비의 환불 상태는 참여 내역에서 확인해 주세요.');delivery(n,'initial',event.occurredAt,null,true);}
  }
  if(event.kind==='format.changed'){
   const f=snapshot.formatNotices.find(n=>n.id===event.payload.noticeId);if(f){for(const a of snapshot.applications.filter(a=>f.affectedApplicationIds.includes(a.id))){const declined=snapshot.cancellations.some(r=>r.applicationId===a.id&&r.cause==='format_change_declined'&&r.formatChangeId===f.id),latest=Math.max(...snapshot.formatNotices.map(n=>n.version));
    const n=notice(a,a.applicantId,`format:${f.id}:application:${a.id}`,'format.changed',`주최자 경기 방식 변경 · ${f.previousPlayersPerTeam}대${f.previousPlayersPerTeam} → ${f.currentPlayersPerTeam}대${f.currentPlayersPerTeam}. ${f.reason} 원래 신청 조건은 보존됩니다. 변경으로 불참하면 전액 환불 대상입니다.`,t<start&&!declined&&f.version===latest,f.version);delivery(n,'initial',f.announcedAt,null,true);
   }}
  }
  if(event.kind==='match.proceeding_reported'&&snapshot.match.recruitmentStatus!=='cancelled'){
   const r=snapshot.hostReports.find(report=>report.id===event.payload.reportId);if(r){for(const a of snapshot.applications.filter(a=>active(a)&&parseInstant(a.submittedAt)<=parseInstant(r.reportedAt))){const reportedAt=new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(r.reportedAt));
    const n=notice(a,a.applicantId,`host-report:${r.id}:application:${a.id}`,'match.proceeding_reported',`주최자가 진행을 안내함 · 담당자 기재 ${reportedAt}. ${r.reason}`);delivery(n,'initial',r.reportedAt,null);
   }}
  }
 }
 plan.notices=[...notices.values()];return plan;
}
