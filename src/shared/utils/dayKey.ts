/**
 * Calendar-day helpers shared by features that schedule by day. Day keys
 * ("YYYY-MM-DD") are compared as strings and moved with UTC arithmetic, so a
 * day is always exactly one step — no daylight-saving drift. Only converting
 * to an instant uses the device's current local timezone.
 */

export type DayKey = string;

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

/** Local midnight at the start of [key], in the device's current timezone. */
export function startOfDay(key: DayKey): Date {
  const m = KEY.exec(key)!;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}
