import type { DayKey } from '../types';

export interface Span {
  years: number;
  months: number;
  days: number;
  /** [to] is before [from]. */
  past: boolean;
}

const parts = (k: DayKey) =>
  k.split('-').map(Number) as [number, number, number];

/**
 * Calendar distance between two days in whole years, months and days
 * (e.g. 8y 2m 5d), counted the way people do — month lengths respected.
 */
export function spanBetween(from: DayKey, to: DayKey): Span {
  const past = to < from;
  const [a, b] = past ? [to, from] : [from, to];
  const [y1, m1, d1] = parts(a);
  const [y2, m2] = parts(b);
  // [a] moved forward k whole months, its day capped at the month's end
  // (31 Jan + 1 month = 28 Feb), as a UTC timestamp.
  const anchor = (k: number) => {
    const last = new Date(Date.UTC(y1, m1 - 1 + k + 1, 0)).getUTCDate();
    return Date.UTC(y1, m1 - 1 + k, Math.min(d1, last));
  };
  const bMs = Date.parse(`${b}T00:00:00Z`);
  let total = (y2 - y1) * 12 + (m2 - m1);
  if (anchor(total) > bMs) total -= 1;
  const days = Math.round((bMs - anchor(total)) / 86_400_000);
  return { years: Math.floor(total / 12), months: total % 12, days, past };
}

/** "2026–2045" or "2026" for a single year. */
export function yearRange(start: DayKey, end: DayKey): string {
  const a = start.slice(0, 4);
  const b = end.slice(0, 4);
  return a === b ? a : `${a}–${b}`;
}

/** "28 Oct 2045" in the device locale (plans span decades, so always with the year). */
export function formatDate(key: DayKey): string {
  const [y, m, d] = parts(key);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
