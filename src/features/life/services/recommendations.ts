import type {
  DayKey,
  FrequencyType,
  LifeData,
  Priority,
  Recommendation,
  RecommendationSet,
  Task,
} from '../types';
import { INCOMPLETE_REASONS } from '../types';
import { addDays } from '../utils/dates';
import { liveTasks, projectProgress, reasonBreakdown } from './analytics';
import {
  evaluate,
  periodsBetween,
  streak,
  targetOn,
  type PeriodState,
} from './periods';

/**
 * AI recommendations: what is sent (only the user's own Manage Life records,
 * trimmed), how the reply is validated (unknown fields/tasks dropped, target
 * proposals checked), and rule-based insights for when there is too little
 * history to ask Gemini honestly.
 */

/** Ended, judged periods needed before asking Gemini. */
export const MIN_HISTORY = 5;
const LOOKBACK_DAYS = 42;
const MAX_PERIODS_PER_TASK = 20;
const MAX_PAYLOAD = 22_000;
const NOTE_CHARS = 160;

const judged = (s: PeriodState) =>
  s.status === 'achieved' ||
  s.status === 'missed' ||
  s.status === 'report_required';

function recentStates(
  data: LifeData,
  task: Task,
  today: DayKey,
): PeriodState[] {
  const inp = { reports: data.reports, reviews: data.reviews, today };
  return periodsBetween(
    task,
    addDays(today, -LOOKBACK_DAYS),
    addDays(today, -1),
  )
    .map(p => evaluate(task, p, inp))
    .filter(s => s.status !== 'untracked');
}

/** How many ended periods with an outcome exist (in the lookback window). */
export function historySize(
  data: LifeData,
  today: DayKey,
  projectId?: string,
): number {
  return liveTasks(data, projectId).reduce(
    (n, t) => n + recentStates(data, t, today).filter(judged).length,
    0,
  );
}

/** The JSON summary sent to Gemini (no ids, keys or unrelated app data). */
export function buildPayload(
  data: LifeData,
  today: DayKey,
  projectId?: string,
): string {
  const tasks = liveTasks(data, projectId);
  const projects = data.projects.filter(
    p => p.status === 'active' && (!projectId || p.id === projectId),
  );
  const build = (perTask: number) =>
    JSON.stringify({
      today,
      weekStartsOn: 'Monday',
      projects: projects.map(p => {
        const prog = projectProgress(data, p, today);
        return {
          name: p.name,
          objective: (p.objective || p.description).slice(0, 200),
          start: p.startDate,
          deadline: p.deadline,
          daysLeft: prog.daysLeft,
          targetsMetPercent: prog.targetRate,
        };
      }),
      tasks: tasks.map(t => {
        const target = targetOn(t, today) ?? t.targets[t.targets.length - 1];
        const states = recentStates(data, t, today).slice(-perTask);
        return {
          taskName: t.name,
          project: data.projects.find(p => p.id === t.projectId)?.name ?? '',
          unit: t.unit,
          currentTarget: {
            quantity: target.quantity,
            frequency: target.frequency,
            intervalDays: target.intervalDays,
          },
          paused: t.status === 'paused',
          currentStreak: streak(t, {
            reports: data.reports,
            reviews: data.reviews,
            today,
          }),
          periods: states.map(s => ({
            start: s.start,
            end: s.end,
            target: s.target.quantity,
            completed: s.completed,
            status: s.status,
            ...(s.review
              ? {
                  reason: s.review.reason,
                  reasonNote: s.review.note.slice(0, NOTE_CHARS),
                }
              : {}),
          })),
          notes: data.reports
            .filter(
              r =>
                r.taskId === t.id &&
                r.note &&
                r.day >= addDays(today, -LOOKBACK_DAYS),
            )
            .slice(-8)
            .map(r => ({ day: r.day, note: r.note.slice(0, NOTE_CHARS) })),
        };
      }),
      reasonCounts: reasonBreakdown(
        data,
        addDays(today, -LOOKBACK_DAYS),
        today,
        projectId,
      ),
    });
  // Shrink the per-task history until it fits.
  for (let n = MAX_PERIODS_PER_TASK; n >= 3; n -= 4) {
    const json = build(n);
    if (json.length <= MAX_PAYLOAD) return json;
  }
  return build(3).slice(0, MAX_PAYLOAD);
}

const CATEGORIES: readonly Recommendation['category'][] = [
  'summary',
  'blocker',
  'realism',
  'improvement',
  'adjustment',
  'next_step',
  'project',
  'positive',
];
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];
const FREQUENCIES: readonly FrequencyType[] = ['daily', 'weekly', 'interval'];

const text = (v: unknown, max: number) =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

/**
 * Validates Gemini's reply. Returns null when it isn't usable at all.
 * Recommendations about unknown tasks keep their text but lose any target
 * proposal; invalid proposals are dropped.
 */
export function parseRecommendations(
  raw: string,
  data: LifeData,
  dataVersion: number,
  at: Date = new Date(),
): RecommendationSet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const r = parsed as { summary?: unknown; recommendations?: unknown };
  if (!r || typeof r !== 'object' || !Array.isArray(r.recommendations))
    return null;
  const byName = new Map(data.tasks.map(t => [t.name.trim().toLowerCase(), t]));
  const items: Recommendation[] = [];
  for (const entry of r.recommendations.slice(0, 12)) {
    const e = (entry ?? {}) as Record<string, unknown>;
    const title = text(e.title, 120);
    const action = text(e.action, 400);
    if (
      !title ||
      !CATEGORIES.includes(e.category as Recommendation['category'])
    )
      continue;
    const task = byName.get(text(e.taskName, 120).toLowerCase()) ?? null;
    items.push({
      category: e.category as Recommendation['category'],
      title,
      explanation: text(e.explanation, 800),
      evidence: text(e.evidence, 400),
      action,
      priority: PRIORITIES.includes(e.priority as Priority)
        ? (e.priority as Priority)
        : 'medium',
      taskId: task?.id ?? null,
      proposedTarget: task ? proposal(e.proposedTarget, task) : null,
    });
  }
  const summary = text(r.summary, 800);
  if (!summary && !items.length) return null;
  return { generatedAt: at.toISOString(), dataVersion, summary, items };
}

function proposal(
  value: unknown,
  task: Task,
): Recommendation['proposedTarget'] {
  const p = (value ?? null) as Record<string, unknown> | null;
  if (!p) return null;
  const quantity = typeof p.quantity === 'number' ? p.quantity : NaN;
  const frequency = p.frequency as FrequencyType;
  if (
    !(quantity > 0 && quantity <= 10_000_000) ||
    !FREQUENCIES.includes(frequency)
  )
    return null;
  const intervalDays =
    frequency === 'daily'
      ? 1
      : frequency === 'weekly'
      ? 7
      : Math.round(typeof p.intervalDays === 'number' ? p.intervalDays : NaN);
  if (!(intervalDays >= 1 && intervalDays <= 365)) return null;
  const current = task.targets[task.targets.length - 1];
  if (
    current.quantity === quantity &&
    current.frequency === frequency &&
    current.intervalDays === intervalDays
  )
    return null;
  return { quantity, frequency, intervalDays };
}

export type LocalInsightKind =
  | 'realism'
  | 'blocker'
  | 'pending'
  | 'positive'
  | 'start'
  | 'early';

export interface LocalInsight {
  kind: LocalInsightKind;
  taskId: string | null;
  /** Values for the translated message. */
  values: Record<string, string | number>;
}

/** Rule-based insights from the same data (no AI, no invented facts). */
export function localInsights(
  data: LifeData,
  today: DayKey,
  projectId?: string,
): LocalInsight[] {
  const out: LocalInsight[] = [];
  const tasks = liveTasks(data, projectId);
  if (!tasks.length) return [{ kind: 'start', taskId: null, values: {} }];
  const inp = { reports: data.reports, reviews: data.reviews, today };
  for (const t of tasks) {
    const states = recentStates(data, t, today).filter(judged);
    if (states.length >= 3) {
      const met = states.filter(s => s.status === 'achieved').length;
      const pct = Math.round((met / states.length) * 100);
      if (pct < 50)
        out.push({
          kind: 'realism',
          taskId: t.id,
          values: { task: t.name, met, total: states.length, pct },
        });
    }
    const s = streak(t, inp);
    if (s >= 3)
      out.push({
        kind: 'positive',
        taskId: t.id,
        values: { task: t.name, streak: s },
      });
  }
  const top = reasonBreakdown(
    data,
    addDays(today, -LOOKBACK_DAYS),
    today,
    projectId,
  )[0];
  if (top && top.count >= 2 && INCOMPLETE_REASONS.includes(top.reason)) {
    out.push({
      kind: 'blocker',
      taskId: null,
      values: { reason: top.reason, count: top.count },
    });
  }
  const pending = tasks.reduce(
    (n, t) =>
      n +
      recentStates(data, t, today).filter(x => x.status === 'report_required')
        .length,
    0,
  );
  if (pending > 0)
    out.push({ kind: 'pending', taskId: null, values: { count: pending } });
  // Tasks exist but no period has ended yet: say what to expect.
  if (!out.length) out.push({ kind: 'early', taskId: null, values: {} });
  return out;
}
