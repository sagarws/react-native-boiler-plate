import type {
  DayKey,
  LongTermCategory,
  LongTermNode,
  LongTermProject,
  LongTermStatus,
  StatusKind,
} from '../types';
import { childrenMap, type ChildrenMap } from './hierarchy';

/**
 * Hierarchy-aware progress, computed bottom-up in one pass so every node
 * contributes exactly once to its own parent (no double counting).
 *
 * Leaf value:
 * - completed → 100, pending → 0, running or a custom ("other") status →
 *   its recorded progress %, ignored → excluded (null).
 * Parent value:
 * - its own status completed → 100; ignored → excluded.
 * - otherwise the mean of its eligible children's values — equal weight by
 *   default, or by each child's `weight` in the weighted model. Excluded
 *   children (ignored, or optional when the project says so) don't count as
 *   incomplete. A parent with no eligible children falls back to its own
 *   leaf value.
 */

export interface NodeProgress {
  /** 0–100, or null when the node doesn't count (ignored). */
  value: number | null;
  /** Descendants marked completed. */
  completed: number;
  /** Descendants that count (not ignored). */
  active: number;
  /** Descendants past their target date and not completed/ignored. */
  overdue: number;
  /** All descendants. */
  total: number;
  /** This node itself is past its target date and not done. */
  isOverdue: boolean;
}

export interface Lookups {
  statusKind: (id: string) => StatusKind;
  categoryKind: (id: string) => LongTermCategory['kind'];
}

export function lookups(
  statuses: readonly LongTermStatus[],
  categories: readonly LongTermCategory[],
): Lookups {
  const s = new Map(statuses.map(x => [x.id, x.kind]));
  const c = new Map(categories.map(x => [x.id, x.kind]));
  return {
    statusKind: id => s.get(id) ?? 'pending',
    categoryKind: id => c.get(id) ?? 'other',
  };
}

const clamp = (n: number) =>
  Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;

function leafValue(n: LongTermNode, kind: StatusKind): number | null {
  switch (kind) {
    case 'ignored':
      return null;
    case 'completed':
      return 100;
    case 'pending':
      return 0;
    default:
      return clamp(n.progress);
  }
}

export const isNodeOverdue = (
  n: LongTermNode,
  kind: StatusKind,
  today: DayKey,
): boolean =>
  n.targetDate < today && kind !== 'completed' && kind !== 'ignored';

/** Progress for every node of one project (root included). */
export function projectNodeProgress(
  project: Pick<
    LongTermProject,
    'progressModel' | 'optionalMode' | 'rootNodeId'
  >,
  nodes: readonly LongTermNode[],
  look: Lookups,
  today: DayKey,
  map: ChildrenMap = childrenMap(nodes),
): Map<string, NodeProgress> {
  const out = new Map<string, NodeProgress>();
  // Post-order without recursion (deep trees can't overflow the stack).
  const order: LongTermNode[] = [];
  const root = nodes.find(n => n.id === project.rootNodeId);
  if (!root) return out;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    order.push(n);
    for (const k of map.get(n.id) ?? []) stack.push(k);
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const n = order[i];
    const kind = look.statusKind(n.statusId);
    const kids = map.get(n.id) ?? [];
    let completed = 0;
    let active = 0;
    let overdue = 0;
    let total = 0;
    let sum = 0;
    let weights = 0;
    for (const k of kids) {
      const p = out.get(k.id)!;
      const kKind = look.statusKind(k.statusId);
      completed += p.completed + (kKind === 'completed' ? 1 : 0);
      active += p.active + (kKind === 'ignored' ? 0 : 1);
      overdue += p.overdue + (p.isOverdue ? 1 : 0);
      total += p.total + 1;
      const eligible =
        p.value !== null &&
        !(
          project.optionalMode === 'exclude' &&
          look.categoryKind(k.categoryId) === 'optional'
        );
      if (eligible) {
        const w =
          project.progressModel === 'weighted' ? Math.max(0, k.weight) : 1;
        sum += p.value! * w;
        weights += w;
      }
    }
    let value: number | null;
    if (kind === 'ignored') value = null;
    else if (kind === 'completed') value = 100;
    else if (weights > 0) value = Math.round((sum / weights) * 10) / 10;
    else value = leafValue(n, kind);
    out.set(n.id, {
      value,
      completed,
      active,
      overdue,
      total,
      isOverdue: isNodeOverdue(n, kind, today),
    });
  }
  return out;
}
