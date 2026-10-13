import type {Id,Won} from '@basket/core/contracts';
export type PgRefundEvidence={providerRefundId:string;requestId:Id|null;amountKrw:Won};
export type PgEvidence={environment:'test';orderId:Id;paymentKey:string;currency:'KRW';paymentAmountKrw:Won;approved:boolean;refundedKrw:Won;refunds:PgRefundEvidence[]};
export type PgResult={kind:'confirmed';evidence:PgEvidence}|{kind:'definitive_failure';code:string}|{kind:'unknown';reason:string};
export interface TestPgAdapter {
 readonly environment:'test';readonly provider:'fake'|'toss_test';readonly capabilities:{approvalIdempotency:boolean;refundIdempotency:boolean};
 approve(input:{orderId:Id;paymentKey:string;amountKrw:Won;requestId:Id}):Promise<PgResult>;
 lookup(input:{orderId:Id;paymentKey:string}):Promise<PgResult>;
 refund(input:{orderId:Id;paymentKey:string;additionalKrw:Won;requestId:Id;reason:string}):Promise<PgResult>;
}
