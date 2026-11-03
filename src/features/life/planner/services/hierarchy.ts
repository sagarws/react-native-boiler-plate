import type { LongTermNode } from '../types';

/**
 * Tree operations on a project's nodes. Pure: every function returns new
 * arrays/objects and never mutates its input, so the store can snapshot
 * state for undo and only commit valid trees.
 */

export type ChildrenMap = Map<string | null, LongTermNode[]>;

const byOrder = (a: LongTermNode, b: LongTermNode) =>
  a.sortOrder - b.sortOrder || (a.createdAt < b.createdAt ? -1 : 1);

/** parentId → children (sorted by sortOrder). Key null = roots. */
export function childrenMap(nodes: readonly LongTermNode[]): ChildrenMap {
  const map: ChildrenMap = new Map();
  for (const n of nodes) {
    const list = map.get(n.parentId);
    if (list) list.push(n);
    else map.set(n.parentId, [n]);
  }
  for (const list of map.values()) list.sort(byOrder);
  return map;
}

/** Every descendant of [id] (not including it), depth-first. */
export function descendantIds(map: ChildrenMap, id: string): string[] {
  const out: string[] = [];
  const stack = [...(map.get(id) ?? [])].reverse();
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n.id);
    const kids = map.get(n.id);
    if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

/** Ancestors of [id], nearest first (excluding it). Stops on a cycle. */
export function ancestorIds(
  byId: ReadonlyMap<string, LongTermNode>,
  id: string,
): string[] {
  const out: string[] = [];
  const seen = new Set([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parentId ?? null;
  }
  return out;
}

export const indexById = (nodes: readonly LongTermNode[]) =>
  new Map(nodes.map(n => [n.id, n]));

/**
 * Whether [nodeId] may be moved under [newParentId]: not onto itself, not
 * into its own branch (that would make a cycle), and within one project.
 */
export function canMove(
  nodes: readonly LongTermNode[],
  nodeId: string,
  newParentId: string,
): boolean {
  if (nodeId === newParentId) return false;
  const byId = indexById(nodes);
  const node = byId.get(nodeId);
  const parent = byId.get(newParentId);
  if (!node || !parent || node.parentId === null) return false;
  if (node.projectId !== parent.projectId) return false;
  return !ancestorIds(byId, newParentId).includes(nodeId);
}

/** Next sortOrder for a new last child of [parentId]. */
export function nextSortOrder(map: ChildrenMap, parentId: string): number {
  const kids = map.get(parentId) ?? [];
  return kids.length ? kids[kids.length - 1].sortOrder + 1 : 0;
}

/**
 * Copies [nodeId] and its whole branch under [parentId] with new ids;
 * relationships inside the branch are preserved. Returns the copies, root
 * of the copy first.
 */
export function duplicateBranch(
  nodes: readonly LongTermNode[],
  nodeId: string,
  parentId: string,
  newId: () => string,
  now: string,
  nameSuffix = '',
): LongTermNode[] {
  const map = childrenMap(nodes);
  const source = nodes.find(n => n.id === nodeId);
  if (!source) return [];
  const ids = new Map<string, string>();
  const order = [nodeId, ...descendantIds(map, nodeId)];
  for (const id of order) ids.set(id, newId());
  const byId = indexById(nodes);
  return order.map(id => {
    const n = byId.get(id)!;
    const isTop = id === nodeId;
    return {
      ...n,
      id: ids.get(id)!,
      parentId: isTop ? parentId : ids.get(n.parentId!)!,
      name: isTop && nameSuffix ? `${n.name}${nameSuffix}` : n.name,
      sortOrder: isTop ? nextSortOrder(map, parentId) : n.sortOrder,
      offsets: isTop ? {} : n.offsets,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Removes [nodeId]. `branch` also removes all descendants; `reparent` moves
 * its children up to its parent (after its siblings). The root can't be
 * removed this way.
 */
export function removeNode(
  nodes: readonly LongTermNode[],
  nodeId: string,
  mode: 'branch' | 'reparent',
  now: string,
): { nodes: LongTermNode[]; removed: string[] } {
  const target = nodes.find(n => n.id === nodeId);
  if (!target || target.parentId === null)
    return { nodes: [...nodes], removed: [] };
  const map = childrenMap(nodes);
  if (mode === 'branch') {
    const removed = new Set([nodeId, ...descendantIds(map, nodeId)]);
    return {
      nodes: nodes.filter(n => !removed.has(n.id)),
      removed: [...removed],
    };
  }
  let order = nextSortOrder(map, target.parentId);
  const kids = new Set((map.get(nodeId) ?? []).map(k => k.id));
  return {
    nodes: nodes
      .filter(n => n.id !== nodeId)
      .map(n =>
        kids.has(n.id)
          ? {
              ...n,
              parentId: target.parentId,
              sortOrder: order++,
              updatedAt: now,
            }
          : n,
      ),
    removed: [nodeId],
  };
}

/**
 * Makes a project's nodes a valid tree: exactly one root ([rootId]), every
 * other node's parent exists in the same project, no cycles. Broken links
 * (orphans, cycles, extra roots) are re-attached to the root rather than
 * dropped, so no data is lost. Returns the repaired list and how many nodes
 * were re-attached.
 */
export function repairTree(
  nodes: readonly LongTermNode[],
  rootId: string,
): { nodes: LongTermNode[]; repaired: number } {
  const byId = indexById(nodes);
  let repaired = 0;
  const fixed = nodes.map(n => {
    if (n.id === rootId) {
      if (n.parentId === null) return n;
      repaired++;
      return { ...n, parentId: null };
    }
    const parent = n.parentId ? byId.get(n.parentId) : undefined;
    const broken =
      !parent ||
      parent.projectId !== n.projectId ||
      // A cycle: walking up never reaches the root.
      !ancestorIds(byId, n.id).includes(rootId);
    if (!broken) return n;
    repaired++;
    return { ...n, parentId: rootId };
  });
  return { nodes: fixed, repaired };
}

/** Depth of every node from its root (root = 0). */
export function depths(map: ChildrenMap, rootId: string): Map<string, number> {
  const out = new Map<string, number>([[rootId, 0]]);
  const stack: string[] = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    const d = out.get(id)!;
    for (const k of map.get(id) ?? []) {
      out.set(k.id, d + 1);
      stack.push(k.id);
    }
  }
  return out;
}
