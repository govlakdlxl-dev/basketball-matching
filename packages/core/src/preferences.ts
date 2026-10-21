import type { Point, Position } from './contracts';
import { parseInstant } from './time';
export type Preferences = {
  origin: Point; mode: 'subway' | 'car'; maxMinutes: number;
  dateFrom: string; dateTo: string; weekdays: number[];
  earliestStartMinute: number; latestStartMinute: number; latestEndMinute: number | null;
  position: Position | null;
};
export function isPoint(input: unknown): input is Point {
  if (!input || typeof input !== 'object') return false;
  const { lat, lng } = input as Point;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function validatePreferences(input: unknown): Preferences {
  function reject(): never { throw new Error('INVALID_PREFERENCES'); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return reject();
  const value = input as Preferences;
  const keys = ['origin', 'mode', 'maxMinutes', 'dateFrom', 'dateTo', 'weekdays', 'earliestStartMinute', 'latestStartMinute', 'latestEndMinute', 'position'];
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !(key in value))) return reject();
  if (!isPoint(value.origin) || !['subway', 'car'].includes(value.mode)) return reject();
  if (!Number.isSafeInteger(value.maxMinutes) || value.maxMinutes <= 0) return reject();
  if (typeof value.dateFrom !== 'string' || typeof value.dateTo !== 'string') return reject();
  try { parseInstant(`${value.dateFrom}T00:00:00Z`); parseInstant(`${value.dateTo}T00:00:00Z`); } catch { return reject(); }
  if (value.dateFrom > value.dateTo) return reject();
  if (!Array.isArray(value.weekdays) || value.weekdays.length === 0 || value.weekdays.some(day => !Number.isInteger(day) || day < 1 || day > 7)) return reject();
  const validMinute = (minute: unknown) => typeof minute === 'number' && Number.isInteger(minute) && minute >= 0 && minute < 1440;
  if (!validMinute(value.earliestStartMinute) || !validMinute(value.latestStartMinute) || value.earliestStartMinute > value.latestStartMinute) return reject();
  if (value.latestEndMinute !== null && !validMinute(value.latestEndMinute)) return reject();
  if (value.position !== null && !['guard', 'forward', 'center'].includes(value.position)) return reject();
  return structuredClone(value);
}
