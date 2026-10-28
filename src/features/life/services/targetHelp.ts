import type { FrequencyType } from '../types';

/**
 * "Help me set a target" — local, rule-based suggestions (no network). Each
 * suggestion explains itself; nothing is applied without the user choosing.
 */

export interface TargetHelpInput {
  frequency: FrequencyType;
  intervalDays: number;
  /** Total amount the user wants to reach (in the task's unit), optional. */
  goalTotal?: number;
  /** Days until the desired deadline, optional. */
  daysToDeadline?: number;
  /** What the user manages today, per period, optional. */
  baseline?: number;
  /** Minutes available per day — only used when the unit is time. */
  minutesPerDay?: number;
  unitIsMinutes?: boolean;
  unitIsHours?: boolean;
  /** Past periods of this task (if editing): completed amounts and their targets. */
  history?: { completed: number; target: number }[];
}

export type SuggestionBasis =
  | 'deadline'
  | 'baseline'
  | 'time'
  | 'history_ok'
  | 'history_lower';

export interface TargetSuggestion {
  quantity: number;
  basis: SuggestionBasis;
  /** Numbers the explanation refers to. */
  detail: Record<string, number>;
}

const days = (f: FrequencyType, n: number) =>
  f === 'daily' ? 1 : f === 'weekly' ? 7 : Math.max(1, Math.round(n));

/** Rounds to a friendly number (whole numbers; tenths below 10). */
export function friendly(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n < 10) return Math.max(0.5, Math.round(n * 2) / 2);
  if (n < 100) return Math.round(n);
  return Math.round(n / 5) * 5;
}

export function suggestTargets(input: TargetHelpInput): TargetSuggestion[] {
  const perPeriodDays = days(input.frequency, input.intervalDays);
  const out: TargetSuggestion[] = [];

  if (
    input.goalTotal &&
    input.goalTotal > 0 &&
    input.daysToDeadline &&
    input.daysToDeadline > 0
  ) {
    const periods = Math.max(
      1,
      Math.floor(input.daysToDeadline / perPeriodDays),
    );
    const q = friendly(input.goalTotal / periods);
    if (q > 0)
      out.push({
        quantity: q,
        basis: 'deadline',
        detail: { periods, goal: input.goalTotal },
      });
  }

  if (input.baseline && input.baseline > 0) {
    // Start a little above what is already manageable.
    out.push({
      quantity: friendly(input.baseline * 1.1),
      basis: 'baseline',
      detail: { baseline: input.baseline },
    });
  }

  if (
    input.minutesPerDay &&
    input.minutesPerDay > 0 &&
    (input.unitIsMinutes || input.unitIsHours)
  ) {
    // Plan to use ~80% of the time available, leaving slack for bad days.
    const minutes = input.minutesPerDay * perPeriodDays * 0.8;
    const q = friendly(input.unitIsHours ? minutes / 60 : minutes);
    if (q > 0)
      out.push({
        quantity: q,
        basis: 'time',
        detail: { minutesPerDay: input.minutesPerDay },
      });
  }

  const history = (input.history ?? []).filter(h => h.target > 0);
  if (history.length >= 3) {
    const met = history.filter(h => h.completed >= h.target).length;
    const hitRate = Math.round((met / history.length) * 100);
    const avg = history.reduce((s, h) => s + h.completed, 0) / history.length;
    const current = history[history.length - 1].target;
    if (hitRate >= 70) {
      out.push({
        quantity: friendly(current),
        basis: 'history_ok',
        detail: { hitRate, periods: history.length },
      });
    } else {
      // Aim slightly above the observed average — achievable, still a stretch.
      out.push({
        quantity: friendly(Math.max(avg * 1.1, current * 0.5)),
        basis: 'history_lower',
        detail: {
          hitRate,
          periods: history.length,
          average: Math.round(avg * 10) / 10,
        },
      });
    }
  }

  // De-duplicate equal quantities, keep order.
  const seen = new Set<number>();
  return out.filter(
    s => s.quantity > 0 && !seen.has(s.quantity) && seen.add(s.quantity),
  );
}
