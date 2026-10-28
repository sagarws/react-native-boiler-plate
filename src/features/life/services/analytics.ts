import type {
  DayKey,
  IncompleteReason,
  LifeData,
  Project,
  Task,
} from '../types';
import { addDays, diffDays, maxDay, minDay } from '../utils/dates';
import {
  currentState,
  evaluate,
  pendingReviews,
  periodsBetween,
  streak,
  type EvaluateInput,
  type PeriodState,
} from './periods';

/**
 * Dashboard and chart numbers, all derived from persisted records via the
 * period service. Quantities are only ever summed within one task (one
 * unit) — never across units. Each metric is defined where it's computed.
 */

const isLive = (t: Task) => t.status === 'active' || t.status === 'paused';

export function liveTasks(data: LifeData, projectId?: string): Task[] {
  const activeProjects = new Set(
    data.projects.filter(p => p.status === 'active').map(p => p.id),
  );
  return data.tasks.filter(
    t =>
      isLive(t) &&
      activeProjects.has(t.projectId) &&
      (!projectId || t.projectId === projectId),
  );
}

const input = (data: LifeData, today: DayKey): EvaluateInput => ({
  reports: data.reports,
  reviews: data.reviews,
  today,
});

export interface DashboardSummary {
  activeProjects: number;
  activeTasks: number;
  /** Tasks whose current period has its target met / tasks with a current period (not paused). */
  doneToday: number;
  dueToday: number;
  /** doneToday / dueToday, 0–100; null when nothing is due. */
  todayPercent: number | null;
  /** Ended periods still waiting for a reason. */
  reportsRequired: number;
  /** Active projects past their deadline. */
  overdueProjects: number;
  /** Periods that ended in the last 7 days: met / (met + missed + needing a reason); null if none. */
  weeklyRate: number | null;
  /** Longest current streak of consecutive met periods across tasks. */
  bestStreak: number;
}

export function dashboardSummary(
  data: LifeData,
  today: DayKey,
): DashboardSummary {
  const tasks = liveTasks(data);
  const inp = input(data, today);
  const current = tasks
    .map(t => currentState(t, inp))
    .filter((s): s is PeriodState => !!s && s.status === 'active');
  const doneToday = current.filter(s => s.met).length;
  const recent = endedStates(
    tasks,
    inp,
    addDays(today, -7),
    addDays(today, -1),
  );
  return {
    activeProjects: data.projects.filter(p => p.status === 'active').length,
    activeTasks: tasks.length,
    doneToday,
    dueToday: current.length,
    todayPercent: current.length
      ? Math.round((doneToday / current.length) * 100)
      : null,
    reportsRequired: allPendingReviews(data, today).length,
    overdueProjects: data.projects.filter(
      p => p.status === 'active' && p.deadline < today,
    ).length,
    weeklyRate: rate(recent),
    bestStreak: tasks.reduce((best, t) => Math.max(best, streak(t, inp)), 0),
  };
}

/** Met / (met + missed + needing a reason), as 0–100; null when nothing ended. */
export function rate(states: readonly PeriodState[]): number | null {
  const judged = states.filter(
    s =>
      s.status === 'achieved' ||
      s.status === 'missed' ||
      s.status === 'report_required',
  );
  if (!judged.length) return null;
  return Math.round(
    (judged.filter(s => s.status === 'achieved').length / judged.length) * 100,
  );
}

/** Ended periods (any status) that ended within [from, to]. */
export function endedStates(
  tasks: readonly Task[],
  inp: EvaluateInput,
  from: DayKey,
  to: DayKey,
): PeriodState[] {
  return tasks.flatMap(t =>
    periodsBetween(t, addDays(from, -400), to)
      .filter(p => p.end >= from && p.end <= to && p.end < inp.today)
      .map(p => evaluate(t, p, inp)),
  );
}

export function allPendingReviews(
  data: LifeData,
  today: DayKey,
): (PeriodState & { task: Task })[] {
  const inp = input(data, today);
  return liveTasks(data)
    .flatMap(t => pendingReviews(t, inp).map(s => ({ ...s, task: t })))
    .sort((a, b) => (a.end < b.end ? -1 : 1));
}

export interface ProjectProgress {
  /** Days elapsed / total days of the project, 0–100. */
  timePercent: number;
  daysLeft: number;
  overdue: boolean;
  /** Ended periods across the project's tasks: met and judged. */
  metPeriods: number;
  judgedPeriods: number;
  /** metPeriods / judgedPeriods, 0–100; null when none ended. */
  targetRate: number | null;
  /** Current periods met / current periods (today). */
  todayDone: number;
  todayDue: number;
  taskCount: number;
}

export function projectProgress(
  data: LifeData,
  project: Project,
  today: DayKey,
): ProjectProgress {
  const tasks = data.tasks.filter(
    t => t.projectId === project.id && t.status !== 'archived',
  );
  const inp = input(data, today);
  const total = Math.max(1, diffDays(project.startDate, project.deadline) + 1);
  const elapsed = Math.max(
    0,
    Math.min(total, diffDays(project.startDate, today) + 1),
  );
  const ended = tasks.flatMap(t =>
    periodsBetween(
      t,
      t.startDate,
      minDay(addDays(today, -1), project.deadline),
    ).map(p => evaluate(t, p, inp)),
  );
  const judged = ended.filter(
    s =>
      s.status === 'achieved' ||
      s.status === 'missed' ||
      s.status === 'report_required',
  );
  const current = tasks
    .map(t => currentState(t, inp))
    .filter((s): s is PeriodState => !!s && s.status === 'active');
  return {
    timePercent: Math.round((elapsed / total) * 100),
    daysLeft: diffDays(today, project.deadline),
    overdue: project.status === 'active' && project.deadline < today,
    metPeriods: judged.filter(s => s.status === 'achieved').length,
    judgedPeriods: judged.length,
    targetRate: rate(judged),
    todayDone: current.filter(s => s.met).length,
    todayDue: current.length,
    taskCount: tasks.length,
  };
}

export interface DayPoint {
  day: DayKey;
  /** Periods ending this day: met / judged, 0–100; null if none ended. */
  rate: number | null;
  judged: number;
  met: number;
  /** Progress entries logged that day. */
  entries: number;
}

/** One point per day in [from, to] (for trend bars and the heatmap). */
export function dailyTrend(
  data: LifeData,
  from: DayKey,
  to: DayKey,
  today: DayKey,
  projectId?: string,
  taskId?: string,
): DayPoint[] {
  const tasks = liveTasks(data, projectId).filter(
    t => !taskId || t.id === taskId,
  );
  const ids = new Set(tasks.map(t => t.id));
  const states = endedStates(
    tasks,
    input(data, today),
    from,
    minDay(to, addDays(today, -1)),
  );
  const points: DayPoint[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const ending = states.filter(
      s => s.end === d && s.status !== 'paused' && s.status !== 'untracked',
    );
    const met = ending.filter(s => s.status === 'achieved').length;
    points.push({
      day: d,
      rate: ending.length ? Math.round((met / ending.length) * 100) : null,
      judged: ending.length,
      met,
      entries: data.reports.filter(r => r.day === d && ids.has(r.taskId))
        .length,
    });
  }
  return points;
}

export interface WeekPoint {
  weekStart: DayKey;
  rate: number | null;
  judged: number;
}

/** Completion rate per Monday-week, for the last [weeks] weeks. */
export function weeklyTrend(
  data: LifeData,
  weeks: number,
  today: DayKey,
  projectId?: string,
): WeekPoint[] {
  const tasks = liveTasks(data, projectId);
  const inp = input(data, today);
  const thisMonday = addDays(
    today,
    -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7),
  );
  const out: WeekPoint[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const start = addDays(thisMonday, -7 * i);
    const end = addDays(start, 6);
    const states = endedStates(tasks, inp, start, end);
    out.push({
      weekStart: start,
      rate: rate(states),
      judged: states.filter(
        s => s.status !== 'paused' && s.status !== 'untracked',
      ).length,
    });
  }
  return out;
}

export interface ReasonCount {
  reason: IncompleteReason;
  count: number;
}

/** Incomplete reasons for periods ending in [from, to], most common first. */
export function reasonBreakdown(
  data: LifeData,
  from: DayKey,
  to: DayKey,
  projectId?: string,
): ReasonCount[] {
  const taskIds = new Set(
    data.tasks
      .filter(t => !projectId || t.projectId === projectId)
      .map(t => t.id),
  );
  const counts = new Map<IncompleteReason, number>();
  for (const r of data.reviews) {
    if (!taskIds.has(r.taskId) || r.periodEnd < from || r.periodEnd > to)
      continue;
    counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export interface TaskQuantity {
  task: Task;
  unit: string;
  /** Sum of entries in range — in this task's own unit only. */
  actual: number;
  /** Sum of targets of periods ending in range (same unit). */
  target: number;
}

/** Actual vs target per task (one unit each; never combined across tasks). */
export function quantitiesByTask(
  data: LifeData,
  from: DayKey,
  to: DayKey,
  today: DayKey,
  projectId?: string,
): TaskQuantity[] {
  const inp = input(data, today);
  return liveTasks(data, projectId).map(task => {
    const periods = periodsBetween(task, maxDay(from, task.startDate), to).map(
      p => evaluate(task, p, inp),
    );
    return {
      task,
      unit: task.unit,
      actual: data.reports
        .filter(r => r.taskId === task.id && r.day >= from && r.day <= to)
        .reduce((s, r) => s + r.quantity, 0),
      target: periods
        .filter(s => s.status !== 'paused')
        .reduce((s, p) => s + p.target.quantity, 0),
    };
  });
}

export type DayMark =
  | 'none'
  | 'done'
  | 'partial'
  | 'missed'
  | 'pending'
  | 'upcoming';

export interface DayDetail {
  day: DayKey;
  /** Periods (of any length) that include this day. */
  periods: (PeriodState & { task: Task })[];
  mark: DayMark;
}

/**
 * What the calendar shows for a day. A day with no scheduled period is
 * 'none' (no target) — distinct from 'missed'. Weekly / every-N-days periods
 * show their whole period's status on each of their days.
 */
export function dayDetail(
  data: LifeData,
  day: DayKey,
  today: DayKey,
  projectId?: string,
  taskId?: string,
): DayDetail {
  const inp = input(data, today);
  const periods = liveTasks(data, projectId)
    .filter(t => !taskId || t.id === taskId)
    .flatMap(task => {
      const p = periodsBetween(task, day, day)[0];
      return p ? [{ ...evaluate(task, p, inp), task }] : [];
    })
    .filter(s => s.status !== 'untracked' && s.status !== 'paused');
  let mark: DayMark = 'none';
  if (periods.length) {
    if (periods.some(s => s.status === 'report_required')) mark = 'pending';
    else if (periods.some(s => s.status === 'missed')) mark = 'missed';
    else if (periods.every(s => s.met)) mark = 'done';
    else if (periods.some(s => s.completed > 0)) mark = 'partial';
    else
      mark =
        day > today
          ? 'upcoming'
          : periods.every(s => s.status === 'upcoming')
          ? 'upcoming'
          : 'partial';
  }
  return { day, periods, mark };
}
