import { describe, expect, test } from 'vitest';
import { quoteFutureExample, quoteInitialTest } from '../src/money';

describe('초기 주문과 향후 계산', () => {
  test('첫 10,000원 주문은 플랫폼 수수료 없이 같은 참가비다', () => {
    expect(quoteInitialTest(10000)).toMatchObject({ platformRateBps: 0, platformFeeKrw: 0, paymentAmountKrw: 10000, teamBasisKrw: 10000, purpose: 'initial_test_order', pgCost: { amountKrw: null, bearer: null } });
  });
  test.each([
    [10000, 500, 10250, 9750, 500, 250, 250],
    [10000, 1000, 10500, 9500, 1000, 500, 500],
    [9900, 500, 10147, 9652, 495, 247, 248],
  ] as const)('%i원 %i bps는 원단위 분담과 금액을 보존한다', (base, rate, payment, team, fee, guestFee, teamFee) => {
    const value = quoteFutureExample(base, rate);
    expect(value).toMatchObject({ paymentAmountKrw: payment, teamBasisKrw: team, platformFeeKrw: fee, participantFeeKrw: guestFee, teamFeeKrw: teamFee, purpose: 'calculator_only' });
    expect(value.paymentAmountKrw).toBe(value.teamBasisKrw + value.platformFeeKrw);
  });
  test('무료 참가비는 0원이며 PG 비용은 미확인이다', () => {
    expect(quoteInitialTest(0)).toMatchObject({ paymentAmountKrw: 0, teamBasisKrw: 0, pgCost: { status: 'unconfirmed', amountKrw: null } });
  });
  test.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('유효하지 않은 원 금액 %s를 거부한다', value => {
    expect(() => quoteInitialTest(value)).toThrow('INVALID_WON');
  });
  test('계산 중 안전 정수 범위를 넘기는 최종 금액을 거부한다', () => {
    expect(() => quoteFutureExample(Number.MAX_SAFE_INTEGER, 1000)).toThrow('INVALID_WON');
  });
  test('지원하지 않는 향후 요율을 런타임에도 거부한다', () => {
    expect(() => quoteFutureExample(10000, 900 as 500)).toThrow('INVALID_RATE');
  });
});
