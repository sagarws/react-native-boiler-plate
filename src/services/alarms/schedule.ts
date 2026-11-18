import type { Repeat } from './types';

/**
 * When a local wall-clock alarm rings next — the JS mirror of
 * android/.../alarms/AlarmMath.kt (same rules, both unit tested), used to
 * list and sort reminders. Times are in the device's current time zone.
 *
 * Repeats keep the original day: monthly on the 31st rings on the last day
 * of shorter months; yearly on 29 Feb rings on 28 Feb in other years.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface Local {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
}

function parse(date: string, time: string): Local | null {
  const a = DATE.exec(date);
  const b = TIME.exec(time);
  if (!a || !b) return null;
  const m = +a[2];
  const d = +a[3];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y: +a[1], m, d, h: +b[1], min: +b[2] };
}

const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

function instant(l: Local): number {
  return new Date(
    l.y,
    l.m - 1,
    Math.min(l.d, daysIn(l.y, l.m)),
    l.h,
    l.min,
  ).getTime();
}

function occurrence(s: Local, repeat: Repeat, n: number): Local {
  if (repeat === 'daily' || repeat === 'weekly') {
    const d = new Date(s.y, s.m - 1, s.d + (repeat === 'daily' ? n : n * 7));
    return { ...s, y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  }
  const months = repeat === 'monthly' ? n : repeat === 'yearly' ? n * 12 : 0;
  const total = s.y * 12 + (s.m - 1) + months;
  return { ...s, y: Math.floor(total / 12), m: (total % 12) + 1 };
}

const STEP: Record<Exclude<Repeat, 'never'>, number> = {
  daily: 86_400_000,
  weekly: 7 * 86_400_000,
  monthly: 28 * 86_400_000,
  yearly: 365 * 86_400_000,
};

/** The first occurrence strictly after [now], or null (passed one-off / invalid). */
export function nextOccurrence(
  date: string,
  time: string,
  repeat: Repeat,
  now: number,
): number | null {
  const s = parse(date, time);
  if (!s) return null;
  const first = instant(s);
  if (first > now) return first;
  if (repeat === 'never') return null;
  let n = Math.max(0, Math.floor((now - first) / STEP[repeat]) - 2);
  for (let guard = 0; guard < 5000; guard++, n++) {
    const at = instant(occurrence(s, repeat, n));
    if (at > now) return at;
  }
  return null;
}

/** The first occurrence (the start date itself), or null when invalid. */
export function firstOccurrence(date: string, time: string): number | null {
  const s = parse(date, time);
  return s ? instant(s) : null;
}

/**
 * Every occurrence within [from, to] (epoch ms, inclusive), in order — for
 * calendar dots and "what's on this day". Capped at [max].
 */
export function occurrencesBetween(
  date: string,
  time: string,
  repeat: Repeat,
  from: number,
  to: number,
  max = 62,
): number[] {
  const s = parse(date, time);
  if (!s || to < from) return [];
  const out: number[] = [];
  const first = instant(s);
  if (repeat === 'never') return first >= from && first <= to ? [first] : [];
  let n =
    first >= from
      ? 0
      : Math.max(0, Math.floor((from - first) / STEP[repeat]) - 2);
  for (let guard = 0; guard < 5000 && out.length < max; guard++, n++) {
    const at = instant(occurrence(s, repeat, n));
    if (at > to) break;
    if (at >= from) out.push(at);
  }
  return out;
}
