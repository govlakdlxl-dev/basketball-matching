import type {RefundRecord} from '@basket/core/contracts';
import type {Database} from '../../infra/database';
import type {TestPgAdapter,PgResult} from '../payments/pg-port';
type Work={orderId:string;paymentKey:string;leaseToken:string};
type Attempt={attemptId:string;requestId:string;additionalKrw:number};
export function createRefundWorker(database:Database,adapter:TestPgAdapter|null){
 async function record(orderId:string):Promise<RefundRecord>{const r=await database.rpc<RefundRecord|null>('api_get_refund_record',{p_actor:null,p_order:orderId});if(!r)throw new Error('REFUND_NOT_FOUND');return r;}
 async function processNextRefund(orderId:string):Promise<RefundRecord>{
  if(!adapter)return record(orderId);const work=await database.rpc<Work|null>('api_claim_refund',{p_order:orderId,p_provider:adapter.provider});if(!work)return record(orderId);
  let result:PgResult;try{result=await adapter.lookup(work);}catch{result={kind:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
  if(result.kind!=='confirmed')return database.rpc('api_finish_refund',{p_order:orderId,p_lease:work.leaseToken,p_attempt:null,p_result:result});
  const attempt=await database.rpc<Attempt|null>('api_prepare_refund',{p_order:orderId,p_lease:work.leaseToken,p_evidence:result.evidence,p_idempotent:adapter.capabilities.refundIdempotency});if(!attempt)return record(orderId);
  try{result=await adapter.refund({...work,...attempt,reason:'참가 취소에 따른 테스트 환불'});}catch{result={kind:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
  return database.rpc('api_finish_refund',{p_order:orderId,p_lease:work.leaseToken,p_attempt:attempt.attemptId,p_result:result});
 }
 return {processNextRefund,async runRefundTick(){const counts={processed:0,unknown:0,needsReview:0};if(!adapter)return counts;const rows=await database.rpc<string[]>('api_refund_candidates');for(const id of rows){const r=await processNextRefund(id);counts.processed++;if(r.status==='unknown')counts.unknown++;if(r.status==='needs_review')counts.needsReview++;}return counts;}};
}
