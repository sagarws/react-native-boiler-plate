import type { DayKey } from '../types';

/**
 * Calendar-day helpers. Day keys ("YYYY-MM-DD") are compared as strings and
 * moved with UTC arithmetic, so a day is always exactly one step — no
 * daylight-saving drift. Only converting to an instant (for countdowns)
 * uses the device's current local timezone.
 */

const DAY_MS = 86_400_000;
const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (n: number) => String(n).padStart(2, '0');

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string') return false;
  const m = KEY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCDate() === +m[3] && d.getUTCMonth() === +m[2] - 1;
}

/** The local calendar day of [date]. */
export function toDayKey(date: Date): DayKey {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
}

export const todayKey = (now: Date = new Date()): DayKey => toDayKey(now);

function utc(key: DayKey): number {
  const m = KEY.exec(key);
  if (!m) throw new Error(`Bad day key: ${key}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}

function fromUtc(ms: number): DayKey {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(
    d.getUTCDate(),
  )}`;
}

export const addDays = (key: DayKey, days: number): DayKey =>
  fromUtc(utc(key) + days * DAY_MS);

/** Whole days from [a] to [b] (negative if b is earlier). */
export const diffDays = (a: DayKey, b: DayKey): number =>
  Math.round((utc(b) - utc(a)) / DAY_MS);

/** 0 = Monday … 6 = Sunday. */
export const weekdayMon0 = (key: DayKey): number =>
  (new Date(utc(key)).getUTCDay() + 6) % 7;

/** The Monday of [key]'s week (weeks start on Monday throughout Manage Life). */
export const mondayOf = (key: DayKey): DayKey =>
  addDays(key, -weekdayMon0(key));

export const maxDay = (a: DayKey, b: DayKey): DayKey => (a > b ? a : b);
export const minDay = (a: DayKey, b: DayKey): DayKey => (a < b ? a : b);

/** Local midnight at the start of [key], in the device's current timezone. */
export function startOfDay(key: DayKey): Date {
  const m = KEY.exec(key)!;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

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
