import { createLocalId } from '@/shared/utils/id';
import { isDayKey } from '@/shared/utils/dayKey';
import { storage, StorageKeys } from '@/store/mmkv';
import {
  childrenMap,
  canMove,
  descendantIds,
  duplicateBranch,
  nextSortOrder,
  removeNode,
  repairTree,
} from '../services/hierarchy';
import {
  MAP_STYLES,
  type Attachment,
  type DayKey,
  type LongTermCategory,
  type LongTermNode,
  type LongTermNote,
  type LongTermProject,
  type LongTermStatus,
  type MapStyle,
  type NodeKind,
  type NodeLink,
  type OptionalMode,
  type PlannerData,
  type PlannerSettings,
  type PlannerView,
  type PlanStatus,
  type Priority,
  type ProgressModel,
  type StatusKind,
} from '../types';

/**
 * Long-Term Planner persistence (MMKV), following the Manage Life store:
 * records are validated on load and on restore, every change goes through
 * `commit`, and listeners re-render. Node edits on the canvas are undoable
 * per project (snapshots of that project's nodes).
 */

export const PLANNER_SCHEMA_VERSION = 1;
export const MAX_NAME = 120;
export const MAX_TEXT = 2000;
const UNDO_LIMIT = 50;

const KEYS = {
  meta: StorageKeys.PlannerMeta,
  projects: StorageKeys.PlannerProjects,
  nodes: StorageKeys.PlannerNodes,
  statuses: StorageKeys.PlannerStatuses,
  categories: StorageKeys.PlannerCategories,
  notes: StorageKeys.PlannerNotes,
  settings: StorageKeys.PlannerSettings,
} as const;

export const DEFAULT_STATUSES: LongTermStatus[] = [
  {
    id: 'pending',
    name: '',
    color: 'amber',
    kind: 'pending',
    isSystem: true,
    isActive: true,
  },
  {
    id: 'running',
    name: '',
    color: 'blue',
    kind: 'running',
    isSystem: true,
    isActive: true,
  },
  {
    id: 'completed',
    name: '',
    color: 'emerald',
    kind: 'completed',
    isSystem: true,
    isActive: true,
  },
  {
    id: 'ignored',
    name: '',
    color: 'slate',
    kind: 'ignored',
    isSystem: true,
    isActive: true,
  },
];

export const DEFAULT_CATEGORIES: LongTermCategory[] = [
  {
    id: 'mandatory',
    name: '',
    color: 'rose',
    kind: 'mandatory',
    isSystem: true,
    isActive: true,
  },
  {
    id: 'optional',
    name: '',
    color: 'teal',
    kind: 'optional',
    isSystem: true,
    isActive: true,
  },
];

export type PlannerError =
  | 'name_required'
  | 'dates_invalid'
  | 'dates_reversed'
  | 'outside_parent'
  | 'not_found'
  | 'is_root'
  | 'invalid_move'
  | 'custom_name_required';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: PlannerError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: PlannerError): Result<T> => ({ ok: false, error });

// ── Validation on load / restore ─────────────────────────────────────

type R = Record<string, unknown>;
const str = (v: unknown, max = MAX_TEXT) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? v : d;
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? v
    : new Date(0).toISOString();
const day = (v: unknown, d: DayKey) => (isDayKey(v) ? v : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];
const STATUS_KINDS: readonly StatusKind[] = [
  'pending',
  'running',
  'completed',
  'ignored',
  'other',
];

export function cleanProject(r: R): LongTermProject | null {
  if (
    typeof r.id !== 'string' ||
    !str(r.name) ||
    typeof r.rootNodeId !== 'string'
  )
    return null;
  const start = day(r.startDate, '2000-01-01');
  return {
    id: r.id,
    name: str(r.name, MAX_NAME),
    description: str(r.description),
    vision: str(r.vision),
    successCriteria: str(r.successCriteria),
    category: str(r.category, MAX_NAME),
    priority: oneOf(r.priority, PRIORITIES, 'medium'),
    icon: str(r.icon, 40) || 'compass',
    imageUri: str(r.imageUri, 1000),
    coverUri: str(r.coverUri, 1000),
    color: str(r.color, 20) || 'violet',
    startDate: start,
    targetDate: day(r.targetDate, start),
    targetEstimated: r.targetEstimated === true,
    deadlineHistory: (Array.isArray(r.deadlineHistory) ? r.deadlineHistory : [])
      .map(x => x as R)
      .filter(x => x && isDayKey(x.from) && isDayKey(x.to))
      .map(x => ({
        from: x.from as DayKey,
        to: x.to as DayKey,
        at: iso(x.at),
      })),
    status: oneOf<PlanStatus>(
      r.status,
      ['active', 'completed', 'archived'],
      'active',
    ),
    preferredStyle: oneOf<MapStyle>(r.preferredStyle, MAP_STYLES, 'tree'),
    progressModel: oneOf<ProgressModel>(
      r.progressModel,
      ['equal', 'weighted'],
      'equal',
    ),
    optionalMode: oneOf<OptionalMode>(
      r.optionalMode,
      ['count', 'exclude'],
      'count',
    ),
    rootNodeId: r.rootNodeId,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function cleanOffsets(v: unknown): LongTermNode['offsets'] {
  const out: LongTermNode['offsets'] = {};
  if (!v || typeof v !== 'object') return out;
  for (const s of MAP_STYLES) {
    const o = (v as R)[s] as R | undefined;
    if (o && Number.isFinite(o.x) && Number.isFinite(o.y)) {
      out[s] = { x: o.x as number, y: o.y as number };
    }
  }
  return out;
}

export function cleanNode(r: R): LongTermNode | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.projectId !== 'string' ||
    !(r.parentId === null || typeof r.parentId === 'string') ||
    !str(r.name)
  )
    return null;
  const start = day(r.startDate, '2000-01-01');
  const link = r.link as R | null | undefined;
  return {
    id: r.id,
    projectId: r.projectId,
    parentId: r.parentId as string | null,
    kind: oneOf<NodeKind>(r.kind, ['node', 'milestone'], 'node'),
    name: str(r.name, MAX_NAME),
    description: str(r.description),
    icon: str(r.icon, 40),
    imageUri: str(r.imageUri, 1000),
    color: str(r.color, 20),
    statusId: str(r.statusId, 60) || 'pending',
    categoryId: str(r.categoryId, 60) || 'mandatory',
    startDate: start,
    targetDate: day(r.targetDate, start),
    dateEstimated: r.dateEstimated === true,
    rangeConfirmed: r.rangeConfirmed === true,
    actualCompletedAt: isDayKey(r.actualCompletedAt)
      ? r.actualCompletedAt
      : null,
    progress: Math.max(0, Math.min(100, num(r.progress, 0))),
    weight: Math.max(0, num(r.weight, 1)),
    priority: oneOf(r.priority, PRIORITIES, 'medium'),
    effort: str(r.effort, 80),
    notes: str(r.notes),
    sortOrder: num(r.sortOrder, 0),
    collapsed: r.collapsed === true,
    offsets: cleanOffsets(r.offsets),
    link:
      link &&
      (link.type === 'project' || link.type === 'task') &&
      typeof link.id === 'string'
        ? { type: link.type, id: link.id }
        : null,
    attachments: (Array.isArray(r.attachments) ? r.attachments : [])
      .map(a => a as R)
      .filter(a => a && typeof a.uri === 'string' && a.uri)
      .map(a => ({
        uri: str(a.uri, 1000),
        name: str(a.name, 200) || 'file',
        mime: str(a.mime, 100),
      })),
    reminderAt:
      typeof r.reminderAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(r.reminderAt)
        ? r.reminderAt
        : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

export function cleanStatus(r: R): LongTermStatus | null {
  if (typeof r.id !== 'string' || !r.id) return null;
  const system = DEFAULT_STATUSES.find(s => s.id === r.id);
  if (system) return { ...system, color: str(r.color, 20) || system.color };
  if (!str(r.name)) return null;
  return {
    id: r.id,
    name: str(r.name, 40),
    color: str(r.color, 20) || 'violet',
    kind: oneOf(r.kind, STATUS_KINDS, 'other'),
    isSystem: false,
    isActive: r.isActive !== false,
  };
}

export function cleanCategory(r: R): LongTermCategory | null {
  if (typeof r.id !== 'string' || !r.id) return null;
  const system = DEFAULT_CATEGORIES.find(s => s.id === r.id);
  if (system) return { ...system, color: str(r.color, 20) || system.color };
  if (!str(r.name)) return null;
  return {
    id: r.id,
    name: str(r.name, 40),
    color: str(r.color, 20) || 'violet',
    kind: 'other',
    isSystem: false,
    isActive: r.isActive !== false,
  };
}

export function cleanNote(r: R): LongTermNote | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.nodeId !== 'string' ||
    !str(r.content)
  )
    return null;
  return {
    id: r.id,
    nodeId: r.nodeId,
    content: str(r.content),
    type: r.type === 'progress' ? 'progress' : 'note',
    progress: Number.isFinite(r.progress)
      ? Math.max(0, Math.min(100, r.progress as number))
      : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function cleanSettings(r: unknown): PlannerSettings {
  const views: Record<string, PlannerView> = {};
  const v = (r as R | null)?.views;
  if (v && typeof v === 'object') {
    for (const [id, x] of Object.entries(v as R)) {
      const o = x as R;
      if (o && [o.scale, o.x, o.y].every(Number.isFinite)) {
        views[id] = {
          scale: Math.max(0.1, Math.min(3, o.scale as number)),
          x: o.x as number,
          y: o.y as number,
        };
      }
    }
  }
  return { views };
}

/** Merges system definitions (always present) with saved custom ones. */
function withSystem<T extends { id: string }>(defaults: T[], saved: T[]): T[] {
  const byId = new Map(saved.map(s => [s.id, s]));
  return [
    ...defaults.map(d => byId.get(d.id) ?? d),
    ...saved.filter(s => !defaults.some(d => d.id === s.id)),
  ];
}

/**
 * Validates a whole dataset: drops invalid records, projects without a
 * root, nodes of unknown projects, notes of unknown nodes; repairs each
 * project's tree (orphans and cycles re-attached to the root).
 */
export function sanitize(raw: {
  projects: unknown[];
  nodes: unknown[];
  statuses: unknown[];
  categories: unknown[];
  notes: unknown[];
  settings?: unknown;
}): Omit<PlannerData, 'version'> & { repaired: number; dropped: number } {
  const clean = <T>(list: unknown[], fn: (r: R) => T | null) =>
    list
      .map(x => (x && typeof x === 'object' ? fn(x as R) : null))
      .filter((x): x is T => x !== null);
  const dedupe = <T extends { id: string }>(list: T[]) => {
    const seen = new Set<string>();
    return list.filter(x => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  };
  const allNodes = dedupe(clean(raw.nodes, cleanNode));
  const projects = dedupe(clean(raw.projects, cleanProject)).filter(p =>
    allNodes.some(n => n.id === p.rootNodeId && n.projectId === p.id),
  );
  let repaired = 0;
  const nodes: LongTermNode[] = [];
  for (const p of projects) {
    const r = repairTree(
      allNodes.filter(n => n.projectId === p.id),
      p.rootNodeId,
    );
    repaired += r.repaired;
    nodes.push(...r.nodes);
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  const rawNotes = clean(raw.notes, cleanNote);
  const notes = dedupe(rawNotes).filter(n => nodeIds.has(n.nodeId));
  const dropped =
    raw.projects.length -
    projects.length +
    (raw.nodes.length - nodes.length) +
    (rawNotes.length - notes.length);
  return {
    projects,
    nodes,
    statuses: withSystem(
      DEFAULT_STATUSES,
      dedupe(clean(raw.statuses, cleanStatus)),
    ),
    categories: withSystem(
      DEFAULT_CATEGORIES,
      dedupe(clean(raw.categories, cleanCategory)),
    ),
    notes,
    settings: cleanSettings(raw.settings),
    repaired,
    dropped: Math.max(0, dropped),
  };
}

function readJson(key: string, fallback: unknown): unknown {
  try {
    const raw = storage.getString(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function load(): PlannerData {
  const meta = readJson(KEYS.meta, {}) as R;
  const asList = (v: unknown) => (Array.isArray(v) ? v : []);
  const s = sanitize({
    projects: asList(readJson(KEYS.projects, [])),
    nodes: asList(readJson(KEYS.nodes, [])),
    statuses: asList(readJson(KEYS.statuses, [])),
    categories: asList(readJson(KEYS.categories, [])),
    notes: asList(readJson(KEYS.notes, [])),
    settings: readJson(KEYS.settings, {}),
  });
  return {
    version: Number.isInteger(meta.version) ? (meta.version as number) : 0,
    projects: s.projects,
    nodes: s.nodes,
    statuses: s.statuses,
    categories: s.categories,
    notes: s.notes,
    settings: s.settings,
  };
}

// ── Store core ───────────────────────────────────────────────────────

type Collection = Exclude<keyof PlannerData, 'version'>;
type Listener = () => void;
const listeners = new Set<Listener>();
let cache: PlannerData | null = null;

function read(): PlannerData {
  if (!cache) cache = load();
  return cache;
}

function commit(next: Omit<PlannerData, 'version'>, changed: Collection[]) {
  const prev = read();
  cache = { ...next, version: prev.version + 1 };
  for (const c of changed) storage.set(KEYS[c], JSON.stringify(cache[c]));
  storage.set(
    KEYS.meta,
    JSON.stringify({
      schemaVersion: PLANNER_SCHEMA_VERSION,
      version: cache.version,
    }),
  );
  listeners.forEach(l => l());
}

const now = () => new Date().toISOString();
const clip = (s: string | undefined, max = MAX_TEXT) =>
  (s ?? '').trim().slice(0, max);

// Undo / redo: snapshots of one project's nodes.
const undoStacks = new Map<string, LongTermNode[][]>();
const redoStacks = new Map<string, LongTermNode[][]>();

function snapshot(projectId: string) {
  const list = undoStacks.get(projectId) ?? [];
  list.push(read().nodes.filter(n => n.projectId === projectId));
  if (list.length > UNDO_LIMIT) list.shift();
  undoStacks.set(projectId, list);
  redoStacks.delete(projectId);
}

function replaceProjectNodes(projectId: string, nodes: LongTermNode[]) {
  const d = read();
  const ids = new Set(nodes.map(n => n.id));
  commit(
    {
      ...d,
      nodes: [...d.nodes.filter(n => n.projectId !== projectId), ...nodes],
      notes: d.notes.filter(n => {
        const owner = d.nodes.find(x => x.id === n.nodeId);
        return !owner || owner.projectId !== projectId || ids.has(n.nodeId);
      }),
    },
    ['nodes', 'notes'],
  );
}

/** Applies a change to one project's nodes, recording it for undo. */
function editNodes(
  projectId: string,
  change: (nodes: LongTermNode[]) => LongTermNode[],
  undoable = true,
) {
  if (undoable) snapshot(projectId);
  const mine = read().nodes.filter(n => n.projectId === projectId);
  replaceProjectNodes(projectId, change(mine));
  touchProject(projectId);
}

function touchProject(projectId: string) {
  const d = read();
  const t = now();
  cache = {
    ...d,
    projects: d.projects.map(p =>
      p.id === projectId ? { ...p, updatedAt: t } : p,
    ),
  };
  storage.set(KEYS.projects, JSON.stringify(cache.projects));
}

// ── Inputs ───────────────────────────────────────────────────────────

export interface ProjectInput {
  name: string;
  startDate: DayKey;
  targetDate: DayKey;
  targetEstimated?: boolean;
  color: string;
  description?: string;
  vision?: string;
  successCriteria?: string;
  category?: string;
  priority?: Priority;
  icon?: string;
  imageUri?: string;
  coverUri?: string;
  progressModel?: ProgressModel;
  optionalMode?: OptionalMode;
}

export interface NodeInput {
  name: string;
  kind?: NodeKind;
  startDate: DayKey;
  targetDate: DayKey;
  statusId: string;
  categoryId: string;
  color?: string;
  description?: string;
  icon?: string;
  imageUri?: string;
  priority?: Priority;
  notes?: string;
  effort?: string;
  progress?: number;
  weight?: number;
  actualCompletedAt?: DayKey | null;
  dateEstimated?: boolean;
  /** Dates outside the parent's range were confirmed on purpose. */
  rangeConfirmed?: boolean;
  /** Allow a target before the start (correcting history). */
  allowReversed?: boolean;
  link?: NodeLink | null;
  attachments?: Attachment[];
  reminderAt?: string | null;
}

export function validateProject(input: ProjectInput): PlannerError | null {
  if (!clip(input.name, MAX_NAME)) return 'name_required';
  if (!isDayKey(input.startDate) || !isDayKey(input.targetDate))
    return 'dates_invalid';
  if (input.targetDate < input.startDate) return 'dates_reversed';
  return null;
}

/**
 * Node checks: name and valid dates; a target before the start needs
 * `allowReversed`; dates outside the parent's range need `rangeConfirmed`
 * (a warning the user can accept — never a silent change).
 */
export function validateNode(
  input: NodeInput,
  parent: LongTermNode | null,
): PlannerError | null {
  if (!clip(input.name, MAX_NAME)) return 'name_required';
  if (!isDayKey(input.startDate) || !isDayKey(input.targetDate))
    return 'dates_invalid';
  if (input.targetDate < input.startDate && !input.allowReversed)
    return 'dates_reversed';
  if (
    parent &&
    !input.rangeConfirmed &&
    (input.startDate < parent.startDate || input.targetDate > parent.targetDate)
  )
    return 'outside_parent';
  return null;
}

function nodeFields(input: NodeInput) {
  return {
    name: clip(input.name, MAX_NAME),
    kind: input.kind ?? 'node',
    startDate: input.startDate,
    targetDate: input.targetDate,
    statusId: input.statusId,
    categoryId: input.categoryId,
    color: input.color ?? '',
    description: clip(input.description),
    icon: input.icon ?? '',
    imageUri: input.imageUri ?? '',
    priority: input.priority ?? 'medium',
    notes: clip(input.notes),
    effort: clip(input.effort, 80),
    progress: Math.max(0, Math.min(100, Math.round(input.progress ?? 0))),
    weight: Math.max(0, input.weight ?? 1),
    actualCompletedAt: input.actualCompletedAt ?? null,
    dateEstimated: input.dateEstimated ?? false,
    rangeConfirmed: input.rangeConfirmed ?? false,
    link: input.link ?? null,
    attachments: input.attachments ?? [],
    reminderAt: input.reminderAt ?? null,
  } satisfies Partial<LongTermNode>;
}

const statusKindOf = (statusId: string): StatusKind =>
  read().statuses.find(s => s.id === statusId)?.kind ?? 'pending';

// ── Public API ───────────────────────────────────────────────────────

export const plannerStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // ── Projects ──
  /** Creates a project and its root node; [seed] adds template children. */
  createProject(
    input: ProjectInput,
    seed?: (rootId: string, projectId: string) => LongTermNode[],
  ): Result<LongTermProject> {
    const err = validateProject(input);
    if (err) return fail(err);
    const d = read();
    const t = now();
    const id = createLocalId();
    const rootId = createLocalId();
    const project: LongTermProject = {
      id,
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      vision: clip(input.vision),
      successCriteria: clip(input.successCriteria),
      category: clip(input.category, MAX_NAME),
      priority: input.priority ?? 'medium',
      icon: input.icon || 'compass',
      imageUri: input.imageUri ?? '',
      coverUri: input.coverUri ?? '',
      color: input.color,
      startDate: input.startDate,
      targetDate: input.targetDate,
      targetEstimated: input.targetEstimated ?? false,
      deadlineHistory: [],
      status: 'active',
      preferredStyle: 'tree',
      progressModel: input.progressModel ?? 'equal',
      optionalMode: input.optionalMode ?? 'count',
      rootNodeId: rootId,
      createdAt: t,
      updatedAt: t,
    };
    const root: LongTermNode = {
      id: rootId,
      projectId: id,
      parentId: null,
      ...nodeFields({
        name: project.name,
        startDate: project.startDate,
        targetDate: project.targetDate,
        statusId: 'running',
        categoryId: 'mandatory',
        color: project.color,
        icon: project.icon,
        imageUri: project.imageUri,
        description: project.vision || project.description,
        dateEstimated: project.targetEstimated,
      }),
      sortOrder: 0,
      collapsed: false,
      offsets: {},
      createdAt: t,
      updatedAt: t,
    };
    const extra = seed ? seed(rootId, id) : [];
    commit(
      {
        ...d,
        projects: [...d.projects, project],
        nodes: [...d.nodes, root, ...extra],
      },
      ['projects', 'nodes'],
    );
    return ok(project);
  },

  /** Updates a project; a changed target date is kept in its history. */
  updateProject(id: string, input: ProjectInput): Result<LongTermProject> {
    const err = validateProject(input);
    if (err) return fail(err);
    const d = read();
    const old = d.projects.find(p => p.id === id);
    if (!old) return fail('not_found');
    const t = now();
    const project: LongTermProject = {
      ...old,
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      vision: clip(input.vision),
      successCriteria: clip(input.successCriteria),
      category: clip(input.category, MAX_NAME),
      priority: input.priority ?? old.priority,
      icon: input.icon || old.icon,
      imageUri: input.imageUri ?? old.imageUri,
      coverUri: input.coverUri ?? old.coverUri,
      color: input.color,
      startDate: input.startDate,
      targetDate: input.targetDate,
      targetEstimated: input.targetEstimated ?? old.targetEstimated,
      progressModel: input.progressModel ?? old.progressModel,
      optionalMode: input.optionalMode ?? old.optionalMode,
      deadlineHistory:
        old.targetDate !== input.targetDate
          ? [
              ...old.deadlineHistory,
              { from: old.targetDate, to: input.targetDate, at: t },
            ]
          : old.deadlineHistory,
      updatedAt: t,
    };
    // The root card mirrors the project; children's dates are never touched.
    const nodes = d.nodes.map(n =>
      n.id === old.rootNodeId
        ? {
            ...n,
            name: project.name,
            startDate: project.startDate,
            targetDate: project.targetDate,
            color: project.color,
            icon: project.icon,
            imageUri: project.imageUri,
            dateEstimated: project.targetEstimated,
            updatedAt: t,
          }
        : n,
    );
    commit(
      {
        ...d,
        projects: d.projects.map(p => (p.id === id ? project : p)),
        nodes,
      },
      ['projects', 'nodes'],
    );
    return ok(project);
  },

  setProjectStatus(id: string, status: PlanStatus): Result<LongTermProject> {
    const d = read();
    const p = d.projects.find(x => x.id === id);
    if (!p) return fail('not_found');
    const next = { ...p, status, updatedAt: now() };
    commit({ ...d, projects: d.projects.map(x => (x.id === id ? next : x)) }, [
      'projects',
    ]);
    return ok(next);
  },

  setPreferredStyle(id: string, style: MapStyle) {
    const d = read();
    commit(
      {
        ...d,
        projects: d.projects.map(p =>
          p.id === id ? { ...p, preferredStyle: style } : p,
        ),
      },
      ['projects'],
    );
  },

  /** Deletes a project with all its nodes and notes. */
  deleteProject(id: string): Result<null> {
    const d = read();
    if (!d.projects.some(p => p.id === id)) return fail('not_found');
    const nodeIds = new Set(
      d.nodes.filter(n => n.projectId === id).map(n => n.id),
    );
    const views = { ...d.settings.views };
    delete views[id];
    commit(
      {
        ...d,
        projects: d.projects.filter(p => p.id !== id),
        nodes: d.nodes.filter(n => n.projectId !== id),
        notes: d.notes.filter(n => !nodeIds.has(n.nodeId)),
        settings: { ...d.settings, views },
      },
      ['projects', 'nodes', 'notes', 'settings'],
    );
    undoStacks.delete(id);
    redoStacks.delete(id);
    return ok(null);
  },

  /** A full copy of a project (new ids everywhere, notes included). */
  duplicateProject(id: string, nameSuffix: string): Result<LongTermProject> {
    const d = read();
    const src = d.projects.find(p => p.id === id);
    if (!src) return fail('not_found');
    const t = now();
    const newId = createLocalId();
    const ids = new Map<string, string>();
    const mine = d.nodes.filter(n => n.projectId === id);
    for (const n of mine) ids.set(n.id, createLocalId());
    const nodes = mine.map(n => ({
      ...n,
      id: ids.get(n.id)!,
      projectId: newId,
      parentId: n.parentId ? ids.get(n.parentId) ?? null : null,
      name: n.id === src.rootNodeId ? `${n.name}${nameSuffix}` : n.name,
      createdAt: t,
      updatedAt: t,
    }));
    const notes = d.notes
      .filter(n => ids.has(n.nodeId))
      .map(n => ({ ...n, id: createLocalId(), nodeId: ids.get(n.nodeId)! }));
    const project: LongTermProject = {
      ...src,
      id: newId,
      name: `${src.name}${nameSuffix}`,
      rootNodeId: ids.get(src.rootNodeId)!,
      status: 'active',
      createdAt: t,
      updatedAt: t,
    };
    commit(
      {
        ...d,
        projects: [...d.projects, project],
        nodes: [...d.nodes, ...nodes],
        notes: [...d.notes, ...notes],
      },
      ['projects', 'nodes', 'notes'],
    );
    return ok(project);
  },

  // ── Nodes ──
  addNode(parentId: string, input: NodeInput): Result<LongTermNode> {
    const d = read();
    const parent = d.nodes.find(n => n.id === parentId);
    if (!parent) return fail('not_found');
    const err = validateNode(input, parent);
    if (err) return fail(err);
    const t = now();
    const node: LongTermNode = {
      id: createLocalId(),
      projectId: parent.projectId,
      parentId,
      ...nodeFields(input),
      sortOrder: nextSortOrder(
        childrenMap(d.nodes.filter(n => n.projectId === parent.projectId)),
        parentId,
      ),
      collapsed: false,
      offsets: {},
      createdAt: t,
      updatedAt: t,
    };
    editNodes(parent.projectId, nodes => [
      ...nodes.map(n =>
        n.id === parentId && n.collapsed ? { ...n, collapsed: false } : n,
      ),
      node,
    ]);
    return ok(node);
  },

  updateNode(id: string, input: NodeInput): Result<LongTermNode> {
    const d = read();
    const old = d.nodes.find(n => n.id === id);
    if (!old) return fail('not_found');
    const parent = old.parentId
      ? d.nodes.find(n => n.id === old.parentId) ?? null
      : null;
    const err = validateNode(input, parent);
    if (err) return fail(err);
    const fields = nodeFields(input);
    const next: LongTermNode = {
      ...old,
      ...fields,
      actualCompletedAt:
        fields.actualCompletedAt ??
        (statusKindOf(fields.statusId) === 'completed' &&
        statusKindOf(old.statusId) !== 'completed'
          ? new Date().toISOString().slice(0, 10)
          : old.actualCompletedAt),
      updatedAt: now(),
    };
    editNodes(old.projectId, nodes => nodes.map(n => (n.id === id ? next : n)));
    return ok(next);
  },

  /** Quick status change (e.g. "Mark completed"); records the completion day. */
  setNodeStatus(
    id: string,
    statusId: string,
    today: DayKey,
  ): Result<LongTermNode> {
    const old = read().nodes.find(n => n.id === id);
    if (!old) return fail('not_found');
    const done = statusKindOf(statusId) === 'completed';
    const next = {
      ...old,
      statusId,
      progress: done ? 100 : old.progress,
      actualCompletedAt: done ? old.actualCompletedAt ?? today : null,
      updatedAt: now(),
    };
    editNodes(old.projectId, nodes => nodes.map(n => (n.id === id ? next : n)));
    return ok(next);
  },

  /** Moves a node (with its branch) under another parent — never into itself. */
  moveNode(id: string, newParentId: string): Result<LongTermNode> {
    const d = read();
    const node = d.nodes.find(n => n.id === id);
    if (!node) return fail('not_found');
    const mine = d.nodes.filter(n => n.projectId === node.projectId);
    if (!canMove(mine, id, newParentId)) return fail('invalid_move');
    const next = {
      ...node,
      parentId: newParentId,
      sortOrder: nextSortOrder(childrenMap(mine), newParentId),
      offsets: {},
      updatedAt: now(),
    };
    editNodes(node.projectId, nodes =>
      nodes.map(n => (n.id === id ? next : n)),
    );
    return ok(next);
  },

  /** Copies a node and its branch next to it (same parent). */
  duplicateNode(id: string, nameSuffix: string): Result<LongTermNode> {
    const d = read();
    const node = d.nodes.find(n => n.id === id);
    if (!node) return fail('not_found');
    if (!node.parentId) return fail('is_root');
    const mine = d.nodes.filter(n => n.projectId === node.projectId);
    const copies = duplicateBranch(
      mine,
      id,
      node.parentId,
      createLocalId,
      now(),
      nameSuffix,
    );
    editNodes(node.projectId, nodes => [...nodes, ...copies]);
    return ok(copies[0]);
  },

  /** Deletes a node: with its whole branch, or moving its children up. */
  deleteNode(id: string, mode: 'branch' | 'reparent'): Result<string[]> {
    const node = read().nodes.find(n => n.id === id);
    if (!node) return fail('not_found');
    if (!node.parentId) return fail('is_root');
    let removed: string[] = [];
    editNodes(node.projectId, nodes => {
      const r = removeNode(nodes, id, mode, now());
      removed = r.removed;
      return r.nodes;
    });
    return ok(removed);
  },

  setCollapsed(id: string, collapsed: boolean) {
    const node = read().nodes.find(n => n.id === id);
    if (!node) return;
    editNodes(
      node.projectId,
      nodes => nodes.map(n => (n.id === id ? { ...n, collapsed } : n)),
      false,
    );
  },

  /** Collapses (every node with children) or expands a whole project. */
  setAllCollapsed(projectId: string, collapsed: boolean) {
    const mine = read().nodes.filter(n => n.projectId === projectId);
    const map = childrenMap(mine);
    editNodes(
      projectId,
      nodes =>
        nodes.map(n =>
          n.parentId === null
            ? { ...n, collapsed: false }
            : map.get(n.id)?.length
            ? { ...n, collapsed }
            : n,
        ),
      false,
    );
  },

  /** Opens every collapsed ancestor of [id] (e.g. to show a search result). */
  revealNode(id: string) {
    const d = read();
    const node = d.nodes.find(n => n.id === id);
    if (!node) return;
    const byId = new Map(d.nodes.map(n => [n.id, n]));
    const open = new Set<string>();
    let cur = node.parentId;
    while (cur && !open.has(cur)) {
      open.add(cur);
      cur = byId.get(cur)?.parentId ?? null;
    }
    if ([...open].some(a => byId.get(a)?.collapsed)) {
      editNodes(
        node.projectId,
        nodes =>
          nodes.map(n => (open.has(n.id) ? { ...n, collapsed: false } : n)),
        false,
      );
    }
  },

  /** A dragged node's offset (per style); its branch moves with it. */
  setOffset(id: string, style: MapStyle, offset: { x: number; y: number }) {
    const node = read().nodes.find(n => n.id === id);
    if (!node) return;
    editNodes(node.projectId, nodes =>
      nodes.map(n =>
        n.id === id
          ? {
              ...n,
              offsets: {
                ...n.offsets,
                [style]: { x: Math.round(offset.x), y: Math.round(offset.y) },
              },
            }
          : n,
      ),
    );
  },

  /** Forgets dragged positions for one style. */
  resetOffsets(projectId: string, style: MapStyle) {
    editNodes(projectId, nodes =>
      nodes.map(n => {
        if (!n.offsets[style]) return n;
        const offsets = { ...n.offsets };
        delete offsets[style];
        return { ...n, offsets };
      }),
    );
  },

  canUndo: (projectId: string) => (undoStacks.get(projectId)?.length ?? 0) > 0,
  canRedo: (projectId: string) => (redoStacks.get(projectId)?.length ?? 0) > 0,

  undo(projectId: string): boolean {
    const stack = undoStacks.get(projectId);
    const prev = stack?.pop();
    if (!prev) return false;
    const redo = redoStacks.get(projectId) ?? [];
    redo.push(read().nodes.filter(n => n.projectId === projectId));
    redoStacks.set(projectId, redo);
    replaceProjectNodes(projectId, prev);
    return true;
  },

  redo(projectId: string): boolean {
    const stack = redoStacks.get(projectId);
    const next = stack?.pop();
    if (!next) return false;
    const undo = undoStacks.get(projectId) ?? [];
    undo.push(read().nodes.filter(n => n.projectId === projectId));
    undoStacks.set(projectId, undo);
    replaceProjectNodes(projectId, next);
    return true;
  },

  // ── Notes ──
  addNote(
    nodeId: string,
    content: string,
    progress: number | null = null,
  ): Result<LongTermNote> {
    const d = read();
    const node = d.nodes.find(n => n.id === nodeId);
    if (!node) return fail('not_found');
    const text = clip(content);
    if (!text && progress === null) return fail('name_required');
    const t = now();
    const note: LongTermNote = {
      id: createLocalId(),
      nodeId,
      content: text || `${progress}%`,
      type: progress === null ? 'note' : 'progress',
      progress,
      createdAt: t,
      updatedAt: t,
    };
    let nodes = d.nodes;
    if (progress !== null) {
      // A progress update also sets the node's recorded progress.
      const value = Math.max(0, Math.min(100, Math.round(progress)));
      nodes = d.nodes.map(n =>
        n.id === nodeId ? { ...n, progress: value, updatedAt: t } : n,
      );
    }
    commit({ ...d, nodes, notes: [...d.notes, note] }, ['nodes', 'notes']);
    return ok(note);
  },

  deleteNote(id: string) {
    const d = read();
    commit({ ...d, notes: d.notes.filter(n => n.id !== id) }, ['notes']);
  },

  // ── Statuses & categories ──
  addStatus(name: string, color: string): Result<LongTermStatus> {
    const label = clip(name, 40);
    if (!label) return fail('custom_name_required');
    const d = read();
    const existing = d.statuses.find(
      s => !s.isSystem && s.name.toLowerCase() === label.toLowerCase(),
    );
    if (existing) return ok(existing);
    const status: LongTermStatus = {
      id: `s-${createLocalId()}`,
      name: label,
      color,
      kind: 'other',
      isSystem: false,
      isActive: true,
    };
    commit({ ...d, statuses: [...d.statuses, status] }, ['statuses']);
    return ok(status);
  },

  updateStatusColor(id: string, color: string) {
    const d = read();
    commit(
      {
        ...d,
        statuses: d.statuses.map(s => (s.id === id ? { ...s, color } : s)),
      },
      ['statuses'],
    );
  },

  addCategory(name: string, color: string): Result<LongTermCategory> {
    const label = clip(name, 40);
    if (!label) return fail('custom_name_required');
    const d = read();
    const existing = d.categories.find(
      c => !c.isSystem && c.name.toLowerCase() === label.toLowerCase(),
    );
    if (existing) return ok(existing);
    const category: LongTermCategory = {
      id: `c-${createLocalId()}`,
      name: label,
      color,
      kind: 'other',
      isSystem: false,
      isActive: true,
    };
    commit({ ...d, categories: [...d.categories, category] }, ['categories']);
    return ok(category);
  },

  updateCategoryColor(id: string, color: string) {
    const d = read();
    commit(
      {
        ...d,
        categories: d.categories.map(c => (c.id === id ? { ...c, color } : c)),
      },
      ['categories'],
    );
  },

  // ── View ──
  saveView(projectId: string, view: PlannerView) {
    const d = read();
    cache = {
      ...d,
      settings: {
        ...d.settings,
        views: { ...d.settings.views, [projectId]: view },
      },
    };
    storage.set(KEYS.settings, JSON.stringify(cache.settings));
  },

  // ── Backup ──
  /**
   * Restores a validated dataset. `merge` adds new ids and replaces an
   * existing id only when the backup copy is newer (projects and nodes);
   * custom statuses/categories and notes are added. `replace` swaps
   * everything. All in one commit, so a failure never leaves half a restore.
   */
  restore(
    input: ReturnType<typeof sanitize>,
    mode: 'merge' | 'replace',
  ): PlannerRestoreSummary {
    const d = read();
    let added = 0;
    let updated = 0;
    const merge = <T extends { id: string }>(
      current: T[],
      next: T[],
      newer?: (a: T, b: T) => boolean,
    ) => {
      if (mode === 'replace') return next;
      const byId = new Map(current.map(x => [x.id, x]));
      for (const item of next) {
        const existing = byId.get(item.id);
        if (!existing) {
          byId.set(item.id, item);
          added++;
        } else if (newer?.(item, existing)) {
          byId.set(item.id, item);
          updated++;
        }
      }
      return [...byId.values()];
    };
    const newer = (a: { updatedAt: string }, b: { updatedAt: string }) =>
      a.updatedAt > b.updatedAt;
    const merged = sanitize({
      projects: merge(d.projects, input.projects, newer),
      nodes: merge(d.nodes, input.nodes, newer),
      statuses: merge(d.statuses, input.statuses),
      categories: merge(d.categories, input.categories),
      notes: merge(d.notes, input.notes),
      settings:
        mode === 'replace'
          ? input.settings
          : { views: { ...input.settings.views, ...d.settings.views } },
    });
    commit(
      {
        projects: merged.projects,
        nodes: merged.nodes,
        statuses: merged.statuses,
        categories: merged.categories,
        notes: merged.notes,
        settings: merged.settings,
      },
      ['projects', 'nodes', 'statuses', 'categories', 'notes', 'settings'],
    );
    undoStacks.clear();
    redoStacks.clear();
    return {
      projects: merged.projects.length,
      nodes: merged.nodes.length,
      added:
        mode === 'replace'
          ? merged.projects.length + merged.nodes.length
          : added,
      updated,
      repaired: merged.repaired,
    };
  },

  /** Every node of a project's branch below [id] (for delete confirmations). */
  branchSize(id: string): number {
    const node = read().nodes.find(n => n.id === id);
    if (!node) return 0;
    return descendantIds(
      childrenMap(read().nodes.filter(n => n.projectId === node.projectId)),
      id,
    ).length;
  },

  /** Tests only. */
  resetForTest() {
    cache = null;
    undoStacks.clear();
    redoStacks.clear();
  },
};

export interface PlannerRestoreSummary {
  projects: number;
  nodes: number;
  added: number;
  updated: number;
  repaired: number;
}
