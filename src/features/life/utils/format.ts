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

/**
 * Quick-add chip steps for a target: +5, +10, +15. Tiny targets (under 5)
 * use +1, +2, +3; big ones scale by tens so the chips stay useful
 * (1,000 → +50/+100/+150; 10,000 → +500/+1,000/+1,500).
 */
export function quickAddSteps(target: number): number[] {
  if (!(target > 0)) return [5, 10, 15];
  if (target < 5) return [1, 2, 3];
  const scale = target >= 1000 ? 10 ** Math.floor(Math.log10(target / 100)) : 1;
  return [5, 10, 15].map(n => n * scale);
}

/** Adds [step] to a typed amount (empty or invalid counts as 0). */
export function addToAmount(text: string, step: number): string {
  const current = parseAmount(text);
  const next = (Number.isFinite(current) ? current : 0) + step;
  return String(Math.round(next * 100) / 100);
}

/** Parses a user-typed amount ("1,5" or "1.5"); NaN when not a number. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(',', '.').trim();
  if (!/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return NaN;
  return Number(cleaned);
}
