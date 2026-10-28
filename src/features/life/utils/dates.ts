import type { DayKey } from '../types';
import { addDays, startOfDay } from '@/shared/utils/dayKey';

/**
 * Manage Life's calendar helpers on top of the shared day-key ones (weeks
 * start on Monday throughout Manage Life).
 */
export {
  addDays,
  diffDays,
  isDayKey,
  startOfDay,
  toDayKey,
  todayKey,
} from '@/shared/utils/dayKey';

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function utc(key: DayKey): number {
  const m = KEY.exec(key)!;
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function fromUtc(ms: number): DayKey {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}`;
}

/** 0 = Monday … 6 = Sunday. */
export const weekdayMon0 = (key: DayKey): number =>
  (new Date(utc(key)).getUTCDay() + 6) % 7;

/** The Monday of [key]'s week (weeks start on Monday throughout Manage Life). */
export const mondayOf = (key: DayKey): DayKey =>
  addDays(key, -weekdayMon0(key));

export const maxDay = (a: DayKey, b: DayKey): DayKey => (a > b ? a : b);
export const minDay = (a: DayKey, b: DayKey): DayKey => (a < b ? a : b);

/** The instant a period ending on [endKey] closes: local midnight after it. */
export const periodCloses = (endKey: DayKey): Date =>
  startOfDay(addDays(endKey, 1));

/** First day of [key]'s month. */
export const monthStart = (key: DayKey): DayKey => `${key.slice(0, 7)}-01`;

export function addMonths(key: DayKey, months: number): DayKey {
  const m = KEY.exec(key)!;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1 + months, 1));
  return fromUtc(d.getTime());
}

export function daysInMonth(key: DayKey): number {
  const m = KEY.exec(key)!;
  return new Date(Date.UTC(+m[1], +m[2], 0)).getUTCDate();
}

/** "3h 20m", "2d 4h", "12m" — compact time remaining; "0m" when past. */
export function formatDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
