import type { DayKey } from '../types';
import { startOfDay } from './dates';

/** "28 Oct" in the device locale. */
export function formatDay(key: DayKey): string {
  return startOfDay(key).toLocaleDateString([], {
    day: 'numeric',
    month: 'short',
  });
}

/** "Wed, 28 Oct 2026". */
export function formatLongDay(key: DayKey): string {
  return startOfDay(key).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** "October 2026". */
export function formatMonth(key: DayKey): string {
  return startOfDay(key).toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
}

/** A period as text: the single day, or "26 Oct – 1 Nov". */
export function formatPeriod(start: DayKey, end: DayKey): string {
  return start === end
    ? formatDay(start)
    : `${formatDay(start)} – ${formatDay(end)}`;
}

/** Quantities without float noise: 12, 2.5, 0.25. */
export function formatQty(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString();
  return (Math.round(n * 100) / 100).toLocaleString();
}

/** Parses a user-typed amount ("1,5" or "1.5"); NaN when not a number. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(',', '.').trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
