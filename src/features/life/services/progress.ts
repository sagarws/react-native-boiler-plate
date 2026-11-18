import type { DayKey, LifeData, Project, Task } from '../types';
import { addDays, diffDays, maxDay, minDay } from '../utils/dates';
import {
  evaluate,
  periodContaining,
  periodsBetween,
  type EvaluateInput,
  type PeriodState,
} from './periods';

/**
 * Progress numbers for the task and project detail pages: calendar colour
 * levels, target-vs-actual per period, and the normalised project chart.
 * Everything is derived from persisted targets and reports via the period
 * service.
 *
 * Rules:
 * - A day belongs to the target period containing it, so weekly and
 *   every-N-days targets colour their whole period, never one day at a time.
 * - A day with no target scheduled (before start, after end, paused, before
 *   tracking began, or in the future) is `none`, never "missed".
 * - Different units are never added: each task is normalised against its
 *   own target first (completed / target), then tasks are averaged.
 * - In averages a task counts at most 100%, so one over-achieved task can't
 *   hide another one that's behind.
 */

export type ProgressLevel =
  /** No target scheduled (or not yet due). */
  | 'none'
  /** Target scheduled, nothing reported. */
  | 'noReport'
  /** Under 34%. */
  | 'low'
  /** 34–66%. */
  | 'partial'
  /** 67–99%. */
  | 'high'
  /** Target met or exceeded. */
  | 'full';

export const PROGRESS_LEVELS: readonly ProgressLevel[] = [
  'none',
  'noReport',
  'low',
  'partial',
  'high',
  'full',
];

/** Colour level for a completion ratio (completed / target, unclamped). */
export function levelFor(ratio: number): ProgressLevel {
  if (!Number.isFinite(ratio) || ratio < 0.34) return 'low';
  if (ratio < 0.67) return 'partial';
  if (ratio < 1) return 'high';
  return 'full';
}

/** True when a period state represents a target the user had to work on. */
const scheduled = (s: PeriodState) =>
  s.status !== 'paused' && s.status !== 'untracked' && s.status !== 'upcoming';

export interface TaskDayCell {
  day: DayKey;
  /** The target period containing the day, or null when none is scheduled. */
  state: PeriodState | null;
  level: ProgressLevel;
  /** 0–100+ (unclamped) when there are reports; else null. */
  percent: number | null;
}

/** What the task calendar shows for [day]. */
export function taskDayCell(
  task: Task,
  day: DayKey,
  input: EvaluateInput,
): TaskDayCell {
  const p = periodContaining(task, day);
  if (!p) return { day, state: null, level: 'none', percent: null };
  const state = evaluate(task, p, input);
  if (!scheduled(state) || day > input.today)
    return { day, state, level: 'none', percent: null };
  if (!state.hasReports)
    return { day, state, level: 'noReport', percent: null };
  return {
    day,
    state,
    level: levelFor(state.ratio),
    percent: Math.round(state.ratio * 100),
  };
}

export interface ProjectDayCell {
  day: DayKey;
  /** The scheduled target period of each task on this day. */
  states: (PeriodState & { task: Task })[];
  level: ProgressLevel;
  /** Average completion across scheduled task targets, 0–100; null if none. */
  percent: number | null;
}

/**
 * What the project calendar shows for [day]: the average, across tasks
 * with a target scheduled that day, of each task's completed / target
 * (capped at 100%). An unreported period counts as 0%.
 */
export function projectDayCell(
  tasks: readonly Task[],
  day: DayKey,
  input: EvaluateInput,
): ProjectDayCell {
  if (day > input.today)
    return { day, states: [], level: 'none', percent: null };
  const states = tasks.flatMap(task => {
    const p = periodContaining(task, day);
    if (!p) return [];
    const s = evaluate(task, p, input);
    return scheduled(s) ? [{ ...s, task }] : [];
  });
  if (!states.length) return { day, states, level: 'none', percent: null };
  if (!states.some(s => s.hasReports))
    return { day, states, level: 'noReport', percent: 0 };
  const avg =
    states.reduce((sum, s) => sum + Math.min(1, s.ratio), 0) / states.length;
  return { day, states, level: levelFor(avg), percent: Math.round(avg * 100) };
}

/** Tasks shown on a project's pages (archived ones are hidden there too). */
export const projectTasks = (data: LifeData, projectId: string): Task[] =>
  data.tasks.filter(t => t.projectId === projectId && t.status !== 'archived');

export interface PeriodPage {
  states: PeriodState[];
  /** More periods exist before the first one shown. */
  hasOlder: boolean;
  /** More periods exist after the last one shown (up to today's). */
  hasNewer: boolean;
}

/**
 * Up to [count] periods of [task], ending [offset] pages before the current
 * one (or the last period, for a task that has ended). Upcoming, paused and
 * pre-tracking periods are left out.
 */
export function taskPeriodPage(
  task: Task,
  input: EvaluateInput,
  count: number,
  offset = 0,
): PeriodPage {
  const last = task.endDate ? minDay(task.endDate, input.today) : input.today;
  const all = periodsBetween(task, task.startDate, last)
    .map(p => evaluate(task, p, input))
    .filter(scheduled);
  const end = Math.max(0, all.length - offset * count);
  const start = Math.max(0, end - count);
  return {
    states: all.slice(start, end),
    hasOlder: start > 0,
    hasNewer: end < all.length,
  };
}

export interface TaskStats {
  /** Ended periods with the target met. */
  met: number;
  /** Ended periods short of the target (with or without a reason). */
  missed: number;
  /** Ended unmet periods still waiting for a reason. */
  reasonNeeded: number;
  /** Today's period, when the task is running today. */
  current: PeriodState | null;
  /** The first period starting after today, for a "next target" line. */
  next: PeriodState | null;
  /** Progress against the whole planned schedule; null without an end. */
  overall: ScheduleProgress | null;
}

export function taskStats(
  task: Task,
  input: EvaluateInput,
  scheduleEnd: DayKey | null,
): TaskStats {
  const ended = periodsBetween(task, task.startDate, addDays(input.today, -1))
    .filter(p => p.end < input.today)
    .map(p => evaluate(task, p, input));
  const p = periodContaining(task, input.today);
  const current = p ? evaluate(task, p, input) : null;
  const after = current ? addDays(current.end, 1) : input.today;
  const nextP = periodContaining(task, maxDay(after, task.startDate));
  return {
    met: ended.filter(s => s.status === 'achieved').length,
    missed: ended.filter(
      s => s.status === 'missed' || s.status === 'report_required',
    ).length,
    reasonNeeded: ended.filter(s => s.status === 'report_required').length,
    current: current && current.status !== 'paused' ? current : null,
    next:
      nextP && nextP.start > input.today ? evaluate(task, nextP, input) : null,
    overall: scheduleEnd
      ? scheduleProgress(task, input, scheduleEnd, input.today)
      : null,
  };
}

export interface ScheduleProgress {
  /** Planned quantity over the whole schedule (task's unit). */
  plannedTotal: number;
  /** Reported so far within the schedule (task's unit). */
  actual: number;
  /** actual / plannedTotal × 100, unclamped. */
  actualPercent: number;
  /** Planned to date / plannedTotal × 100. */
  targetPercent: number;
}

/**
 * Where [task] stands on [day] against its whole schedule (start → [end]):
 * the planned target accrues evenly through each period (a 7-day period
 * adds 1/7 of its target per day), and actual is every report up to [day].
 * Paused periods plan nothing. Null when nothing is planned.
 */
export function scheduleProgress(
  task: Task,
  input: EvaluateInput,
  end: DayKey,
  day: DayKey,
): ScheduleProgress | null {
  const plan = plannedPeriods(task, input, end);
  return progressOn(task, plan, input, end, day);
}

interface PlannedPeriod {
  start: DayKey;
  end: DayKey;
  quantity: number;
}

function plannedPeriods(
  task: Task,
  input: EvaluateInput,
  end: DayKey,
): PlannedPeriod[] {
  const last = task.endDate ? minDay(task.endDate, end) : end;
  return periodsBetween(task, task.startDate, last)
    .map(p => ({ p, s: evaluate(task, p, input) }))
    .filter(({ s }) => s.status !== 'paused')
    .map(({ p }) => ({
      start: p.start,
      end: minDay(p.end, last),
      quantity: p.target.quantity,
    }));
}

function progressOn(
  task: Task,
  plan: readonly PlannedPeriod[],
  input: EvaluateInput,
  end: DayKey,
  day: DayKey,
): ScheduleProgress | null {
  const plannedTotal = plan.reduce((s, p) => s + p.quantity, 0);
  if (plannedTotal <= 0) return null;
  let planned = 0;
  for (const p of plan) {
    if (p.start > day) break;
    const length = diffDays(p.start, p.end) + 1;
    const elapsed = Math.min(length, diffDays(p.start, day) + 1);
    planned += (p.quantity * elapsed) / length;
  }
  const last = task.endDate ? minDay(task.endDate, end) : end;
  const actual = input.reports
    .filter(
      r =>
        r.taskId === task.id &&
        r.day >= task.startDate &&
        r.day <= minDay(day, last),
    )
    .reduce((s, r) => s + r.quantity, 0);
  return {
    plannedTotal,
    actual,
    actualPercent: (actual / plannedTotal) * 100,
    targetPercent: (planned / plannedTotal) * 100,
  };
}

/**
 * Up to [max] evenly spaced dates from [start] to [end], always including
 * both ends and (when inside the range) [today].
 */
export function chartDates(
  start: DayKey,
  end: DayKey,
  today: DayKey,
  max = 10,
): DayKey[] {
  if (end < start) return [];
  const span = diffDays(start, end);
  const n = Math.max(1, Math.min(max, span + 1));
  const out =
    n === 1
      ? [start]
      : Array.from({ length: n }, (_, i) =>
          addDays(start, Math.round((span * i) / (n - 1))),
        );
  if (today > start && today < end && !out.includes(today)) {
    let closest = 1;
    for (let i = 1; i < out.length - 1; i++)
      if (
        Math.abs(diffDays(out[i], today)) <
        Math.abs(diffDays(out[closest], today))
      )
        closest = i;
    if (out.length > 2) out[closest] = today;
    else out.splice(1, 0, today);
  }
  return [...new Set(out)].sort();
}

export interface TaskLine {
  task: Task;
  /** % of the task's planned total reported by each date; null after today or before the task starts. */
  actual: (number | null)[];
  /** % planned by each date; null before the task starts. */
  target: (number | null)[];
}

export interface ProjectChart {
  dates: DayKey[];
  tasks: TaskLine[];
  /** Average of the applicable tasks' actual % (each capped at 100). */
  avgActual: (number | null)[];
  /** Average of the applicable tasks' planned %. */
  avgTarget: (number | null)[];
  /** Tasks left out: nothing planned (e.g. fully paused). */
  skipped: Task[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Per date, the mean of the series that have a value there (null if none). */
export function averageAt(
  dates: readonly DayKey[],
  series: readonly (readonly (number | null)[])[],
  map: (v: number) => number = v => v,
): (number | null)[] {
  return dates.map((_, i) => {
    const present = series
      .map(s => s[i])
      .filter((v): v is number => v !== null && v !== undefined)
      .map(map);
    return present.length
      ? round1(present.reduce((s, v) => s + v, 0) / present.length)
      : null;
  });
}

/**
 * The project chart, normalised per task (see `scheduleProgress`). Each
 * task's schedule runs from its start to its own end date, or the project
 * deadline when it has none. A task applies to a date once it has started.
 */
export function projectChart(
  project: Project,
  tasks: readonly Task[],
  input: EvaluateInput,
  max = 10,
): ProjectChart {
  const dates = chartDates(
    project.startDate,
    project.deadline,
    input.today,
    max,
  );
  const lines: TaskLine[] = [];
  const skipped: Task[] = [];
  for (const task of tasks) {
    const end = task.endDate ?? project.deadline;
    const plan = plannedPeriods(task, input, end);
    if (!plan.length || plan.every(p => p.quantity <= 0)) {
      skipped.push(task);
      continue;
    }
    const points = dates.map(d =>
      d < task.startDate ? null : progressOn(task, plan, input, end, d),
    );
    lines.push({
      task,
      target: points.map(p => (p ? round1(p.targetPercent) : null)),
      actual: points.map((p, i) =>
        p && dates[i] <= input.today ? round1(p.actualPercent) : null,
      ),
    });
  }
  return {
    dates,
    tasks: lines,
    avgActual: averageAt(
      dates,
      lines.map(l => l.actual),
      v => Math.min(100, v),
    ),
    avgTarget: averageAt(
      dates,
      lines.map(l => l.target),
    ),
    skipped,
  };
}

/**
 * Overall project progress on [day] (default today): the average actual and
 * planned % across tasks that have started, as in `projectChart`. Null when
 * no task has a planned schedule yet.
 */
export function projectOverall(
  project: Project,
  tasks: readonly Task[],
  input: EvaluateInput,
  day: DayKey = input.today,
): { actual: number; target: number } | null {
  const points = tasks
    .filter(t => t.startDate <= day)
    .map(t => scheduleProgress(t, input, t.endDate ?? project.deadline, day))
    .filter((p): p is ScheduleProgress => p !== null);
  if (!points.length) return null;
  const [actual] = averageAt(
    [day],
    points.map(p => [p.actualPercent]),
    v => Math.min(100, v),
  );
  const [target] = averageAt(
    [day],
    points.map(p => [p.targetPercent]),
  );
  return { actual: actual ?? 0, target: target ?? 0 };
}

export type CountKind = 'completed' | 'pending' | 'overdue';

/**
 * Task counts for a project: completed = marked completed; overdue = not
 * completed and past its end date (or the project deadline when it has
 * none); pending = everything else.
 */
export function taskCounts(
  tasks: readonly Task[],
  project: Project,
  today: DayKey,
): Record<CountKind, number> {
  const out: Record<CountKind, number> = {
    completed: 0,
    pending: 0,
    overdue: 0,
  };
  for (const t of tasks) {
    if (t.status === 'completed') out.completed++;
    else if ((t.endDate ?? project.deadline) < today) out.overdue++;
    else out.pending++;
  }
  return out;
}

/** [day] moved into [from, to] (e.g. the month a calendar opens on). */
export function clampDay(day: DayKey, from: DayKey, to: DayKey): DayKey {
  return maxDay(from, minDay(day, to));
}

/** Hides or shows one chart line. */
export function toggleLine(
  hidden: ReadonlySet<string>,
  id: string,
): Set<string> {
  const next = new Set(hidden);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Lines hidden at first: task lines beyond the first [max], to keep the chart readable. */
export function initialHidden(
  taskIds: readonly string[],
  max = 5,
): Set<string> {
  return new Set(taskIds.slice(max));
}
