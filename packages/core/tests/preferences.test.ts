import { expect, test } from 'vitest';
import { validatePreferences } from '../src/preferences';

const valid = { origin: { lat: 37.5, lng: 126.7 }, mode: 'subway', maxMinutes: 30, dateFrom: '2026-10-13', dateTo: '2026-10-20', weekdays: [1, 2, 3, 4, 5], earliestStartMinute: 1080, latestStartMinute: 1380, latestEndMinute: null, position: null };
test('개인 시간과 전체 이동 시간 조건을 보존한다', () => {
  expect(validatePreferences(valid)).toEqual(valid);
});
test.each([
  { maxMinutes: 0 }, { origin: { lat: 37, lng: 181 } }, { weekdays: [0] },
  { dateFrom: '2026-10-21' }, { dateTo: '2026-02-30' }, { earliestStartMinute: 1440 },
  { latestStartMinute: 900 }, { latestEndMinute: 1440 }, { mode: 'bus' }, { position: 'any' },
])('유효하지 않은 조건 %j를 저장하지 않는다', change => {
  expect(() => validatePreferences({ ...valid, ...change })).toThrow('INVALID_PREFERENCES');
});
