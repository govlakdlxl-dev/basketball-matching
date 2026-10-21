import type {PaymentStatus} from '@basket/core/contracts';
import type {Database,Env} from '../../infra/database';
import type {TestPgAdapter,PgResult,PgEvidence} from './pg-port';
import {createTossTestAdapter} from './toss-test';
import {createFakePgAdapter} from './fake-pg';
export function configuredTestPg(database:Database,env:Env):TestPgAdapter|null{
 if(env.TEST_PG_MODE==='fake'){
  if(env.ALLOW_LOCAL_TEST_PG!=='true'||!env.SUPABASE_URL||!['127.0.0.1','localhost'].includes(new URL(env.SUPABASE_URL).hostname))throw new Error('LOCAL_FAKE_PG_ONLY');
  return createFakePgAdapter('success',{get:orderId=>database.rpc<PgEvidence|null>('api_fake_pg_get',{p_order:orderId}),set:async evidence=>{await database.rpc('api_fake_pg_set',{p_order:evidence.orderId,p_evidence:evidence});}});
 }
 if(!env.TEST_PG_MODE||!env.TOSS_TEST_SECRET_KEY)return null;
 if(env.TEST_PG_MODE!=='toss')throw new Error('INVALID_TEST_PG_CONFIG');
 return createTossTestAdapter({mode:'test',secretKey:env.TOSS_TEST_SECRET_KEY});
}
type Work={attemptId:string;orderId:string;paymentKey:string;amountKrw:number;requestId:string;leaseToken:string;lookup:boolean;retryAllowed:boolean};
export function createPaymentWorker(database:Database,adapter:TestPgAdapter|null){
 const status=async(orderId:string)=>{const r=await database.client.from('test_orders').select('status').eq('id',orderId).single();if(r.error)throw new Error('PAYMENT_NOT_FOUND');return r.data.status as PaymentStatus;};
 async function process(attemptId:string,lookup=false):Promise<PaymentStatus>{
  const a=await database.client.from('approval_attempts').select('order_id').eq('id',attemptId).single();if(a.error)throw new Error('PAYMENT_NOT_FOUND');
  if(!adapter)return status(a.data.order_id as string);
  const work=await database.rpc<Work|null>('api_claim_approval',{p_attempt:attemptId,p_provider:adapter.provider,p_lookup:lookup});if(!work)return status(a.data.order_id as string);
  let result:PgResult;try{
   result=work.lookup?await adapter.lookup(work):await adapter.approve(work);
   // 조회가 주문 부재를 명시하고 제공자 멱등 보장 기간 안일 때만 최초 POST를 같은 키로 복구합니다.
   if(work.lookup&&result.kind==='unknown'&&['NOT_FOUND_PAYMENT','FAKE_NOT_FOUND'].includes(result.reason)&&adapter.capabilities.approvalIdempotency&&work.retryAllowed)result=await adapter.approve(work);
  }catch{result={kind:'unknown',reason:'PROVIDER_UNAVAILABLE'};}
  return database.rpc('api_apply_payment_result',{p_attempt:attemptId,p_lease:work.leaseToken,p_result:result});
 }
 return {processApproval:(attemptId:string)=>process(attemptId),
  async reconcilePayment(orderId:string):Promise<PaymentStatus>{const attempt=await database.rpc<{attemptId:string}|null>('api_payment_attempt',{p_order:orderId});return attempt?process(attempt.attemptId,true):status(orderId);},
  async runPaymentTick(){const counts={processed:0,unknown:0,needsReview:0};if(!adapter)return counts;const rows=await database.rpc<{attemptId:string}[]>('api_payment_candidates');for(const row of rows){const s=await process(row.attemptId);counts.processed++;if(s==='unknown')counts.unknown++;if(s==='needs_review')counts.needsReview++;}return counts;},
 };
}
