import { storage, StorageKeys } from '@/store/mmkv';
import { createLocalId as createId } from '@/shared/utils';
import type {
  DayKey,
  FrequencyType,
  IncompleteReason,
  LifeData,
  Pause,
  PeriodReview,
  Priority,
  ProgressReport,
  Project,
  ProjectStatus,
  RecommendationSet,
  Task,
  TaskStatus,
  TargetVersion,
} from '../types';
import { INCOMPLETE_REASONS } from '../types';
import { addDays, isDayKey } from '../utils/dates';
import {
  evaluate,
  nextPeriodStart,
  periodContaining,
} from '../services/periods';

/**
 * Manage Life persistence (MMKV, local to this device / profile). One key
 * per collection so large report histories don't rewrite projects; every
 * record is validated on load (a bad record is dropped, never crashes the
 * app). All writes go through here, bump `version` and notify subscribers.
 */

export const SCHEMA_VERSION = 1;
export const MAX_TEXT = 500;
export const MAX_NAME = 80;
export const MAX_QUANTITY = 10_000_000;
export const MAX_INTERVAL = 365;
/** Same task + day + quantity + note within this window = an accidental double tap. */
export const DUPLICATE_WINDOW_MS = 5000;

const KEYS = {
  meta: StorageKeys.LifeMeta,
  projects: StorageKeys.LifeProjects,
  tasks: StorageKeys.LifeTasks,
  reports: StorageKeys.LifeReports,
  reviews: StorageKeys.LifeReviews,
  recommendations: StorageKeys.LifeRecommendations,
} as const;

export type LifeError =
  | 'name_required'
  | 'unit_required'
  | 'quantity_invalid'
  | 'interval_invalid'
  | 'dates_invalid'
  | 'not_found'
  | 'duplicate'
  | 'day_out_of_range'
  | 'period_open'
  | 'target_met'
  | 'already_reviewed'
  | 'reason_invalid'
  | 'note_required';

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: LifeError };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: LifeError): Result<T> => ({ ok: false, error });

// ── Validation on load ─────────────────────────────────────────────────

type R = Record<string, unknown>;
const str = (v: unknown, max = MAX_TEXT) =>
  typeof v === 'string' ? v.slice(0, max) : '';
const num = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? v : NaN;
const day = (v: unknown, d: DayKey) => (isDayKey(v) ? v : d);
const iso = (v: unknown) =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v))
    ? v
    : new Date(0).toISOString();
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T =>
  all.includes(v as T) ? (v as T) : d;
const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];
const FREQUENCIES: readonly FrequencyType[] = ['daily', 'weekly', 'interval'];

function cleanProject(r: R): Project | null {
  if (typeof r.id !== 'string' || !str(r.name)) return null;
  const start = day(r.startDate, '1970-01-01');
  return {
    id: r.id,
    name: str(r.name, MAX_NAME),
    description: str(r.description),
    objective: str(r.objective),
    successCriteria: str(r.successCriteria),
    category: str(r.category, MAX_NAME),
    priority: oneOf(r.priority, PRIORITIES, 'medium'),
    notes: str(r.notes),
    icon: str(r.icon, 40) || 'layers',
    imageUri: str(r.imageUri, 1000),
    color: str(r.color, 20) || 'violet',
    startDate: start,
    deadline: day(r.deadline, start),
    status: oneOf<ProjectStatus>(
      r.status,
      ['active', 'completed', 'archived'],
      'active',
    ),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function cleanTarget(r: R): TargetVersion | null {
  const quantity = num(r.quantity);
  const frequency = oneOf(r.frequency, FREQUENCIES, 'daily');
  const intervalDays =
    frequency === 'daily'
      ? 1
      : frequency === 'weekly'
      ? 7
      : Math.round(num(r.intervalDays));
  if (
    !isDayKey(r.effectiveFrom) ||
    !(quantity > 0) ||
    !(intervalDays >= 1 && intervalDays <= MAX_INTERVAL)
  )
    return null;
  return { effectiveFrom: r.effectiveFrom, quantity, frequency, intervalDays };
}

function cleanTask(r: R): Task | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.projectId !== 'string' ||
    !str(r.name) ||
    !isDayKey(r.startDate)
  )
    return null;
  const targets = (Array.isArray(r.targets) ? r.targets : [])
    .map(t => (t && typeof t === 'object' ? cleanTarget(t as R) : null))
    .filter((t): t is TargetVersion => t !== null)
    .sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1));
  if (!targets.length) return null;
  const pauses = (Array.isArray(r.pauses) ? r.pauses : [])
    .map(p => p as R)
    .filter(p => p && isDayKey(p.from))
    .map(
      (p): Pause => ({
        from: p.from as DayKey,
        to: isDayKey(p.to) ? p.to : null,
        reason: str(p.reason),
      }),
    );
  return {
    id: r.id,
    projectId: r.projectId,
    name: str(r.name, MAX_NAME),
    description: str(r.description),
    icon: str(r.icon, 40) || 'circleCheck',
    imageUri: str(r.imageUri, 1000),
    color: str(r.color, 20) || 'violet',
    unit: str(r.unit, 30) || 'times',
    targets,
    startDate: r.startDate,
    endDate: isDayKey(r.endDate) ? r.endDate : null,
    priority: oneOf(r.priority, PRIORITIES, 'medium'),
    status: oneOf<TaskStatus>(
      r.status,
      ['active', 'paused', 'completed', 'archived'],
      'active',
    ),
    focusDay: isDayKey(r.focusDay) ? r.focusDay : null,
    pauses,
    notes: str(r.notes),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function cleanReport(r: R): ProgressReport | null {
  const quantity = num(r.quantity);
  if (
    typeof r.id !== 'string' ||
    typeof r.taskId !== 'string' ||
    !isDayKey(r.day) ||
    !(quantity > 0)
  )
    return null;
  return {
    id: r.id,
    taskId: r.taskId,
    day: r.day,
    quantity,
    note: str(r.note),
    reportedAt: iso(r.reportedAt),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
    edits: (Array.isArray(r.edits) ? r.edits : [])
      .map(e => e as R)
      .filter(e => e && Number.isFinite(num(e.quantity)))
      .map(e => ({
        at: iso(e.at),
        quantity: num(e.quantity),
        note: str(e.note),
      })),
  };
}

function cleanReview(r: R): PeriodReview | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.taskId !== 'string' ||
    !isDayKey(r.periodStart) ||
    !isDayKey(r.periodEnd)
  )
    return null;
  return {
    id: r.id,
    taskId: r.taskId,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    targetQuantity: num(r.targetQuantity) || 0,
    completedQuantity: num(r.completedQuantity) || 0,
    reason: oneOf(r.reason, INCOMPLETE_REASONS, 'other'),
    note: str(r.note),
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

function readList<T>(key: string, clean: (r: R) => T | null): T[] {
  try {
    const raw = storage.getString(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(x => (x && typeof x === 'object' ? clean(x as R) : null))
      .filter((x): x is T => x !== null);
  } catch {
    return [];
  }
}

function load(): LifeData {
  let meta: R = {};
  try {
    meta = JSON.parse(storage.getString(KEYS.meta) ?? '{}') as R;
  } catch {
    meta = {};
  }
  let recommendations: RecommendationSet | null = null;
  try {
    const raw = storage.getString(KEYS.recommendations);
    const r = raw ? (JSON.parse(raw) as R) : null;
    if (r && Array.isArray(r.items) && typeof r.generatedAt === 'string') {
      recommendations = r as unknown as RecommendationSet;
    }
  } catch {
    recommendations = null;
  }
  // Future schema changes migrate here, keyed on meta.schemaVersion.
  return {
    schemaVersion: SCHEMA_VERSION,
    version: Number.isInteger(meta.version) ? (meta.version as number) : 0,
    projects: readList(KEYS.projects, cleanProject),
    tasks: readList(KEYS.tasks, cleanTask),
    reports: readList(KEYS.reports, cleanReport),
    reviews: readList(KEYS.reviews, cleanReview),
    recommendations,
  };
}

// ── Store ──────────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: LifeData | null = null;

type Collection =
  | 'projects'
  | 'tasks'
  | 'reports'
  | 'reviews'
  | 'recommendations';

function commit(
  next: Omit<LifeData, 'version' | 'schemaVersion'>,
  changed: Collection[],
) {
  const prev = read();
  cache = { ...next, schemaVersion: SCHEMA_VERSION, version: prev.version + 1 };
  for (const c of changed) {
    storage.set(KEYS[c], JSON.stringify(cache[c]));
  }
  storage.set(
    KEYS.meta,
    JSON.stringify({ schemaVersion: SCHEMA_VERSION, version: cache.version }),
  );
  listeners.forEach(l => l());
}

function read(): LifeData {
  if (!cache) cache = load();
  return cache;
}

const now = () => new Date().toISOString();

// ── Inputs ─────────────────────────────────────────────────────────────

export interface ProjectInput {
  name: string;
  description?: string;
  objective?: string;
  successCriteria?: string;
  category?: string;
  priority?: Priority;
  notes?: string;
  icon: string;
  imageUri?: string;
  color: string;
  startDate: DayKey;
  deadline: DayKey;
}

export interface TargetInput {
  quantity: number;
  frequency: FrequencyType;
  intervalDays: number;
}

export interface TaskInput {
  projectId: string;
  name: string;
  description?: string;
  icon: string;
  imageUri?: string;
  color: string;
  unit: string;
  target: TargetInput;
  startDate: DayKey;
  endDate?: DayKey | null;
  priority?: Priority;
  notes?: string;
}

export function validateProject(input: ProjectInput): LifeError | null {
  if (!input.name.trim()) return 'name_required';
  if (
    !isDayKey(input.startDate) ||
    !isDayKey(input.deadline) ||
    input.deadline < input.startDate
  )
    return 'dates_invalid';
  return null;
}

export function validateTarget(t: TargetInput): LifeError | null {
  if (
    !(
      Number.isFinite(t.quantity) &&
      t.quantity > 0 &&
      t.quantity <= MAX_QUANTITY
    )
  )
    return 'quantity_invalid';
  if (
    t.frequency === 'interval' &&
    !(
      Number.isInteger(t.intervalDays) &&
      t.intervalDays >= 1 &&
      t.intervalDays <= MAX_INTERVAL
    )
  ) {
    return 'interval_invalid';
  }
  return null;
}

export function validateTask(input: TaskInput): LifeError | null {
  if (!input.name.trim()) return 'name_required';
  if (!input.unit.trim()) return 'unit_required';
  const t = validateTarget(input.target);
  if (t) return t;
  if (
    !isDayKey(input.startDate) ||
    (input.endDate &&
      (!isDayKey(input.endDate) || input.endDate < input.startDate))
  ) {
    return 'dates_invalid';
  }
  return null;
}

const normalizeTarget = (
  t: TargetInput,
  effectiveFrom: DayKey,
): TargetVersion => ({
  effectiveFrom,
  quantity: t.quantity,
  frequency: t.frequency,
  intervalDays:
    t.frequency === 'daily' ? 1 : t.frequency === 'weekly' ? 7 : t.intervalDays,
});

const clip = (s: string | undefined, max = MAX_TEXT) =>
  (s ?? '').trim().slice(0, max);

export const lifeStore = {
  read,
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  // ── Projects ──
  createProject(input: ProjectInput): Result<Project> {
    const error = validateProject(input);
    if (error) return fail(error);
    const t = now();
    const project: Project = {
      id: createId(),
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      objective: clip(input.objective),
      successCriteria: clip(input.successCriteria),
      category: clip(input.category, MAX_NAME),
      priority: input.priority ?? 'medium',
      notes: clip(input.notes),
      icon: input.icon,
      imageUri: input.imageUri ?? '',
      color: input.color,
      startDate: input.startDate,
      deadline: input.deadline,
      status: 'active',
      createdAt: t,
      updatedAt: t,
    };
    const d = read();
    commit({ ...d, projects: [...d.projects, project] }, ['projects']);
    return ok(project);
  },

  updateProject(id: string, input: ProjectInput): Result<Project> {
    const error = validateProject(input);
    if (error) return fail(error);
    const d = read();
    const existing = d.projects.find(p => p.id === id);
    if (!existing) return fail('not_found');
    const project: Project = {
      ...existing,
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      objective: clip(input.objective),
      successCriteria: clip(input.successCriteria),
      category: clip(input.category, MAX_NAME),
      priority: input.priority ?? existing.priority,
      notes: clip(input.notes),
      icon: input.icon,
      imageUri: input.imageUri ?? '',
      color: input.color,
      startDate: input.startDate,
      deadline: input.deadline,
      updatedAt: now(),
    };
    commit(
      { ...d, projects: d.projects.map(p => (p.id === id ? project : p)) },
      ['projects'],
    );
    return ok(project);
  },

  /** Active / completed / archived (restore = back to active). */
  setProjectStatus(id: string, status: ProjectStatus): Result<Project> {
    const d = read();
    const existing = d.projects.find(p => p.id === id);
    if (!existing) return fail('not_found');
    const project = { ...existing, status, updatedAt: now() };
    commit(
      { ...d, projects: d.projects.map(p => (p.id === id ? project : p)) },
      ['projects'],
    );
    return ok(project);
  },

  /** Deletes the project with its tasks, reports and reviews (the UI confirms first). */
  deleteProject(id: string): Result<null> {
    const d = read();
    if (!d.projects.some(p => p.id === id)) return fail('not_found');
    const taskIds = new Set(
      d.tasks.filter(t => t.projectId === id).map(t => t.id),
    );
    commit(
      {
        ...d,
        projects: d.projects.filter(p => p.id !== id),
        tasks: d.tasks.filter(t => !taskIds.has(t.id)),
        reports: d.reports.filter(r => !taskIds.has(r.taskId)),
        reviews: d.reviews.filter(r => !taskIds.has(r.taskId)),
      },
      ['projects', 'tasks', 'reports', 'reviews'],
    );
    return ok(null);
  },

  // ── Tasks ──
  createTask(input: TaskInput): Result<Task> {
    const error = validateTask(input);
    if (error) return fail(error);
    const d = read();
    if (!d.projects.some(p => p.id === input.projectId))
      return fail('not_found');
    const t = now();
    const task: Task = {
      id: createId(),
      projectId: input.projectId,
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      icon: input.icon,
      imageUri: input.imageUri ?? '',
      color: input.color,
      unit: clip(input.unit, 30),
      targets: [normalizeTarget(input.target, input.startDate)],
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      priority: input.priority ?? 'medium',
      status: 'active',
      focusDay: null,
      pauses: [],
      notes: clip(input.notes),
      createdAt: t,
      updatedAt: t,
    };
    commit({ ...d, tasks: [...d.tasks, task] }, ['tasks']);
    return ok(task);
  },

  /**
   * Edits a task. A changed target is added as a new version from the next
   * period ([today]), so earlier periods keep their original target.
   */
  updateTask(id: string, input: TaskInput, today: DayKey): Result<Task> {
    const error = validateTask(input);
    if (error) return fail(error);
    const d = read();
    const existing = d.tasks.find(t => t.id === id);
    if (!existing) return fail('not_found');
    const base: Task = {
      ...existing,
      name: clip(input.name, MAX_NAME),
      description: clip(input.description),
      icon: input.icon,
      imageUri: input.imageUri ?? '',
      color: input.color,
      unit: clip(input.unit, 30),
      endDate: input.endDate ?? null,
      priority: input.priority ?? existing.priority,
      notes: clip(input.notes),
      updatedAt: now(),
    };
    // The start date can only move while no history exists.
    const hasHistory =
      d.reports.some(r => r.taskId === id) ||
      d.reviews.some(r => r.taskId === id);
    if (!hasHistory && input.startDate !== existing.startDate) {
      base.startDate = input.startDate;
      base.targets = [normalizeTarget(input.target, input.startDate)];
    } else {
      base.targets = withTarget(existing, input.target, today);
    }
    commit({ ...d, tasks: d.tasks.map(t => (t.id === id ? base : t)) }, [
      'tasks',
    ]);
    return ok(base);
  },

  /** Applies a new target from the next period (e.g. an accepted AI suggestion). */
  changeTarget(id: string, target: TargetInput, today: DayKey): Result<Task> {
    const error = validateTarget(target);
    if (error) return fail(error);
    const d = read();
    const existing = d.tasks.find(t => t.id === id);
    if (!existing) return fail('not_found');
    const task = {
      ...existing,
      targets: withTarget(existing, target, today),
      updatedAt: now(),
    };
    commit({ ...d, tasks: d.tasks.map(t => (t.id === id ? task : t)) }, [
      'tasks',
    ]);
    return ok(task);
  },

  setTaskStatus(id: string, status: TaskStatus): Result<Task> {
    return patchTask(id, t => ({ ...t, status }));
  },

  /** Pauses from [today]; paused periods never ask for a reason. */
  pauseTask(id: string, reason: string, today: DayKey): Result<Task> {
    return patchTask(id, t =>
      t.pauses.some(p => p.to === null)
        ? t
        : {
            ...t,
            status: 'paused',
            pauses: [
              ...t.pauses,
              { from: today, to: null, reason: clip(reason) },
            ],
          },
    );
  },

  /** Ends the open pause yesterday (or drops it if it started today). */
  resumeTask(id: string, today: DayKey): Result<Task> {
    return patchTask(id, t => ({
      ...t,
      status: 'active',
      pauses: t.pauses
        .map(p => (p.to === null ? { ...p, to: addDays(today, -1) } : p))
        .filter(p => p.to === null || p.to >= p.from),
    }));
  },

  /** Marks / unmarks a task as one of today's focus tasks. */
  setFocus(id: string, today: DayKey | null): Result<Task> {
    return patchTask(id, t => ({ ...t, focusDay: today }));
  },

  /** Deletes a task with its reports and reviews (the UI confirms first). */
  deleteTask(id: string): Result<null> {
    const d = read();
    if (!d.tasks.some(t => t.id === id)) return fail('not_found');
    commit(
      {
        ...d,
        tasks: d.tasks.filter(t => t.id !== id),
        reports: d.reports.filter(r => r.taskId !== id),
        reviews: d.reviews.filter(r => r.taskId !== id),
      },
      ['tasks', 'reports', 'reviews'],
    );
    return ok(null);
  },

  // ── Progress reports ──
  /** Logs progress; adds to the period's total (never replaces it). */
  addReport(
    input: { taskId: string; day: DayKey; quantity: number; note?: string },
    today: DayKey,
    at: Date = new Date(),
  ): Result<ProgressReport> {
    const d = read();
    const task = d.tasks.find(t => t.id === input.taskId);
    if (!task) return fail('not_found');
    if (
      !(
        Number.isFinite(input.quantity) &&
        input.quantity > 0 &&
        input.quantity <= MAX_QUANTITY
      )
    ) {
      return fail('quantity_invalid');
    }
    if (
      !isDayKey(input.day) ||
      input.day > today ||
      !periodContaining(task, input.day)
    )
      return fail('day_out_of_range');
    const note = clip(input.note);
    const duplicate = d.reports.some(
      r =>
        r.taskId === input.taskId &&
        r.day === input.day &&
        r.quantity === input.quantity &&
        r.note === note &&
        Math.abs(at.getTime() - Date.parse(r.createdAt)) < DUPLICATE_WINDOW_MS,
    );
    if (duplicate) return fail('duplicate');
    const t = at.toISOString();
    const report: ProgressReport = {
      id: createId(),
      taskId: input.taskId,
      day: input.day,
      quantity: input.quantity,
      note,
      reportedAt: t,
      createdAt: t,
      updatedAt: t,
      edits: [],
    };
    commit({ ...d, reports: [...d.reports, report] }, ['reports']);
    return ok(report);
  },

  /** Corrects an entry; the previous values are kept in `edits`. */
  editReport(
    id: string,
    patch: { quantity: number; note: string },
  ): Result<ProgressReport> {
    if (
      !(
        Number.isFinite(patch.quantity) &&
        patch.quantity > 0 &&
        patch.quantity <= MAX_QUANTITY
      )
    ) {
      return fail('quantity_invalid');
    }
    const d = read();
    const existing = d.reports.find(r => r.id === id);
    if (!existing) return fail('not_found');
    const t = now();
    const report: ProgressReport = {
      ...existing,
      quantity: patch.quantity,
      note: clip(patch.note),
      updatedAt: t,
      edits: [
        ...existing.edits,
        { at: t, quantity: existing.quantity, note: existing.note },
      ],
    };
    commit({ ...d, reports: d.reports.map(r => (r.id === id ? report : r)) }, [
      'reports',
    ]);
    return ok(report);
  },

  deleteReport(id: string): Result<null> {
    const d = read();
    if (!d.reports.some(r => r.id === id)) return fail('not_found');
    commit({ ...d, reports: d.reports.filter(r => r.id !== id) }, ['reports']);
    return ok(null);
  },

  // ── Period-end reviews ──
  /** The reason for an ended, unmet period. One per task + period. */
  addReview(
    input: {
      taskId: string;
      periodStart: DayKey;
      reason: IncompleteReason;
      note?: string;
    },
    today: DayKey,
  ): Result<PeriodReview> {
    const d = read();
    const task = d.tasks.find(t => t.id === input.taskId);
    if (!task) return fail('not_found');
    if (!INCOMPLETE_REASONS.includes(input.reason))
      return fail('reason_invalid');
    const note = clip(input.note);
    if (input.reason === 'other' && note.length < 3)
      return fail('note_required');
    const period = periodContaining(task, input.periodStart);
    if (!period || period.start !== input.periodStart) return fail('not_found');
    if (period.end >= today) return fail('period_open');
    if (
      d.reviews.some(
        r => r.taskId === task.id && r.periodStart === period.start,
      )
    )
      return fail('already_reviewed');
    const state = evaluate(task, period, {
      reports: d.reports,
      reviews: d.reviews,
      today,
    });
    if (state.met) return fail('target_met');
    const t = now();
    const review: PeriodReview = {
      id: createId(),
      taskId: task.id,
      periodStart: period.start,
      periodEnd: period.end,
      targetQuantity: period.target.quantity,
      completedQuantity: state.completed,
      reason: input.reason,
      note,
      createdAt: t,
      updatedAt: t,
    };
    commit({ ...d, reviews: [...d.reviews, review] }, ['reviews']);
    return ok(review);
  },

  updateReview(
    id: string,
    reason: IncompleteReason,
    note: string,
  ): Result<PeriodReview> {
    if (!INCOMPLETE_REASONS.includes(reason)) return fail('reason_invalid');
    const clean = clip(note);
    if (reason === 'other' && clean.length < 3) return fail('note_required');
    const d = read();
    const existing = d.reviews.find(r => r.id === id);
    if (!existing) return fail('not_found');
    const review = { ...existing, reason, note: clean, updatedAt: now() };
    commit({ ...d, reviews: d.reviews.map(r => (r.id === id ? review : r)) }, [
      'reviews',
    ]);
    return ok(review);
  },

  // ── AI cache ──
  saveRecommendations(set: RecommendationSet) {
    const d = read();
    cache = { ...d, recommendations: set };
    storage.set(KEYS.recommendations, JSON.stringify(set));
    listeners.forEach(l => l());
  },

  /** Tests only. */
  resetCacheForTest() {
    cache = null;
  },
};

function patchTask(id: string, change: (t: Task) => Task): Result<Task> {
  const d = read();
  const existing = d.tasks.find(t => t.id === id);
  if (!existing) return fail('not_found');
  const task = { ...change(existing), updatedAt: now() };
  commit({ ...d, tasks: d.tasks.map(t => (t.id === id ? task : t)) }, [
    'tasks',
  ]);
  return ok(task);
}

/** The task's targets with [target] applied from the next period. */
function withTarget(
  task: Task,
  target: TargetInput,
  today: DayKey,
): TargetVersion[] {
  const latest = task.targets[task.targets.length - 1];
  const same =
    latest.quantity === target.quantity &&
    latest.frequency === target.frequency &&
    (target.frequency !== 'interval' ||
      latest.intervalDays === target.intervalDays);
  if (same) return task.targets;
  const from = nextPeriodStart(task, today);
  // A version that hasn't started yet is simply replaced.
  const kept = task.targets.filter(v => v.effectiveFrom < from);
  return [
    ...(kept.length ? kept : []),
    normalizeTarget(target, kept.length ? from : task.startDate),
  ];
}
