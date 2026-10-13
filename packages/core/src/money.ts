import type { PricingSnapshot, Won } from './contracts';

export function assertWon(value: unknown): asserts value is Won {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_WON');
}

function fromInteger(value: bigint): Won {
  const result = Number(value);
  assertWon(result);
  return result;
}

function quote(baseFeeKrw: Won, rate: 0 | 500 | 1000, purpose: PricingSnapshot['purpose']): PricingSnapshot {
  assertWon(baseFeeKrw);
  const base = BigInt(baseFeeKrw);
  const fee = base * BigInt(rate) / 10000n;
  const guest = fee / 2n;
  const team = fee - guest;
  return {
    baseFeeKrw, platformRateBps: rate, purpose, currency: 'KRW',
    platformFeeKrw: fromInteger(fee), participantFeeKrw: fromInteger(guest), teamFeeKrw: fromInteger(team),
    paymentAmountKrw: fromInteger(base + guest), teamBasisKrw: fromInteger(base - team),
    pgCost: { status: 'unconfirmed', amountKrw: null, bearer: null, reason: '견적과 부담 방식을 확인하지 않았습니다.' },
  };
}

export function quoteInitialTest(baseFeeKrw: Won): PricingSnapshot & { platformRateBps: 0; purpose: 'initial_test_order' } {
  return { ...quote(baseFeeKrw, 0, 'initial_test_order'), platformRateBps: 0, purpose: 'initial_test_order' };
}

export function quoteFutureExample(baseFeeKrw: Won, rate: 500 | 1000): PricingSnapshot & { purpose: 'calculator_only' } {
  if (rate !== 500 && rate !== 1000) throw new Error('INVALID_RATE');
  return { ...quote(baseFeeKrw, rate, 'calculator_only'), purpose: 'calculator_only' };
}
