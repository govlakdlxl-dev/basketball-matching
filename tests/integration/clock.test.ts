import { expect, test } from 'vitest';
import worker from '../../apps/server/src/index';

test('공개 시계 응답은 UTC이며 캐시로 오래된 기한을 만들지 않는다', async () => {
  const response = await worker.fetch(new Request('https://basket.test/api/clock'));
  expect(response.status).toBe(200);
  const body = await response.json() as { now: string };
  expect(body.now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
