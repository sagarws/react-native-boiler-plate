import { addDays, toDayKey, type DayKey } from '@/shared/utils/dayKey';
import type { FollowUpActivity, FollowUpStatus } from '../types';
import { instantOf, isTimeKey } from '../utils/time';

/**
 * A follow-up's status from its dates and the current local time — never
 * stored, so it can't contradict the schedule:
 * - no time: Due all of that day, Overdue from the next day;
 * - with a time: Due that day until the time, Overdue once it has passed.
 */
export function statusOf(a: FollowUpActivity, now: Date): FollowUpStatus {
  if (a.completedAt) return 'completed';
  if (a.cancelled) return 'cancelled';
  const today = toDayKey(now);
  if (a.day > today) return 'scheduled';
  if (a.day < today) return 'overdue';
  if (isTimeKey(a.time) && instantOf(a.day, a.time).getTime() < now.getTime())
    return 'overdue';
  return 'due';
}

export const isOpen = (a: FollowUpActivity): boolean =>
  !a.completedAt && !a.cancelled;

/** Sort key: when the follow-up is (untimed ones sort to the start of the day). */
export const scheduledMs = (a: FollowUpActivity): number =>
  instantOf(a.day, a.time).getTime();

/** The next occurrence of a birthday on or after [today]. */
export function nextBirthday(birthDate: DayKey, today: DayKey): DayKey {
  const md = birthDate.slice(5);
  const year = Number(today.slice(0, 4));
  for (const y of [year, year + 1]) {
    // 29 Feb falls back to 28 Feb in non-leap years.
    let key = `${y}-${md}`;
    if (md === '02-29' && !isLeap(y)) key = `${y}-02-28`;
    if (key >= today) return key;
  }
  return addDays(today, 366);
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
