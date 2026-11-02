import type { DayKey, LifeData, PeriodReview, Project, Task } from '../types';
import { addDays, diffDays, maxDay, minDay } from '../utils/dates';
import {
  evaluate,
  periodContaining,
  periodsBetween,
  reportsIn,
  type EvaluateInput,
  type Period,
  type PeriodState,
} from './periods';

/**
 * Task and project progress for the detail pages: calendar shading, the
 * task target-vs-actual chart and the project multi-line chart. Pure and
 * built on the period service, so every number comes from saved targets and
 * reports. Quantities are only summed within one task (one unit); anything
 * combining tasks uses each task's own completion ratio.
 */

// ── Calendar levels ───────────────────────────────────────────────────

/**
 * Shade of a calendar day. `none` = neutral: no target that day, paused,
 * not yet started (future period), or nothing reported.
 */
export type ProgressLevel = 'none' | 'low' | 'partial' | 'high' | 'full';

export const PROGRESS_LEVELS: readonly Exclude<ProgressLevel, 'none'>[] = [
  'low',
  'partial',
  'high',
  'full',
];

/** Completion ratio (1 = target met) → shade. Thresholds: ⅓, ⅔, 1. */
export function levelFor(ratio: number | null): ProgressLevel {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return 'none';
  if (ratio >= 1) return 'full';
  if (ratio >= 2 / 3) return 'high';
  if (ratio >= 1 / 3) return 'partial';
  return 'low';
}

/** A ratio as a whole percent, capped at 100 for display. */
export const percentOf = (ratio: number) =>
  Math.max(0, Math.min(100, Math.round(ratio * 100)));

const counts = (s: PeriodState) =>
  s.status !== 'paused' && s.status !== 'upcoming';

export interface TaskDay {
  day: DayKey;
  /** The target period containing the day (null: no target that day). */
  state: PeriodState | null;
  level: ProgressLevel;
  /** Reported completion 0–100 (capped), or null when neutral. */
  percent: number | null;
}

/** One entry per day of [from, to] for a task's calendar. */
export function taskCalendar(
  task: Task,
  inp: EvaluateInput,
  from: DayKey,
  to: DayKey,
): Record<DayKey, TaskDay> {
  const out: Record<DayKey, TaskDay> = {};
  const states = periodsBetween(task, from, to).map(p =>
    evaluate(task, p, inp),
  );
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const state = states.find(s => s.start <= d && s.end >= d) ?? null;
    const scored = state && counts(state) && state.hasReports;
    out[d] = {
      day: d,
      state,
      level: scored ? levelFor(state.ratio) : 'none',
      percent: scored ? percentOf(state.ratio) : null,
    };
  }
  return out;
}

export interface ProjectDayTask {
  task: Task;
  state: PeriodState;
}

export interface ProjectDay {
  day: DayKey;
  /** Tasks with a counted target period on this day (not paused / future). */
  scheduled: ProjectDayTask[];
  /** Mean of min(ratio, 1) over `scheduled` (unreported = 0); null when neutral. */
  average: number | null;
  level: ProgressLevel;
  percent: number | null;
}

/** Project tasks that can carry progress (archived ones are left out). */
export const projectTasks = (data: LifeData, projectId: string): Task[] =>
  data.tasks.filter(t => t.projectId === projectId && t.status !== 'archived');

/**
 * One entry per day of [from, to]: the average completion of the task
 * targets scheduled that day, each against its own target. Neutral when no
 * target is scheduled or none of the scheduled ones has a report.
 */
export function projectCalendar(
  tasks: readonly Task[],
  inp: EvaluateInput,
  from: DayKey,
  to: DayKey,
): Record<DayKey, ProjectDay> {
  const perTask = tasks.map(task => ({
    task,
    states: periodsBetween(task, from, to).map(p => evaluate(task, p, inp)),
  }));
  const out: Record<DayKey, ProjectDay> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const scheduled: ProjectDayTask[] = [];
    for (const { task, states } of perTask) {
      const state = states.find(s => s.start <= d && s.end >= d);
      if (state && counts(state)) scheduled.push({ task, state });
    }
    const reported = scheduled.some(x => x.state.hasReports);
    const average =
      scheduled.length && reported
        ? scheduled.reduce((sum, x) => sum + Math.min(1, x.state.ratio), 0) /
          scheduled.length
        : null;
    out[d] = {
      day: d,
      scheduled,
      average,
      level: average === null ? 'none' : levelFor(average),
      percent: average === null ? null : percentOf(average),
    };
  }
  return out;
}

// ── Task summary ──────────────────────────────────────────────────────

export interface TaskSummary {
  /** Today's period (null when the task isn't running today). */
  current: PeriodState | null;
  /** Ended periods: met / missed (reason given or still needed). */
  met: number;
  missed: number;
  /** met / (met + missed), 0–100; null when nothing ended. */
  successRate: number | null;
  /** Start of the next period when not running today (e.g. before the start). */
  nextStart: DayKey | null;
  reviews: PeriodReview[];
}

export function taskSummary(task: Task, inp: EvaluateInput): TaskSummary {
  const yesterday = addDays(inp.today, -1);
  const ended = periodsBetween(task, task.startDate, yesterday).map(p =>
    evaluate(task, p, inp),
  );
  const met = ended.filter(s => s.status === 'achieved').length;
  const missed = ended.filter(
    s => s.status === 'missed' || s.status === 'report_required',
  ).length;
  const p = periodContaining(task, inp.today);
  return {
    current: p ? evaluate(task, p, inp) : null,
    met,
    missed,
    successRate: met + missed ? Math.round((met / (met + missed)) * 100) : null,
    nextStart: !p && inp.today < task.startDate ? task.startDate : null,
    reviews: inp.reviews
      .filter(r => r.taskId === task.id)
      .sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1)),
  };
}

// ── Task chart: target vs actual per period ───────────────────────────

export interface PeriodBar {
  start: DayKey;
  end: DayKey;
  target: number;
  completed: number;
  /** completed / target, unclamped; null when nothing was reported. */
  ratio: number | null;
  status: PeriodState['status'];
}

/** The task's periods overlapping [from, to] (paused ones left out). */
export function taskPeriodBars(
  task: Task,
  inp: EvaluateInput,
  from: DayKey,
  to: DayKey,
): PeriodBar[] {
  return periodsBetween(task, from, to)
    .map(p => evaluate(task, p, inp))
    .filter(s => s.status !== 'paused')
    .map(s => ({
      start: s.start,
      end: s.end,
      target: s.target.quantity,
      completed: s.completed,
      ratio: s.hasReports ? s.ratio : null,
      status: s.status,
    }));
}

// ── Project chart: cumulative actual vs planned ───────────────────────

/** Last day a task's plan runs to: its end date, else the project deadline. */
export const planEnd = (task: Task, project: Project): DayKey =>
  task.endDate ?? project.deadline;

interface PlanPeriod extends Period {
  days: number;
}

function planPeriods(task: Task, project: Project): PlanPeriod[] {
  const end = planEnd(task, project);
  if (end < task.startDate) return [];
  return periodsBetween(task, task.startDate, end)
    .filter(
      p =>
        !task.pauses.some(
          x => x.from <= p.start && (x.to === null || x.to >= p.end),
        ),
    )
    .map(p => ({ ...p, days: diffDays(p.start, p.end) + 1 }));
}

export interface TaskProgressSeries {
  task: Task;
  /** Sum of every planned period's target (the task's whole plan, in its unit). */
  planTotal: number;
  /** Cumulative % of the plan done by each sample day; null before the task starts. */
  actual: (number | null)[];
  /** Cumulative % of the plan scheduled by each sample day; null before the task starts. */
  planned: (number | null)[];
}

export interface ProjectChart {
  days: DayKey[];
  tasks: TaskProgressSeries[];
  /** Mean of the tasks' `actual` that have started by each day. */
  averageActual: (number | null)[];
  /** Mean of the tasks' `planned` that have started by each day. */
  averageTarget: (number | null)[];
}

/**
 * Sample days from [from, to]: every day up to [maxPoints], else evenly
 * spaced, always including both ends.
 */
export function sampleDays(from: DayKey, to: DayKey, maxPoints = 30): DayKey[] {
  if (to < from) return [];
  const span = diffDays(from, to);
  if (span + 1 <= maxPoints) {
    return Array.from({ length: span + 1 }, (_, i) => addDays(from, i));
  }
  const step = span / (maxPoints - 1);
  const out: DayKey[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const d = addDays(from, Math.round(i * step));
    if (out[out.length - 1] !== d) out.push(d);
  }
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Per-task cumulative progress, normalised to each task's own plan (so
 * tasks in different units share one 0–100% axis):
 * - actual(d) = Σ over planned periods of min(reported up to d, target) / plan total.
 *   Capping at the period target means over-achieving one period can't
 *   hide a missed one.
 * - planned(d) = Σ targets of periods ended by d, plus the elapsed share of
 *   the period containing d / plan total.
 * Tasks with no plan (no target days before their end) are left out.
 */
export function projectChart(
  project: Project,
  tasks: readonly Task[],
  reports: EvaluateInput['reports'],
  days: readonly DayKey[],
): ProjectChart {
  const series: TaskProgressSeries[] = [];
  for (const task of tasks) {
    const periods = planPeriods(task, project);
    const planTotal = periods.reduce((s, p) => s + p.target.quantity, 0);
    if (!(planTotal > 0)) continue;
    const mine = periods.map(p => ({ p, reports: reportsIn(p, reports) }));
    const actual: (number | null)[] = [];
    const planned: (number | null)[] = [];
    for (const d of days) {
      if (d < task.startDate) {
        actual.push(null);
        planned.push(null);
        continue;
      }
      let done = 0;
      let plan = 0;
      for (const { p, reports: rs } of mine) {
        if (p.start > d) break;
        const upTo = rs
          .filter(r => r.day <= d)
          .reduce((s, r) => s + r.quantity, 0);
        done += Math.min(upTo, p.target.quantity);
        const elapsed = Math.min(p.days, diffDays(p.start, d) + 1);
        plan += p.target.quantity * (elapsed / p.days);
      }
      actual.push(round1((done / planTotal) * 100));
      planned.push(round1((plan / planTotal) * 100));
    }
    series.push({ task, planTotal, actual, planned });
  }
  const mean = (pick: (s: TaskProgressSeries) => (number | null)[]) =>
    days.map((_, i) => {
      const values = series
        .map(s => pick(s)[i])
        .filter((v): v is number => v !== null);
      return values.length
        ? round1(values.reduce((a, b) => a + b, 0) / values.length)
        : null;
    });
  return {
    days: [...days],
    tasks: series,
    averageActual: mean(s => s.actual),
    averageTarget: mean(s => s.planned),
  };
}

/** The chart window for a project: its start to today, within its deadline. */
export function projectWindow(
  project: Project,
  tasks: readonly Task[],
  today: DayKey,
): { from: DayKey; to: DayKey } {
  const firstTask = tasks.reduce<DayKey | null>(
    (min, t) => (min === null || t.startDate < min ? t.startDate : min),
    null,
  );
  const from = firstTask
    ? minDay(project.startDate, firstTask)
    : project.startDate;
  const to = maxDay(from, minDay(today, project.deadline));
  return { from, to };
}

// ── Project task counts ───────────────────────────────────────────────

export type TaskStanding = 'completed' | 'overdue' | 'pending';

/**
 * - completed: marked completed.
 * - overdue: past its end date, or an ended period is short of target with
 *   no reason given yet.
 * - pending: everything else that is still running.
 */
export function taskStanding(task: Task, inp: EvaluateInput): TaskStanding {
  if (task.status === 'completed') return 'completed';
  if (task.endDate && task.endDate < inp.today) return 'overdue';
  const yesterday = addDays(inp.today, -1);
  const owes = periodsBetween(task, task.startDate, yesterday).some(
    p => evaluate(task, p, inp).status === 'report_required',
  );
  return owes ? 'overdue' : 'pending';
}

export function standingCounts(
  tasks: readonly Task[],
  inp: EvaluateInput,
): Record<TaskStanding, number> {
  const out: Record<TaskStanding, number> = {
    completed: 0,
    overdue: 0,
    pending: 0,
  };
  for (const t of tasks) out[taskStanding(t, inp)]++;
  return out;
}
