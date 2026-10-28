import { startOfDay, type DayKey } from '@/shared/utils/dayKey';
import type { TimeKey } from '../types';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const isTimeKey = (value: unknown): value is TimeKey =>
  typeof value === 'string' && TIME_RE.test(value);

/** "9:5" / "0930" / "9.30" → "09:30"; null when it isn't a time. */
export function parseTime(raw: string): TimeKey | null {
  const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const key = `${m[1].padStart(2, '0')}:${m[2]}`;
  return isTimeKey(key) ? key : null;
}

/** The local instant of [day] at [time] (start of day when no time). */
export function instantOf(day: DayKey, time: TimeKey): Date {
  const d = startOfDay(day);
  if (isTimeKey(time)) {
    const [h, m] = time.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

/** Local "HH:MM" of [date]. */
export const timeOf = (date: Date): TimeKey =>
  `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
