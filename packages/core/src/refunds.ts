import type {PolicySnapshot,PricingSnapshot,RefundRatioBps,RefundTotals,RefundDelta,UtcInstant} from './contracts';
import {assertWon} from './money';
import {parseInstant} from './time';

export function resolveRefundRatio(policy:PolicySnapshot,startsAt:UtcInstant,receivedAt:UtcInstant):RefundRatioBps {
  const remaining=parseInstant(startsAt)-parseInstant(receivedAt);
  if(policy.version==='test-A-v1')return remaining>=7200000?10000:0;
  if(policy.version==='test-B-v1')return remaining>=86400000?10000:remaining>=7200000?5000:0;
  throw new Error('INVALID_POLICY');
}

export function calculateRefundTarget(pricing:PricingSnapshot,ratioBps:RefundRatioBps):RefundTotals {
  if(![0,5000,10000].includes(ratioBps))throw new Error('INVALID_REFUND_RATIO');
  for(const amount of [pricing.paymentAmountKrw,pricing.teamBasisKrw,pricing.platformFeeKrw])assertWon(amount);
  if(BigInt(pricing.paymentAmountKrw)!==BigInt(pricing.teamBasisKrw)+BigInt(pricing.platformFeeKrw))throw new Error('INVALID_PRICING');
  const refundedKrw=Number(BigInt(pricing.paymentAmountKrw)*BigInt(ratioBps)/10000n);
  const platformReturnedKrw=Number(BigInt(pricing.platformFeeKrw)*BigInt(ratioBps)/10000n);
  return {refundedKrw,platformReturnedKrw,teamDeductedKrw:refundedKrw-platformReturnedKrw};
}

function validateTotals(totals:RefundTotals):void {
  for(const value of Object.values(totals))assertWon(value);
  if(BigInt(totals.refundedKrw)!==BigInt(totals.platformReturnedKrw)+BigInt(totals.teamDeductedKrw))throw new Error('INVALID_REFUND_TOTALS');
}

export function calculateRefundDelta(target:RefundTotals,completed:RefundTotals):RefundDelta {
  validateTotals(target);validateTotals(completed);
  if(target.refundedKrw<=completed.refundedKrw)return {kind:'none',target:{...completed},additional:{refundedKrw:0,platformReturnedKrw:0,teamDeductedKrw:0}};
  if(target.platformReturnedKrw<completed.platformReturnedKrw||target.teamDeductedKrw<completed.teamDeductedKrw)throw new Error('INVALID_REFUND_TOTALS');
  return {kind:'refund',target:{...target},additional:{refundedKrw:target.refundedKrw-completed.refundedKrw,platformReturnedKrw:target.platformReturnedKrw-completed.platformReturnedKrw,teamDeductedKrw:target.teamDeductedKrw-completed.teamDeductedKrw}};
}
