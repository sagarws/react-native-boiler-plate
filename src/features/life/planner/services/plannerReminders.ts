import NativeLifeBackup from '@/specs/NativeLifeBackup';
import { logger } from '@/shared/utils';
import type { PlannerData, StatusKind } from '../types';
import { formatDate } from './plannerFormat';

export interface PlannerReminder {
  key: string;
  at: number;
  title: string;
  body: string;
  link: string;
}

/** "YYYY-MM-DDTHH:mm" (local) → epoch ms, or NaN. */
export function reminderTime(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}

/**
 * Reminders for nodes that have one set, are not done, and belong to a
 * plan that isn't archived. Each opens its plan's map focused on the node.
 */
export function plannerReminders(
  data: PlannerData,
  now: number,
  text: (
    name: string,
    project: string,
    target: string,
  ) => { title: string; body: string },
): PlannerReminder[] {
  const kind = new Map<string, StatusKind>(
    data.statuses.map(s => [s.id, s.kind]),
  );
  const projects = new Map(
    data.projects.filter(p => p.status !== 'archived').map(p => [p.id, p]),
  );
  return data.nodes
    .filter(n => n.reminderAt && projects.has(n.projectId))
    .filter(n => {
      const k = kind.get(n.statusId) ?? 'pending';
      return k !== 'completed' && k !== 'ignored';
    })
    .map(n => {
      const at = reminderTime(n.reminderAt!);
      const project = projects.get(n.projectId)!;
      return {
        key: `plan:${n.id}`,
        at,
        ...text(n.name, project.name, formatDate(n.targetDate)),
        link: `rnboilerplate://planner/${encodeURIComponent(
          n.projectId,
        )}/${encodeURIComponent(n.id)}`,
      };
    })
    .filter(r => Number.isFinite(r.at) && r.at > now);
}

/** Replaces the scheduled planner reminders (Follow Up's are untouched). */
export async function syncPlannerReminders(
  list: PlannerReminder[],
): Promise<number> {
  if (!NativeLifeBackup) return 0;
  try {
    return await NativeLifeBackup.syncPlannerReminders(JSON.stringify(list));
  } catch (e) {
    logger.warn('planner reminder sync failed', (e as Error)?.message);
    return 0;
  }
}
