import {describe,expect,test} from 'vitest';
import {quoteFutureExample,quoteInitialTest} from '../src/money';
import {resolveRefundRatio,calculateRefundTarget,calculateRefundDelta} from '../src/refunds';
const start='2026-10-20T10:00:00.000Z';
const before=(ms:number)=>new Date(Date.parse(start)-ms).toISOString();
const hour=3600000;
describe('테스트 정책과 누적 환불',()=>{
  test.each([[2*hour+1,10000],[2*hour,10000],[2*hour-1,0]])('A의 경계 %i ms', (ms,ratio)=>{
    expect(resolveRefundRatio({version:'test-A-v1'},start,before(ms))).toBe(ratio);
  });
  test.each([[24*hour+1,10000],[24*hour,10000],[24*hour-1,5000],[2*hour+1,5000],[2*hour,5000],[2*hour-1,0]])('B의 경계 %i ms',(ms,ratio)=>{
    expect(resolveRefundRatio({version:'test-B-v1'},start,before(ms))).toBe(ratio);
  });
  test('처리 시각 대신 보존된 최초 접수 시각을 적용한다',()=>{
    const receipt={receivedAt:before(2*hour),processedAt:start};
    expect(resolveRefundRatio({version:'test-B-v1'},start,receipt.receivedAt)).toBe(5000);
  });
  test('초기 일부 완료 후 전액 차액만 계산하며 하향 목표는 완료액을 유지한다',()=>{
    const pricing=quoteInitialTest(10000),half=calculateRefundTarget(pricing,5000),full=calculateRefundTarget(pricing,10000);
    expect(half).toEqual({refundedKrw:5000,platformReturnedKrw:0,teamDeductedKrw:5000});
    expect(calculateRefundDelta(full,half)).toEqual({kind:'refund',target:full,additional:half});
    expect(calculateRefundDelta(half,full)).toEqual({kind:'none',target:full,additional:{refundedKrw:0,platformReturnedKrw:0,teamDeductedKrw:0}});
  });
  test.each([quoteInitialTest(10000),quoteFutureExample(9900,500),quoteFutureExample(10000,1000)])('모든 비율에서 참가·팀·플랫폼 금액이 보존된다',pricing=>{
    for(const ratio of [0,5000,10000] as const){
      const r=calculateRefundTarget(pricing,ratio);
      expect(pricing.paymentAmountKrw-r.refundedKrw).toBe(pricing.teamBasisKrw-r.teamDeductedKrw+pricing.platformFeeKrw-r.platformReturnedKrw);
      expect(pricing.pgCost.amountKrw).toBeNull();
    }
  });
  test('무료·안전 정수 최댓값은 중간 계산에도 정밀도를 잃지 않는다',()=>{
    const zero=calculateRefundTarget(quoteInitialTest(0),10000);
    expect(calculateRefundDelta(zero,zero).kind).toBe('none');
    expect(calculateRefundTarget(quoteInitialTest(Number.MAX_SAFE_INTEGER),5000).refundedKrw).toBe(4503599627370495);
  });
  test('비일관 원장과 위조 금액·정책·시간·비율을 거부한다',()=>{
    const p=quoteInitialTest(10000),full=calculateRefundTarget(p,10000);
    expect(()=>calculateRefundDelta(full,{refundedKrw:5000,platformReturnedKrw:1,teamDeductedKrw:5000})).toThrow('INVALID_REFUND_TOTALS');
    expect(()=>calculateRefundTarget({...p,paymentAmountKrw:Number.MAX_SAFE_INTEGER+1},10000)).toThrow('INVALID_WON');
    expect(()=>calculateRefundTarget({...p,teamBasisKrw:9000},10000)).toThrow('INVALID_PRICING');
    expect(()=>calculateRefundTarget(p,9000 as 10000)).toThrow('INVALID_REFUND_RATIO');
    expect(()=>resolveRefundRatio({version:'other' as 'test-A-v1'},start,before(hour))).toThrow('INVALID_POLICY');
    expect(()=>resolveRefundRatio({version:'test-A-v1'},start,'invalid')).toThrow('INVALID_INSTANT');
  });
});
