import type {ApplicationRecord,TestOrder,RefundRecord} from '@basket/core/contracts';
import {api} from '../auth/session';
import {el,feeLabel,timeLabel,actionError} from '../ui';
import {handlePaymentReturn,pendingPaymentKey} from './return';
import type {Checkout} from './return';
import {createPlatform} from '../../platform/runtime';
import {sessionStoragePort} from '../auth/session';
import {refundPolicyView} from './policy-view';
export async function beginTestPayment(applicationId:string):Promise<void>{
 const order=await api<TestOrder>('/test-orders','POST',{applicationId,requestId:crypto.randomUUID()});
 const checkout=await api<Checkout>(`/test-orders/${order.id}/checkout`,'POST',{requestId:crypto.randomUUID()});
 const platform=createPlatform();if(platform.kind!=='web'){
  const origin=import.meta.env.VITE_PUBLIC_WEB_ORIGIN as string|undefined;if(!origin)throw new Error('CONFIG_REQUIRED');const base=new URL(origin);if(base.protocol!=='https:'||base.username||base.password)throw new Error('CONFIG_REQUIRED');
  await sessionStoragePort.setItem('basket.payment.pending',JSON.stringify({orderId:order.id}));const target=new URL('/checkout',base.origin);target.searchParams.set('token',checkout.returnToken);target.searchParams.set('app','1');await platform.openExternal(target.href);return;
 }
 sessionStorage.setItem(pendingPaymentKey,JSON.stringify(checkout));
 location.assign('/checkout?token='+encodeURIComponent(checkout.returnToken));
}
const refundNames={not_required:'환불 금액 없음',queued:'환불 접수 · 처리 대기',processing:'환불 처리 중',completed:'환불 완료',failed:'환불 실패 · 운영 확인 필요',unknown:'환불 결과 확인 중',needs_review:'환불 운영 확인 필요'} as const;
export async function paymentPanel(application:ApplicationRecord,order?:TestOrder){
 const box=el('div','payment-panel');box.append(el('p','muted','테스트 결제 · 실제 출금 없음'),el('p','',`팀 참가비 ${feeLabel(application.terms.pricing.baseFeeKrw)} · 플랫폼 수수료 0원`),refundPolicyView(application.terms));
 if(application.state==='awaiting_payment'){
  box.append(el('p','notice',`${timeLabel(application.paymentDeadlineAt!)}까지 결제해 주세요.`));const pay=el('button','btn','테스트 결제하기'),status=el('p','form-status');status.setAttribute('role','status');pay.onclick=async()=>{pay.disabled=true;try{await beginTestPayment(application.id);}catch(e){status.textContent=e instanceof Error&&e.message==='CONFIG_REQUIRED'?'테스트 결제 업체 설정을 준비 중이에요.':actionError(e);pay.disabled=false;}};box.append(pay,status);
 }
 if(order&&['unknown','approval_pending','needs_review'].includes(order.status)){
  const check=el('button','btn sec','결제 상태 확인'),message=el('p','notice','결제 결과를 확인 중이에요. 다시 결제하지 말고 상태를 확인해 주세요.');check.onclick=async()=>{check.disabled=true;try{const updated=await api<TestOrder>(`/test-orders/${order.id}/reconcile`,'POST',{});message.textContent=updated.status==='paid'?'결제 승인이 확인됐어요. 참여 내역을 새로 확인해 주세요.':updated.status==='needs_review'?'결제 내용을 운영자가 확인해야 해요.':'결제 결과가 아직 확인되지 않았어요.';}catch(e){message.textContent=actionError(e);}finally{check.disabled=false;}};box.append(message,check);
 }
 if(order){
  const refundBox=el('div');box.append(refundBox);
  async function show(reconcile=false){try{const refund=await api<RefundRecord|null>(`/test-orders/${order!.id}/refund${reconcile?'/reconcile':''}`,reconcile?'POST':'GET',reconcile?{}:undefined);refundBox.replaceChildren();if(!refund)return;refundBox.append(el('p','notice',refundNames[refund.status]),el('p','',`누적 환불 완료 ${feeLabel(refund.completed.refundedKrw)}`),el('p','muted',`현재 환불 목표 ${feeLabel(refund.target.refundedKrw)}`));const refresh=el('button','btn sec','환불 상태 확인');refresh.onclick=async()=>{refresh.disabled=true;await show(true);};refundBox.append(refresh);}catch(e){refundBox.replaceChildren(el('p','notice',actionError(e)));}}
  await show();
 }
 return box;
}
export async function checkoutView(root:HTMLElement,url:string){
 const parsed=new URL(url),token=parsed.searchParams.get('token');if(!token){root.append(el('p','notice','결제 연결이 유효하지 않아요. 참여 내역에서 다시 시작해 주세요.'));return;}
 try{
  const data=await api<Checkout>('/payments/checkout-data','POST',{token});sessionStorage.setItem(pendingPaymentKey,JSON.stringify(data));history.replaceState(null,'','/checkout');
  const card=el('section','card'),status=el('p','form-status'),button=el('button','btn',data.provider==='fake'?'로컬 테스트 승인':'토스 테스트 결제창 열기');
  card.append(el('span','badge',data.provider==='fake'?'실제 출금 없는 로컬 테스트':'토스 테스트 결제'),el('h3','',`총 결제액 ${feeLabel(data.amountKrw)}`),el('p','',`팀 참가비 ${feeLabel(data.amountKrw)}`),el('p','','플랫폼 수수료 0원'),refundPolicyView(data),el('p','muted','지금은 테스트 환경입니다. 결제 결과는 서버가 확인하고 참가 상태를 결정합니다.'),button,status);status.setAttribute('role','status');root.append(card);
  const returnUrl=(kind:'success'|'fail')=>{const r=new URL('/payment-return/'+kind,location.origin);r.searchParams.set('token',token);r.searchParams.set('nonce',data.nonce);if(parsed.searchParams.get('app')==='1'){r.searchParams.set('app','1');r.searchParams.set('appOrderId',data.orderId);}return r;};
  button.onclick=async()=>{button.disabled=true;try{
   if(data.provider==='fake'){const target=returnUrl('success');target.searchParams.set('orderId',data.orderId);target.searchParams.set('paymentKey','fake_'+crypto.randomUUID());target.searchParams.set('amount',String(data.amountKrw));location.assign(target.href);return;}
   if(!data.clientKey?.startsWith('test_ck_'))throw new Error('CONFIG_REQUIRED');const {loadTossPayments,ANONYMOUS}=await import('@tosspayments/tosspayments-sdk');const toss=await loadTossPayments(data.clientKey);
   await toss.payment({customerKey:ANONYMOUS}).requestPayment({method:'CARD',amount:{currency:'KRW',value:data.amountKrw},orderId:data.orderId,orderName:'농구 게스트 참가비 테스트',successUrl:returnUrl('success').href,failUrl:returnUrl('fail').href,windowTarget:'self',card:{flowMode:'DEFAULT'}});
  }catch(e){status.textContent='결제를 완료하지 못했어요. 참여 내역에서 상태와 기한을 확인해 주세요.';button.disabled=false;}};
 }catch(e){root.append(el('p','notice',actionError(e)));}
}
const returns=new Map<string,Promise<TestOrder|null>>();
export async function paymentReturnView(root:HTMLElement,url:string){
 const parsed=new URL(url),token=parsed.searchParams.get('token');history.replaceState(null,'','/payment-return');const card=el('section','card'),status=el('p','notice','결제 결과를 확인하고 있어요.'),link=el('a','btn sec','참여 내역 확인');link.href='/#/applications';card.append(el('h3','','테스트 결제 결과'),status,link);root.append(card);
 try{
  if(parsed.searchParams.get('app')==='1'){const id=parsed.searchParams.get('appOrderId');if(id&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)){const back=el('a','btn sec','설치 앱으로 돌아가기');back.href='basketpilot://payment/return?orderId='+encodeURIComponent(id);card.append(back);}}
  let pending=returns.get(url);if(!pending){pending=handlePaymentReturn(url);returns.set(url,pending);}await pending;
  if(parsed.pathname.endsWith('/fail')){status.textContent='결제를 완료하지 않았어요. 참여 내역에서 결제 기한을 확인해 주세요.';return;}
  for(let i=0;i<12;i++){const result=await api<{status:string}>('/payments/checkout-status','POST',{token});if(result.status==='paid'){status.textContent='결제 승인이 확인됐어요.';sessionStorage.removeItem(pendingPaymentKey);card.append(el('p','muted','현재 참가·취소 상태는 참여 내역에서 확인해 주세요.'));return;}if(['failed','needs_review'].includes(result.status)){status.textContent=result.status==='failed'?'결제 승인이 실패했어요. 참여 내역을 확인해 주세요.':'결제 내용을 운영자가 확인해야 해요.';return;}await new Promise(r=>setTimeout(r,750));}
  status.textContent='결제 결과를 계속 확인 중이에요. 참여 내역에서 확인할 수 있어요.';
 }catch(e){status.textContent=actionError(e);}
}
