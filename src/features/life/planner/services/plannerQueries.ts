import { addDays, diffDays } from '@/shared/utils/dayKey';
import { createLocalId } from '@/shared/utils/id';
import type {
  DayKey,
  LongTermNode,
  LongTermProject,
  PlannerData,
  StatusKind,
} from '../types';
import { ancestorIds, childrenMap, indexById } from './hierarchy';
import { lookups, projectNodeProgress } from './plannerProgress';

/**
 * Read-side helpers for the planner: dashboard numbers, milestone lists,
 * search and starter templates. Pure; everything derives from stored data.
 */

const kindOf = (data: PlannerData) => {
  const m = new Map(data.statuses.map(s => [s.id, s.kind]));
  return (id: string): StatusKind => m.get(id) ?? 'pending';
};

export const isDone = (k: StatusKind) => k === 'completed' || k === 'ignored';

/** Root progress of a project (0–100), or null when nothing counts. */
export function projectProgressValue(
  data: PlannerData,
  project: LongTermProject,
  today: DayKey,
): number | null {
  const nodes = data.nodes.filter(n => n.projectId === project.id);
  const map = projectNodeProgress(
    project,
    nodes,
    lookups(data.statuses, data.categories),
    today,
  );
  return map.get(project.rootNodeId)?.value ?? null;
}

// ── Milestones ───────────────────────────────────────────────────────

export type MilestoneFilter =
  | 'upcoming'
  | 'thisYear'
  | 'next5'
  | 'next10'
  | 'overdue'
  | 'completed'
  | 'custom';

export interface MilestoneRow {
  node: LongTermNode;
  project: LongTermProject;
  kind: StatusKind;
  overdue: boolean;
}

/** Milestones of non-archived projects matching [filter], soonest first. */
export function milestones(
  data: PlannerData,
  filter: MilestoneFilter,
  today: DayKey,
  range?: { from: DayKey; to: DayKey },
): MilestoneRow[] {
  const kind = kindOf(data);
  const projects = new Map(
    data.projects.filter(p => p.status !== 'archived').map(p => [p.id, p]),
  );
  const year = Number(today.slice(0, 4));
  const rows = data.nodes
    .filter(n => n.kind === 'milestone' && projects.has(n.projectId))
    .map(n => {
      const k = kind(n.statusId);
      return {
        node: n,
        project: projects.get(n.projectId)!,
        kind: k,
        overdue: n.targetDate < today && !isDone(k),
      };
    });
  const within = (to: DayKey) => (r: MilestoneRow) =>
    !isDone(r.kind) && r.node.targetDate >= today && r.node.targetDate <= to;
  const pick: Record<MilestoneFilter, (r: MilestoneRow) => boolean> = {
    upcoming: r => !isDone(r.kind) && r.node.targetDate >= today,
    thisYear: r => r.node.targetDate.startsWith(String(year)),
    next5: within(`${year + 5}-12-31`),
    next10: within(`${year + 10}-12-31`),
    overdue: r => r.overdue,
    completed: r => r.kind === 'completed',
    custom: r =>
      !!range &&
      r.node.targetDate >= range.from &&
      r.node.targetDate <= range.to,
  };
  return rows
    .filter(pick[filter])
    .sort((a, b) =>
      a.node.targetDate < b.node.targetDate
        ? -1
        : a.node.targetDate > b.node.targetDate
        ? 1
        : 0,
    );
}

/** The next not-done milestone of a project (or null). */
export function nextMilestone(
  data: PlannerData,
  projectId: string,
  today: DayKey,
): LongTermNode | null {
  const kind = kindOf(data);
  return (
    data.nodes
      .filter(
        n =>
          n.projectId === projectId &&
          n.kind === 'milestone' &&
          !isDone(kind(n.statusId)) &&
          n.targetDate >= today,
      )
      .sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1))[0] ?? null
  );
}

// ── Dashboard ────────────────────────────────────────────────────────

export interface PlannerSummary {
  total: number;
  active: number;
  completed: number;
  /** Not-done milestones due in the next 12 months. */
  upcomingMilestones: number;
  overdueMilestones: number;
  /** Mean root progress of active projects; null when none. */
  overall: number | null;
  recent: LongTermProject[];
}

export function plannerSummary(
  data: PlannerData,
  today: DayKey,
): PlannerSummary {
  const active = data.projects.filter(p => p.status === 'active');
  const values = active
    .map(p => projectProgressValue(data, p, today))
    .filter((v): v is number => v !== null);
  const yearAhead = addDays(today, 365);
  const all = milestones(data, 'upcoming', today);
  return {
    total: data.projects.filter(p => p.status !== 'archived').length,
    active: active.length,
    completed: data.projects.filter(p => p.status === 'completed').length,
    upcomingMilestones: all.filter(r => r.node.targetDate <= yearAhead).length,
    overdueMilestones: milestones(data, 'overdue', today).length,
    overall: values.length
      ? Math.round(values.reduce((a, b) => a + b, 0) / values.length)
      : null,
    recent: [...data.projects]
      .filter(p => p.status !== 'archived')
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, 3),
  };
}

export type ProjectSort = 'updated' | 'name' | 'target' | 'progress';

export function sortProjects(
  data: PlannerData,
  list: LongTermProject[],
  sort: ProjectSort,
  today: DayKey,
): LongTermProject[] {
  const copy = [...list];
  if (sort === 'name') return copy.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === 'target')
    return copy.sort((a, b) => (a.targetDate < b.targetDate ? -1 : 1));
  if (sort === 'progress') {
    const v = new Map(
      copy.map(p => [p.id, projectProgressValue(data, p, today) ?? -1]),
    );
    return copy.sort((a, b) => v.get(b.id)! - v.get(a.id)!);
  }
  return copy.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

// ── Search ───────────────────────────────────────────────────────────

export interface SearchHit {
  node: LongTermNode;
  project: LongTermProject;
  /** Names from the root down to the node's parent. */
  path: string[];
}

export function searchNodes(
  data: PlannerData,
  query: string,
  limit = 50,
): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const projects = new Map(data.projects.map(p => [p.id, p]));
  const byId = indexById(data.nodes);
  const hits: SearchHit[] = [];
  for (const n of data.nodes) {
    if (hits.length >= limit) break;
    if (
      !(
        n.name.toLowerCase().includes(q) ||
        n.description.toLowerCase().includes(q)
      )
    )
      continue;
    const project = projects.get(n.projectId);
    if (!project) continue;
    hits.push({
      node: n,
      project,
      path: ancestorIds(byId, n.id)
        .reverse()
        .map(id => byId.get(id)?.name ?? ''),
    });
  }
  return hits;
}

/** Nodes a node may move under: same project, not itself or its branch. */
export function moveTargets(
  nodes: readonly LongTermNode[],
  nodeId: string,
): LongTermNode[] {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return [];
  const mine = nodes.filter(n => n.projectId === node.projectId);
  const map = childrenMap(mine);
  const banned = new Set([nodeId]);
  const stack = [nodeId];
  while (stack.length) {
    for (const k of map.get(stack.pop()!) ?? []) {
      banned.add(k.id);
      stack.push(k.id);
    }
  }
  return mine.filter(n => !banned.has(n.id) && n.id !== node.parentId);
}

// ── Templates ────────────────────────────────────────────────────────

export const TEMPLATE_KEYS = [
  'vision',
  'career',
  'business',
  'finance',
  'health',
] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

interface TemplateNode {
  /** i18n key under planner.tpl. */
  key: string;
  /** Share of the project's span: [start, end] in 0–1. */
  span: [number, number];
  milestone?: boolean;
  category?: 'mandatory' | 'optional';
  children?: TemplateNode[];
}

const T = (
  key: string,
  span: [number, number],
  children?: TemplateNode[],
  extra: Partial<TemplateNode> = {},
): TemplateNode => ({
  key,
  span,
  children,
  ...extra,
});

export const TEMPLATES: Record<TemplateKey, TemplateNode[]> = {
  vision: [
    T(
      'buildBusiness',
      [0, 0.7],
      [
        T(
          'establishCompany',
          [0, 0.3],
          [T('buildTeam', [0.05, 0.3]), T('acquireClients', [0.1, 0.4])],
        ),
        T('expandIntl', [0.5, 0.7], undefined, { milestone: true }),
      ],
    ),
    T(
      'financialIndependence',
      [0, 1],
      [
        T('emergencyFund', [0, 0.15]),
        T('investments', [0.1, 0.9]),
        T('passiveIncome', [0.3, 1]),
      ],
    ),
    T(
      'personalDevelopment',
      [0, 1],
      [
        T('improveHealth', [0, 1]),
        T('learnSkills', [0, 0.8], undefined, { category: 'optional' }),
      ],
    ),
  ],
  career: [
    T(
      'masterSkills',
      [0, 0.4],
      [
        T('coreSkills', [0, 0.3]),
        T('certification', [0.2, 0.4], undefined, { milestone: true }),
      ],
    ),
    T(
      'gainExperience',
      [0.2, 0.8],
      [
        T('leadProject', [0.2, 0.5]),
        T('mentorOthers', [0.4, 0.8], undefined, { category: 'optional' }),
      ],
    ),
    T('nextRole', [0.6, 1], undefined, { milestone: true }),
  ],
  business: [
    T(
      'establishCompany',
      [0, 0.3],
      [T('buildTeam', [0.05, 0.3]), T('acquireClients', [0.1, 0.4])],
    ),
    T('growRevenue', [0.2, 0.8]),
    T('expandIntl', [0.7, 1], undefined, { milestone: true }),
  ],
  finance: [
    T('emergencyFund', [0, 0.15]),
    T('investments', [0.1, 0.9]),
    T('passiveIncome', [0.3, 1]),
    T('financialGoal', [0.9, 1], undefined, { milestone: true }),
  ],
  health: [
    T(
      'fitness',
      [0, 1],
      [T('marathon', [0.3, 0.5], undefined, { milestone: true })],
    ),
    T('nutrition', [0, 1]),
    T('sleepRecovery', [0, 1], undefined, { category: 'optional' }),
  ],
};

/**
 * Template nodes for a new project, dated as shares of its span. Names
 * come from [name] (the translated label); the result is ordinary,
 * editable nodes.
 */
export function templateNodes(
  key: TemplateKey,
  rootId: string,
  projectId: string,
  start: DayKey,
  target: DayKey,
  name: (key: string) => string,
  now: string = new Date().toISOString(),
): LongTermNode[] {
  const span = Math.max(1, diffDays(start, target));
  const at = (f: number) => addDays(start, Math.round(span * f));
  const out: LongTermNode[] = [];
  const stack: { node: TemplateNode; parentId: string; order: number }[] =
    TEMPLATES[key]
      .map((node, order) => ({ node, parentId: rootId, order }))
      .reverse();
  while (stack.length) {
    const { node, parentId, order } = stack.pop()!;
    const id = createLocalId();
    out.push({
      id,
      projectId,
      parentId,
      kind: node.milestone ? 'milestone' : 'node',
      name: name(node.key),
      description: '',
      icon: node.milestone ? 'mapPin' : '',
      imageUri: '',
      color: '',
      statusId: 'pending',
      categoryId: node.category ?? 'mandatory',
      startDate: at(node.span[0]),
      targetDate: at(node.span[1]),
      dateEstimated: true,
      rangeConfirmed: false,
      actualCompletedAt: null,
      progress: 0,
      weight: 1,
      priority: 'medium',
      effort: '',
      notes: '',
      sortOrder: order,
      collapsed: false,
      offsets: {},
      link: null,
      attachments: [],
      reminderAt: null,
      createdAt: now,
      updatedAt: now,
    });
    const kids = node.children ?? [];
    // Reverse push so children are created in their listed order.
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ node: kids[i], parentId: id, order: i });
    }
  }
  return out;
}
