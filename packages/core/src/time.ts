import type { UtcInstant } from './contracts';

export function parseInstant(value: UtcInstant): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) throw new Error('INVALID_INSTANT');
  const timestamp = Date.parse(value);
  const canonical = value.replace(/(\.\d{1,3})?Z$/, (_match, fraction: string | undefined) => `${(fraction ?? '.000').padEnd(4, '0')}Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== canonical) throw new Error('INVALID_INSTANT');
  return timestamp;
}

export function calculatePaymentDeadline(acceptedAt: UtcInstant, startsAt: UtcInstant): UtcInstant {
  const accepted = parseInstant(acceptedAt);
  const starts = parseInstant(startsAt);
  if (accepted >= starts) throw new Error('MATCH_STARTED');
  return new Date(Math.min(accepted + 30 * 60_000, starts)).toISOString().replace('.000Z', 'Z');
}
