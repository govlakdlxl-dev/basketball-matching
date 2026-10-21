import type {TestPgAdapter,PgResult,PgEvidence} from './pg-port';
import {assertWon} from '@basket/core/money';

// 개별 결제창 test_ck_/test_sk_ 세트만 사용합니다. 실제 키·gsk 계열은 열지 않습니다.
export function createTossTestAdapter(config:{mode:'test';secretKey:string}):TestPgAdapter {
 if(config.mode!=='test'||!/^test_sk_[A-Za-z0-9_-]+$/.test(config.secretKey))throw new Error('INVALID_TEST_PG_CONFIG');
 const authorization='Basic '+btoa(config.secretKey+':');
 async function call(path:string,body?:Record<string,unknown>,requestId?:string):Promise<PgResult>{
  try {
   const response=await fetch('https://api.tosspayments.com'+path,{method:body?'POST':'GET',headers:{Authorization:authorization,'Content-Type':'application/json',...(requestId?{'Idempotency-Key':requestId}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(8000)});
   const value:unknown=await response.json();if(!value||typeof value!=='object')return {kind:'unknown',reason:'INVALID_PROVIDER_RESPONSE'};
   const p=value as Record<string,unknown>;
   if(!response.ok){
    const code=typeof p.code==='string'?p.code:'PROVIDER_ERROR';
    if(body&&response.status<500&&['REJECT_CARD_PAYMENT','REJECT_CARD_COMPANY','INVALID_REJECT_CARD','INVALID_CARD_NUMBER','INVALID_CARD_EXPIRATION','NOT_FOUND_PAYMENT_SESSION','REFUND_REJECTED','NOT_CANCELABLE_PAYMENT','NOT_ALLOWED_PARTIAL_REFUND'].includes(code))return {kind:'definitive_failure',code};
    return {kind:'unknown',reason:code};
   }
   if(['ABORTED','EXPIRED'].includes(String(p.status)))return {kind:'definitive_failure',code:'PROVIDER_'+String(p.status)};
   if(!['DONE','PARTIAL_CANCELED','CANCELED'].includes(String(p.status)))return {kind:'unknown',reason:'PROVIDER_NOT_FINAL'};
   if(typeof p.orderId!=='string'||typeof p.paymentKey!=='string'||p.currency!=='KRW'||p.method!=='카드')return {kind:'unknown',reason:'UNSUPPORTED_PROVIDER_PAYMENT'};
   assertWon(p.totalAmount);assertWon(p.balanceAmount);
   if(p.balanceAmount>p.totalAmount||p.cancels!==null&&!Array.isArray(p.cancels))return {kind:'unknown',reason:'INVALID_PROVIDER_BALANCE'};
   const refunds:PgEvidence['refunds']=[];
   for(const item of (p.cancels||[]) as Record<string,unknown>[]){
    if(item.cancelStatus!=='DONE')continue;
    if(typeof item.transactionKey!=='string'||!item.transactionKey)throw new Error('INVALID_REFUND_ID');assertWon(item.cancelAmount);
    refunds.push({providerRefundId:item.transactionKey,requestId:null,amountKrw:item.cancelAmount});
   }
   const total=refunds.reduce((sum,r)=>sum+BigInt(r.amountKrw),0n);
   if(total!==BigInt(p.totalAmount)-BigInt(p.balanceAmount)||new Set(refunds.map(r=>r.providerRefundId)).size!==refunds.length)return {kind:'unknown',reason:'INVALID_PROVIDER_BALANCE'};
   return {kind:'confirmed',evidence:{environment:'test',orderId:p.orderId,paymentKey:p.paymentKey,currency:'KRW',paymentAmountKrw:p.totalAmount,approved:true,refundedKrw:Number(total),refunds}};
  }catch{return {kind:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
 }
 return {environment:'test',provider:'toss_test',capabilities:{approvalIdempotency:true,refundIdempotency:true},
  approve:input=>call('/v1/payments/confirm',{paymentKey:input.paymentKey,orderId:input.orderId,amount:input.amountKrw},input.requestId),
  lookup:input=>call('/v1/payments/orders/'+encodeURIComponent(input.orderId)),
  refund:input=>{assertWon(input.additionalKrw);if(input.additionalKrw<=0)throw new Error('INVALID_REFUND_AMOUNT');return call('/v1/payments/'+encodeURIComponent(input.paymentKey)+'/cancel',{cancelReason:input.reason,cancelAmount:input.additionalKrw},input.requestId);},
 };
}
