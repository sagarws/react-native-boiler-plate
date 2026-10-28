import type {
  DayKey,
  PeriodReview,
  ProgressReport,
  Task,
  TargetVersion,
} from '../types';
import {
  addDays,
  diffDays,
  maxDay,
  minDay,
  mondayOf,
  periodCloses,
  toDayKey,
} from '../utils/dates';

/**
 * Target-period calculation — the single source of truth for every screen
 * (cards, Today, calendar, history, charts, AI input).
 *
 * Rules:
 * - Periods are whole local calendar days, inclusive [start, end]. A period
 *   closes at local midnight after `end`.
 * - daily: one day. weekly: Monday–Sunday; the first week is partial when
 *   the task starts mid-week. interval: `intervalDays` days counted from the
 *   target version's `effectiveFrom`.
 * - Periods are clipped to the task's start/end dates and to the next target
 *   version (edits take effect at a period boundary, so history keeps the
 *   target it had — see `nextPeriodStart`).
 * - Progress counts by the report's `day`; several reports accumulate.
 * - A period is "paused" when a pause covers all of it: no report required.
 * - Periods that ended before the task was created are "untracked" (never
 *   ask for reasons about time before tracking began).
 * - No reports ≠ zero progress: `hasReports` tells them apart.
 */

export interface Period {
  taskId: string;
  start: DayKey;
  end: DayKey;
  target: TargetVersion;
}

export type PeriodStatus =
  /** Contains today. */
  | 'active'
  /** Ended with the target met. */
  | 'achieved'
  /** Ended short of the target; a reason is still needed. */
  | 'report_required'
  /** Ended short of the target; reason given. */
  | 'missed'
  | 'paused'
  | 'upcoming'
  /** Ended before tracking began. */
  | 'untracked';

export interface PeriodState extends Period {
  status: PeriodStatus;
  completed: number;
  /** Never negative. */
  remaining: number;
  /** 0–100 for progress bars. */
  percent: number;
  /** completed / target, unclamped (1.5 = 150%). */
  ratio: number;
  exceeded: boolean;
  /** Target met (also true for an active period met early). */
  met: boolean;
  hasReports: boolean;
  reportCount: number;
  review: PeriodReview | null;
  /** When the period closes (local midnight after `end`). */
  closesAt: Date;
}

/** Human-friendly length of a target version's period, in days. */
export const periodDays = (t: TargetVersion): number =>
  t.frequency === 'daily'
    ? 1
    : t.frequency === 'weekly'
    ? 7
    : Math.max(1, Math.round(t.intervalDays));

/** The target version in force on [day] (null before the task starts). */
export function targetOn(task: Task, day: DayKey): TargetVersion | null {
  if (day < task.startDate) return null;
  let current: TargetVersion | null = null;
  for (const v of task.targets) {
    if (v.effectiveFrom <= day) current = v;
    else break;
  }
  return current ?? task.targets[0] ?? null;
}

function nextVersionStart(task: Task, after: DayKey): DayKey | null {
  for (const v of task.targets)
    if (v.effectiveFrom > after) return v.effectiveFrom;
  return null;
}

/** The period containing [day], or null outside the task's dates. */
export function periodContaining(task: Task, day: DayKey): Period | null {
  if (day < task.startDate || (task.endDate && day > task.endDate)) return null;
  const target = targetOn(task, day);
  if (!target) return null;
  const anchor = maxDay(target.effectiveFrom, task.startDate);
  let start: DayKey;
  let end: DayKey;
  if (target.frequency === 'daily') {
    start = end = day;
  } else if (target.frequency === 'weekly') {
    const monday = mondayOf(day);
    start = maxDay(monday, anchor);
    end = addDays(monday, 6);
  } else {
    const n = periodDays(target);
    const index = Math.floor(diffDays(anchor, day) / n);
    start = addDays(anchor, index * n);
    end = addDays(start, n - 1);
  }
  if (task.endDate) end = minDay(end, task.endDate);
  const next = nextVersionStart(task, start);
  if (next && next <= end) end = addDays(next, -1);
  return { taskId: task.id, start, end, target };
}

/** Periods overlapping [from, to], in order. */
export function periodsBetween(task: Task, from: DayKey, to: DayKey): Period[] {
  const out: Period[] = [];
  let day = maxDay(from, task.startDate);
  let guard = 0;
  while (day <= to && guard++ < 5000) {
    const p = periodContaining(task, day);
    if (!p) break;
    out.push(p);
    day = addDays(p.end, 1);
  }
  return out;
}

/**
 * Where a target edit made on [today] takes effect: the start of the next
 * period, so the current and past periods keep the target they had.
 */
export function nextPeriodStart(task: Task, today: DayKey): DayKey {
  if (today < task.startDate) return task.startDate;
  const current = periodContaining(task, today);
  return current ? addDays(current.end, 1) : today;
}

function isPaused(task: Task, p: Period): boolean {
  return task.pauses.some(
    x => x.from <= p.start && (x.to === null || x.to >= p.end),
  );
}

/** Reports counting towards [p]. */
export function reportsIn(
  p: Period,
  reports: readonly ProgressReport[],
): ProgressReport[] {
  return reports.filter(
    r => r.taskId === p.taskId && r.day >= p.start && r.day <= p.end,
  );
}

export interface EvaluateInput {
  reports: readonly ProgressReport[];
  reviews: readonly PeriodReview[];
  today: DayKey;
}

export function evaluate(
  task: Task,
  p: Period,
  { reports, reviews, today }: EvaluateInput,
): PeriodState {
  const mine = reportsIn(p, reports);
  const completed = mine.reduce((sum, r) => sum + r.quantity, 0);
  const target = p.target.quantity;
  const ratio = target > 0 ? completed / target : 0;
  const met = target > 0 && completed >= target;
  const review =
    reviews.find(r => r.taskId === p.taskId && r.periodStart === p.start) ??
    null;
  const trackingFrom = maxDay(
    task.startDate,
    toDayKey(new Date(task.createdAt)),
  );

  let status: PeriodStatus;
  if (isPaused(task, p)) status = 'paused';
  else if (p.start > today) status = 'upcoming';
  else if (p.end >= today) status = 'active';
  else if (met) status = 'achieved';
  else if (review) status = 'missed';
  else if (p.end < trackingFrom) status = 'untracked';
  else status = 'report_required';

  return {
    ...p,
    status,
    completed,
    remaining: Math.max(0, target - completed),
    percent: Math.max(0, Math.min(100, Math.round(ratio * 100))),
    ratio,
    exceeded: completed > target,
    met,
    hasReports: mine.length > 0,
    reportCount: mine.length,
    review,
    closesAt: periodCloses(p.end),
  };
}

/** The task's period for today, evaluated — null if not running today. */
export function currentState(
  task: Task,
  input: EvaluateInput,
): PeriodState | null {
  const p = periodContaining(task, input.today);
  return p ? evaluate(task, p, input) : null;
}

/** Ended periods in [from, to] needing a reason, oldest first. */
export function pendingReviews(
  task: Task,
  input: EvaluateInput,
  from: DayKey = task.startDate,
): PeriodState[] {
  if (task.status === 'archived') return [];
  const yesterday = addDays(input.today, -1);
  return periodsBetween(task, from, yesterday)
    .map(p => evaluate(task, p, input))
    .filter(s => s.status === 'report_required');
}

/** Consecutive met periods ending with the latest ended (or met current) one. */
export function streak(
  task: Task,
  input: EvaluateInput,
  lookbackDays = 400,
): number {
  const states = periodsBetween(
    task,
    addDays(input.today, -lookbackDays),
    input.today,
  ).map(p => evaluate(task, p, input));
  let count = 0;
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i];
    if (s.status === 'active') {
      if (s.met) count++;
      continue;
    }
    if (s.status === 'paused' || s.status === 'untracked') continue;
    if (s.status === 'achieved') count++;
    else break;
  }
  return count;
}

/** "30 minutes every day", "10 pages every 2 days", "5 hours every week". */
export function describeTarget(
  t: Pick<TargetVersion, 'quantity' | 'frequency' | 'intervalDays'>,
  unit: string,
  words: {
    everyDay: string;
    everyWeek: string;
    everyNDays: (n: number) => string;
  },
): string {
  const qty = Number.isInteger(t.quantity)
    ? String(t.quantity)
    : t.quantity.toFixed(2).replace(/\.?0+$/, '');
  const when =
    t.frequency === 'daily'
      ? words.everyDay
      : t.frequency === 'weekly'
      ? words.everyWeek
      : words.everyNDays(Math.max(1, Math.round(t.intervalDays)));
  return `${qty} ${unit} ${when}`;
}
