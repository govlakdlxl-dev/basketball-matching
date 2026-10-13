import { describe, expect, test } from 'vitest';
import { calculatePaymentDeadline, parseInstant } from '../src/time';

describe('서버 결제 기한', () => {
  test.each([
    ['2026-10-13T09:10:00Z', '2026-10-13T09:40:00Z'],
    ['2026-10-13T09:50:00Z', '2026-10-13T10:00:00Z'],
  ])('수락 %s의 기한은 %s', (accepted, expected) => {
    expect(calculatePaymentDeadline(accepted, '2026-10-13T10:00:00Z')).toBe(expected);
  });
  test('이미 시작된 경기에는 결제 기한을 만들지 않는다', () => {
    expect(() => calculatePaymentDeadline('2026-10-13T10:00:00Z', '2026-10-13T10:00:00Z')).toThrow('MATCH_STARTED');
  });
  test.each(['2026-02-30T10:00:00Z', '2026-10-13T10:00:00+09:00', 'tomorrow'])('잘못된 UTC 시각 %s를 거부한다', value => {
    expect(() => parseInstant(value)).toThrow('INVALID_INSTANT');
  });
});
