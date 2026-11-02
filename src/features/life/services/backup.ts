import type { BackupInput } from '../store/life.store';
import type { LifeData } from '../types';

/**
 * Manage Life ⇄ spreadsheet mapping (pure, no I/O).
 *
 * A backup is one workbook with a sheet per record type. Row 1 holds the
 * column keys; nested lists (target versions, pauses, report edits) get
 * their own sheet keyed by the parent id. Columns marked "helper" (task /
 * project names, unit) only make the sheet readable in Excel and are
 * ignored on import. Column order doesn't matter on import — columns are
 * found by their header — so a re-saved or re-ordered sheet still restores.
 * Picture attachments are not included (they are files on this phone).
 */

export type Cell = string | number | boolean | null;
export interface SheetData {
  name: string;
  rows: Cell[][];
}

export const BACKUP_FORMAT = 'akshar-life-backup';
export const BACKUP_FORMAT_VERSION = 1;

export const SHEETS = {
  about: 'About',
  projects: 'Projects',
  tasks: 'Tasks',
  targets: 'Targets',
  pauses: 'Pauses',
  progress: 'Progress',
  edits: 'Progress edits',
  reviews: 'Reviews',
} as const;

const PROJECT_COLUMNS = [
  'id',
  'name',
  'description',
  'objective',
  'successCriteria',
  'category',
  'priority',
  'status',
  'startDate',
  'deadline',
  'icon',
  'color',
  'notes',
  'createdAt',
  'updatedAt',
] as const;
const TASK_COLUMNS = [
  'id',
  'projectId',
  'project', // helper
  'name',
  'description',
  'unit',
  'priority',
  'status',
  'startDate',
  'endDate',
  'focusDay',
  'icon',
  'color',
  'notes',
  'createdAt',
  'updatedAt',
] as const;
const TARGET_COLUMNS = [
  'taskId',
  'task', // helper
  'effectiveFrom',
  'quantity',
  'frequency',
  'intervalDays',
] as const;
const PAUSE_COLUMNS = ['taskId', 'task', 'from', 'to', 'reason'] as const;
const PROGRESS_COLUMNS = [
  'id',
  'taskId',
  'task', // helper
  'project', // helper
  'day',
  'quantity',
  'unit', // helper
  'note',
  'reportedAt',
  'createdAt',
  'updatedAt',
] as const;
const EDIT_COLUMNS = ['reportId', 'at', 'quantity', 'note'] as const;
const REVIEW_COLUMNS = [
  'id',
  'taskId',
  'task', // helper
  'periodStart',
  'periodEnd',
  'targetQuantity',
  'completedQuantity',
  'reason',
  'note',
  'createdAt',
  'updatedAt',
] as const;

const NUMBER_FIELDS = new Set([
  'quantity',
  'intervalDays',
  'targetQuantity',
  'completedQuantity',
]);
const DAY_FIELDS = new Set([
  'startDate',
  'deadline',
  'endDate',
  'focusDay',
  'effectiveFrom',
  'from',
  'to',
  'day',
  'periodStart',
  'periodEnd',
]);
const TIME_FIELDS = new Set(['createdAt', 'updatedAt', 'reportedAt', 'at']);

type Row = Record<string, unknown>;

function table<C extends readonly string[]>(
  name: string,
  columns: C,
  records: Row[],
): SheetData {
  return {
    name,
    rows: [
      [...columns],
      ...records.map(r =>
        columns.map(c => {
          const v = r[c];
          return v === undefined || v === null ? null : (v as Cell);
        }),
      ),
    ],
  };
}

/** Workbook sheets for the whole Manage Life dataset. */
export function toSheets(data: LifeData, exportedAt: Date): SheetData[] {
  const projectName = new Map(data.projects.map(p => [p.id, p.name]));
  const taskById = new Map(data.tasks.map(t => [t.id, t]));
  const taskName = (id: string) => taskById.get(id)?.name ?? '';

  const about: SheetData = {
    name: SHEETS.about,
    rows: [
      ['field', 'value'],
      ['format', BACKUP_FORMAT],
      ['formatVersion', BACKUP_FORMAT_VERSION],
      ['schemaVersion', data.schemaVersion],
      ['exportedAt', exportedAt.toISOString()],
      ['projects', data.projects.length],
      ['tasks', data.tasks.length],
      ['progress', data.reports.length],
      ['reviews', data.reviews.length],
    ],
  };

  return [
    about,
    table(SHEETS.projects, PROJECT_COLUMNS, data.projects as unknown as Row[]),
    table(
      SHEETS.tasks,
      TASK_COLUMNS,
      data.tasks.map(t => ({
        ...t,
        project: projectName.get(t.projectId) ?? '',
      })),
    ),
    table(
      SHEETS.targets,
      TARGET_COLUMNS,
      data.tasks.flatMap(t =>
        t.targets.map(v => ({ ...v, taskId: t.id, task: t.name })),
      ),
    ),
    table(
      SHEETS.pauses,
      PAUSE_COLUMNS,
      data.tasks.flatMap(t =>
        t.pauses.map(p => ({ ...p, taskId: t.id, task: t.name })),
      ),
    ),
    table(
      SHEETS.progress,
      PROGRESS_COLUMNS,
      data.reports.map(r => {
        const task = taskById.get(r.taskId);
        return {
          ...r,
          task: task?.name ?? '',
          project: task ? projectName.get(task.projectId) ?? '' : '',
          unit: task?.unit ?? '',
        };
      }),
    ),
    table(
      SHEETS.edits,
      EDIT_COLUMNS,
      data.reports.flatMap(r => r.edits.map(e => ({ ...e, reportId: r.id }))),
    ),
    table(
      SHEETS.reviews,
      REVIEW_COLUMNS,
      data.reviews.map(r => ({ ...r, task: taskName(r.taskId) })),
    ),
  ];
}

// ── Import ────────────────────────────────────────────────────────────

/** Excel's day 0 is 1899-12-30 (its 1900 leap-year bug included). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

function serialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_MS + Math.round(serial * DAY_MS));
}

/** "2026-10-20", an Excel date serial, or "20/10/2026"-style text → DayKey. */
export function toDayKey(v: unknown): string | null {
  if (typeof v === 'number' && v > 0 && v < 2_958_466) {
    return serialToDate(Math.floor(v)).toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  }
  return null;
}

function toTime(v: unknown): string {
  if (typeof v === 'number' && v > 0) return serialToDate(v).toISOString();
  return typeof v === 'string' ? v.trim() : '';
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim()) return Number(v.replace(',', '.'));
  return NaN;
}

function convert(field: string, v: unknown): unknown {
  if (NUMBER_FIELDS.has(field)) return toNumber(v);
  if (DAY_FIELDS.has(field)) return toDayKey(v);
  if (TIME_FIELDS.has(field)) return toTime(v);
  if (v === null || v === undefined) return '';
  // Ids typed as numbers by a spreadsheet app stay ids.
  return typeof v === 'number' || typeof v === 'boolean' ? String(v) : v;
}

/** Rows of a sheet as objects keyed by its header row (case-insensitive sheet name). */
export function readTable(sheets: SheetData[], name: string): Row[] {
  const sheet = sheets.find(
    s => s.name.trim().toLowerCase() === name.toLowerCase(),
  );
  if (!sheet || sheet.rows.length < 2) return [];
  const header = sheet.rows[0].map(h =>
    typeof h === 'string' ? h.trim() : '',
  );
  return sheet.rows
    .slice(1)
    .filter(row => row.some(c => c !== null && c !== ''))
    .map(row => {
      const out: Row = {};
      header.forEach((key, i) => {
        if (key) out[key] = convert(key, row[i] ?? null);
      });
      return out;
    });
}

export type ParseResult =
  | { ok: true; input: BackupInput; exportedAt: string | null }
  | { ok: false; error: 'not_backup' | 'newer_format' };

/** Rebuilds raw records from a workbook; the store validates them. */
export function fromSheets(sheets: SheetData[]): ParseResult {
  const about = new Map(
    readTable(sheets, SHEETS.about).map(r => [String(r.field), r.value]),
  );
  const projects = readTable(sheets, SHEETS.projects);
  if (about.get('format') !== BACKUP_FORMAT && !projects.length) {
    return { ok: false, error: 'not_backup' };
  }
  if (Number(about.get('formatVersion') ?? 1) > BACKUP_FORMAT_VERSION) {
    return { ok: false, error: 'newer_format' };
  }

  const byParent = (rows: Row[], key: string) => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const id = String(r[key] ?? '');
      if (!id) continue;
      map.set(id, [...(map.get(id) ?? []), r]);
    }
    return map;
  };
  const targets = byParent(readTable(sheets, SHEETS.targets), 'taskId');
  const pauses = byParent(readTable(sheets, SHEETS.pauses), 'taskId');
  const edits = byParent(readTable(sheets, SHEETS.edits), 'reportId');
  const blankToNull = (v: unknown) => (v === '' ? null : v);

  const tasks = readTable(sheets, SHEETS.tasks).map(t => {
    const id = String(t.id ?? '');
    return {
      ...t,
      endDate: blankToNull(t.endDate),
      focusDay: blankToNull(t.focusDay),
      imageUri: '',
      targets: targets.get(id) ?? [],
      pauses: (pauses.get(id) ?? []).map(p => ({
        ...p,
        to: blankToNull(p.to),
      })),
    };
  });
  const reports = readTable(sheets, SHEETS.progress).map(r => ({
    ...r,
    edits: edits.get(String(r.id ?? '')) ?? [],
  }));

  return {
    ok: true,
    exportedAt:
      typeof about.get('exportedAt') === 'string'
        ? (about.get('exportedAt') as string)
        : null,
    input: {
      projects: projects.map(p => ({ ...p, imageUri: '' })),
      tasks,
      reports,
      reviews: readTable(sheets, SHEETS.reviews),
    },
  };
}

/** "akshar-manage-life-2026-11-02.xlsx" */
export function backupFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `akshar-manage-life-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(
    now.getDate(),
  )}.xlsx`;
}

/** Counts shown before an import is applied. */
export function backupCounts(input: BackupInput) {
  return {
    projects: input.projects.length,
    tasks: input.tasks.length,
    reports: input.reports.length,
    reviews: input.reviews.length,
  };
}
