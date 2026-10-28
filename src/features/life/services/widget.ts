import type { WidgetLogEntry } from '@/features/capture';
import { logger } from '@/shared/utils';
import { categoryColor } from '@/theme';
import { lifeStore } from '../store/life.store';
import type { DayKey, LifeData } from '../types';
import { addDays } from '../utils/dates';
import { liveTasks } from './analytics';
import { currentState, periodsBetween } from './periods';
import { friendly } from './targetHelp';

/** Translated widget texts. `%s` = a date, `%d` = a count (filled natively). */
export interface WidgetLabels {
  title: string;
  empty: string;
  setup: string;
  met: string;
  endsToday: string;
  endsOn: string;
  stale: string;
  more: string;
}

/** Tasks sent to the widget (it shows the first 4 and "+N more"). */
const MAX_TASKS = 20;
/** Upcoming days covered, so the widget rolls over to new periods offline. */
const LOOKAHEAD_DAYS = 14;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

/**
 * The widget snapshot: active (not paused) tasks with a period today, ordered
 * like the Today tab (focus, priority, not-yet-met first). Each task carries
 * its current and upcoming periods; only the current one has progress.
 */
export function buildWidgetSnapshot(
  data: LifeData,
  today: DayKey,
  labels: WidgetLabels,
): string {
  const input = { reports: data.reports, reviews: data.reviews, today };
  const tasks = liveTasks(data)
    .filter(task => task.status === 'active')
    .map(task => ({ task, state: currentState(task, input) }))
    .filter(r => r.state && r.state.status === 'active')
    .sort((a, b) => {
      const fa = a.task.focusDay === today ? 0 : 1;
      const fb = b.task.focusDay === today ? 0 : 1;
      return (
        fa - fb ||
        PRIORITY_ORDER[a.task.priority] - PRIORITY_ORDER[b.task.priority] ||
        Number(a.state!.met) - Number(b.state!.met)
      );
    })
    .slice(0, MAX_TASKS)
    .map(({ task, state }) => ({
      id: task.id,
      name: task.name,
      unit: task.unit,
      color: categoryColor(task.color),
      step: friendly(state!.target.quantity / 4) || state!.target.quantity,
      periods: periodsBetween(
        task,
        state!.start,
        addDays(today, LOOKAHEAD_DAYS),
      ).map(p => ({
        s: p.start,
        e: p.end,
        t: p.target.quantity,
        c: p.start === state!.start ? state!.completed : 0,
      })),
    }));
  return JSON.stringify({ v: 1, labels, tasks });
}

/**
 * Imports quick logs from the widget: taps on the same task and day are
 * summed into one progress entry (so rapid taps aren't rejected as
 * duplicates). Returns how many entries were saved.
 */
export function importWidgetLogs(
  entries: readonly WidgetLogEntry[],
  today: DayKey,
): number {
  const groups = new Map<
    string,
    { task: string; day: DayKey; q: number; at: number }
  >();
  for (const e of entries) {
    const key = `${e.task}|${e.day}`;
    const g = groups.get(key);
    if (g) {
      g.q += e.q;
      g.at = Math.max(g.at, e.at);
    } else groups.set(key, { task: e.task, day: e.day, q: e.q, at: e.at });
  }
  let saved = 0;
  for (const g of groups.values()) {
    const result = lifeStore.addReport(
      { taskId: g.task, day: g.day, quantity: Math.round(g.q * 10) / 10 },
      today,
      new Date(g.at),
    );
    if (result.ok) saved++;
    else logger.warn('widget log not imported', result.error);
  }
  return saved;
}
