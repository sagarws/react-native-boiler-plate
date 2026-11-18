import {
  firstOccurrence,
  nextOccurrence,
  occurrencesBetween,
  type AlarmEntry,
} from '@/services/alarms';
import {
  addDays,
  isDayKey,
  startOfDay,
  toDayKey,
  type DayKey,
} from '@/shared/utils/dayKey';
import {
  CATEGORY_COLOR,
  HIGHLIGHT,
  type Reminder,
  type ReminderError,
  type ReminderInput,
} from '../types';

/**
 * Reminder rules (pure; unit tested). Dates and times are the user's local
 * wall clock; the next ring is computed in the device's current time zone
 * (same rules as the native alarm engine).
 *
 * - Upcoming: enabled and with an occurrence after now, soonest first.
 * - Past: one-off reminders whose time has gone (they rang, or would have).
 * - Off: disabled reminders that still have an occurrence ahead.
 */

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 500;

export function validate(
  input: ReminderInput,
  now: number,
  isNew: boolean,
): ReminderError | null {
  if (!input.title.trim()) return 'title_required';
  if (!isDayKey(input.date)) return 'date_invalid';
  if (!TIME.test(input.time)) return 'time_invalid';
  // A new one-off must be in the future (a past one would never ring).
  if (
    isNew &&
    input.repeat === 'never' &&
    (firstOccurrence(input.date, input.time) ?? 0) <= now
  )
    return 'in_past';
  return null;
}

/** The next ring, or null when off / passed. */
export const nextAt = (r: Reminder, now: number): number | null =>
  r.enabled ? nextOccurrence(r.date, r.time, r.repeat, now) : null;

export interface ReminderViews {
  upcoming: { reminder: Reminder; at: number }[];
  past: { reminder: Reminder; at: number }[];
  off: Reminder[];
}

export function views(
  reminders: readonly Reminder[],
  now: number,
): ReminderViews {
  const upcoming: ReminderViews['upcoming'] = [];
  const past: ReminderViews['past'] = [];
  const off: Reminder[] = [];
  for (const r of reminders) {
    const next = nextOccurrence(r.date, r.time, r.repeat, now);
    if (next === null) {
      past.push({ reminder: r, at: firstOccurrence(r.date, r.time) ?? 0 });
    } else if (!r.enabled) {
      off.push(r);
    } else {
      upcoming.push({ reminder: r, at: next });
    }
  }
  upcoming.sort((a, b) => a.at - b.at);
  past.sort((a, b) => b.at - a.at);
  return { upcoming, past, off };
}

/** Reminders with an occurrence on [day], by time. */
export function onDay(
  reminders: readonly Reminder[],
  day: DayKey,
): { reminder: Reminder; at: number }[] {
  const from = startOfDay(day).getTime();
  const to = startOfDay(addDays(day, 1)).getTime() - 1;
  return reminders
    .flatMap(r =>
      occurrencesBetween(r.date, r.time, r.repeat, from, to, 1).map(at => ({
        reminder: r,
        at,
      })),
    )
    .sort((a, b) => a.at - b.at);
}

/**
 * Calendar dots for the month of [first] (its 1st day): per day, the
 * category colours of its reminders — birthdays and important events first.
 */
export function monthDots(
  reminders: readonly Reminder[],
  first: DayKey,
  days: number,
  color: (key: string) => string,
): Record<DayKey, string[]> {
  const from = startOfDay(first).getTime();
  const to = startOfDay(addDays(first, days)).getTime() - 1;
  const byDay = new Map<DayKey, Reminder[]>();
  for (const r of reminders) {
    for (const at of occurrencesBetween(r.date, r.time, r.repeat, from, to)) {
      const d = toDayKey(new Date(at));
      byDay.set(d, [...(byDay.get(d) ?? []), r]);
    }
  }
  const out: Record<DayKey, string[]> = {};
  for (const [d, list] of byDay) {
    const sorted = [...list].sort(
      (a, b) =>
        Number(HIGHLIGHT.includes(b.category)) -
        Number(HIGHLIGHT.includes(a.category)),
    );
    out[d] = [...new Set(sorted.map(r => color(CATEGORY_COLOR[r.category])))];
  }
  return out;
}

/** The alarm-engine entries for every enabled reminder. */
export function alarmEntries(
  reminders: readonly Reminder[],
  now: number,
  body: (r: Reminder) => string,
): AlarmEntry[] {
  return reminders
    .filter(r => nextAt(r, now) !== null)
    .map(r => ({
      key: `reminder:${r.id}`,
      title: r.title,
      body: body(r),
      at: 0,
      date: r.date,
      time: r.time,
      repeat: r.repeat,
      alert: r.alert,
      link: 'rnboilerplate://reminders',
    }));
}
