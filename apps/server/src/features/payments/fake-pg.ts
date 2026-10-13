import type {TestPgAdapter,PgEvidence,PgResult} from './pg-port';
export type FakePgStore={get(orderId:string):Promise<PgEvidence|null>;set(evidence:PgEvidence):Promise<void>};
export function createFakePgAdapter(scenario:'success'|'declined'|'timeout_then_success'|'mismatch',storage?:FakePgStore):TestPgAdapter{
 const memory=new Map<string,PgEvidence>(),store=storage??{get:async(id:string)=>memory.get(id)??null,set:async(e:PgEvidence)=>{memory.set(e.orderId,e);}};
 return {environment:'test',provider:'fake',capabilities:{approvalIdempotency:true,refundIdempotency:true},
  async approve(input){
   if(scenario==='declined')return {kind:'definitive_failure',code:'FAKE_DECLINED'};
   let evidence=await store.get(input.orderId);if(!evidence){evidence={environment:'test',orderId:input.orderId,paymentKey:input.paymentKey,currency:'KRW',paymentAmountKrw:input.amountKrw,approved:true,refundedKrw:0,refunds:[]};await store.set(evidence);}
   if(scenario==='timeout_then_success')return {kind:'unknown',reason:'FAKE_RESPONSE_LOST'};
   return {kind:'confirmed',evidence:scenario==='mismatch'?{...evidence,paymentAmountKrw:input.amountKrw+1}:evidence};
  },
  async lookup(input){const evidence=await store.get(input.orderId);return evidence?{kind:'confirmed',evidence}:{kind:'unknown',reason:'FAKE_NOT_FOUND'};},
  async refund(input):Promise<PgResult>{
   const evidence=await store.get(input.orderId);if(!evidence)return {kind:'unknown',reason:'FAKE_NOT_FOUND'};
   if(evidence.refunds.some(r=>r.requestId===input.requestId))return {kind:'confirmed',evidence};
   if(input.additionalKrw<=0||input.additionalKrw>evidence.paymentAmountKrw-evidence.refundedKrw)return {kind:'definitive_failure',code:'FAKE_INVALID_AMOUNT'};
   const next={...evidence,refundedKrw:evidence.refundedKrw+input.additionalKrw,refunds:[...evidence.refunds,{providerRefundId:'fake_'+input.requestId,requestId:input.requestId,amountKrw:input.additionalKrw}]};await store.set(next);return {kind:'confirmed',evidence:next};
  },
 };
}
