import { sanitize } from '../planner/store/planner.store';
import type { LongTermNode, PlannerData } from '../planner/types';
import type { BackupInput } from '../store/life.store';
import type { LifeData } from '../types';

/**
 * Full Manage Life backup (ZIP) ⇄ records. Pure: builds the archive's
 * manifest and entries, and validates/parses a read archive. The native
 * module only zips/unzips (with checksums and path checks).
 *
 * Archive layout (schema 1):
 *   manifest.json                      format, schemaVersion, appVersion, exportedAt,
 *                                      modules, includesAttachments, attachments[], files[]
 *   manage-life/projects.json          LifeData.projects
 *   manage-life/tasks.json             tasks (targets, pauses inline)
 *   manage-life/reports.json           progress reports (edits inline)
 *   manage-life/reviews.json           period-end reasons
 *   manage-life/settings.json          { schemaVersion }
 *   long-term-planner/projects.json    plans
 *   long-term-planner/nodes.json       nodes (parentId keeps the hierarchy)
 *   long-term-planner/statuses.json    system + custom statuses
 *   long-term-planner/categories.json  system + custom categories
 *   long-term-planner/milestones.json  milestone nodes (a convenience view)
 *   long-term-planner/notes.json       dated notes / progress updates
 *   long-term-planner/settings.json    canvas views
 *   attachments/<n>-<name>             pictures and files (optional)
 *
 * Ids and dates are kept exactly (days "YYYY-MM-DD", instants ISO 8601), so
 * relationships survive a restore.
 */

export const FULL_BACKUP_FORMAT = 'akshar-manage-life-backup';
export const FULL_BACKUP_SCHEMA = 1;
export const PLANNER_EXPORT_FORMAT = 'akshar-long-term-planner';

export type BackupModule = 'manage-life' | 'long-term-planner';

export type ArchiveEntry =
  | { path: string; text: string }
  | { path: string; file: string };

export interface Manifest {
  format: string;
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  modules: BackupModule[];
  includesAttachments: boolean;
  /** Original file uri → its path in the archive. */
  attachments: { uri: string; path: string }[];
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

/** Every private-file uri the records point at (pictures, attachments). */
export function attachmentUris(
  life: LifeData | null,
  planner: PlannerData | null,
): string[] {
  const uris = new Set<string>();
  const add = (u: string | undefined) => {
    if (u && u.startsWith('file://')) uris.add(u);
  };
  life?.projects.forEach(p => add(p.imageUri));
  life?.tasks.forEach(t => add(t.imageUri));
  planner?.projects.forEach(p => {
    add(p.imageUri);
    add(p.coverUri);
  });
  planner?.nodes.forEach(n => {
    add(n.imageUri);
    n.attachments.forEach(a => add(a.uri));
  });
  return [...uris];
}

const safeName = (uri: string) =>
  (
    decodeURIComponent(uri.split('/').pop() ?? 'file').replace(
      /[^A-Za-z0-9._-]/g,
      '_',
    ) || 'file'
  ).slice(-80);

export function buildArchive(
  life: LifeData | null,
  planner: PlannerData | null,
  options: {
    includeAttachments: boolean;
    appVersion: string;
    exportedAt: Date;
  },
): { manifest: Manifest; entries: ArchiveEntry[] } {
  const entries: ArchiveEntry[] = [];
  const modules: BackupModule[] = [];
  if (life) {
    modules.push('manage-life');
    entries.push(
      { path: 'manage-life/projects.json', text: json(life.projects) },
      { path: 'manage-life/tasks.json', text: json(life.tasks) },
      { path: 'manage-life/reports.json', text: json(life.reports) },
      { path: 'manage-life/reviews.json', text: json(life.reviews) },
      {
        path: 'manage-life/settings.json',
        text: json({ schemaVersion: life.schemaVersion }),
      },
    );
  }
  if (planner) {
    modules.push('long-term-planner');
    entries.push(
      { path: 'long-term-planner/projects.json', text: json(planner.projects) },
      { path: 'long-term-planner/nodes.json', text: json(planner.nodes) },
      { path: 'long-term-planner/statuses.json', text: json(planner.statuses) },
      {
        path: 'long-term-planner/categories.json',
        text: json(planner.categories),
      },
      {
        path: 'long-term-planner/milestones.json',
        text: json(
          planner.nodes
            .filter(n => n.kind === 'milestone')
            .map(n => ({
              id: n.id,
              projectId: n.projectId,
              nodeId: n.id,
              name: n.name,
              targetDate: n.targetDate,
              completedAt: n.actualCompletedAt,
              statusId: n.statusId,
            })),
        ),
      },
      { path: 'long-term-planner/notes.json', text: json(planner.notes) },
      { path: 'long-term-planner/settings.json', text: json(planner.settings) },
    );
  }
  const attachments: Manifest['attachments'] = [];
  if (options.includeAttachments) {
    attachmentUris(life, planner).forEach((uri, i) => {
      const path = `attachments/${i}-${safeName(uri)}`;
      attachments.push({ uri, path });
      entries.push({ path, file: uri });
    });
  }
  return {
    manifest: {
      format: FULL_BACKUP_FORMAT,
      schemaVersion: FULL_BACKUP_SCHEMA,
      appVersion: options.appVersion,
      exportedAt: options.exportedAt.toISOString(),
      modules,
      includesAttachments: options.includeAttachments,
      attachments,
    },
    entries,
  };
}

/** The planner alone as one JSON document (the "Long-Term Planner only" export). */
export function plannerJson(
  planner: PlannerData,
  appVersion: string,
  exportedAt: Date,
): string {
  return json({
    format: PLANNER_EXPORT_FORMAT,
    schemaVersion: FULL_BACKUP_SCHEMA,
    appVersion,
    exportedAt: exportedAt.toISOString(),
    projects: planner.projects,
    nodes: planner.nodes,
    statuses: planner.statuses,
    categories: planner.categories,
    notes: planner.notes,
    settings: planner.settings,
  });
}

// ── Import ────────────────────────────────────────────────────────────

/** What the native reader returns. */
export interface ReadArchive {
  stageId: string;
  manifest: Record<string, unknown>;
  texts: Record<string, string>;
  files: Record<string, string>;
  checksumErrors: string[];
}

export type ArchiveError =
  | 'not_backup'
  | 'newer_schema'
  | 'corrupt'
  | 'bad_json';

export interface ParsedArchive {
  manifest: Manifest;
  life: BackupInput | null;
  planner: ReturnType<typeof sanitize> | null;
  /** Archive path → staged file uri. */
  staged: Record<string, string>;
  counts: {
    lifeProjects: number;
    lifeTasks: number;
    lifeReports: number;
    planProjects: number;
    planNodes: number;
    milestones: number;
  };
  /** Records the archive listed more than once (kept once). */
  duplicates: number;
  /** Planner nodes re-attached because their parent was missing or looped. */
  repaired: number;
}

function parseList(
  texts: Record<string, string>,
  path: string,
): unknown[] | 'bad' {
  const raw = texts[path];
  if (raw === undefined) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v : 'bad';
  } catch {
    return 'bad';
  }
}

const duplicateIds = (list: unknown[]) => {
  const ids = list
    .map(x => (x as { id?: unknown })?.id)
    .filter(id => typeof id === 'string');
  return ids.length - new Set(ids).size;
};

export function parseArchive(
  read: ReadArchive,
): { ok: true; value: ParsedArchive } | { ok: false; error: ArchiveError } {
  const m = read.manifest;
  if (m.format !== FULL_BACKUP_FORMAT)
    return { ok: false, error: 'not_backup' };
  if (
    typeof m.schemaVersion !== 'number' ||
    m.schemaVersion > FULL_BACKUP_SCHEMA
  ) {
    return { ok: false, error: 'newer_schema' };
  }
  if (read.checksumErrors.length) return { ok: false, error: 'corrupt' };
  const modules = (Array.isArray(m.modules) ? m.modules : []).filter(
    (x): x is BackupModule => x === 'manage-life' || x === 'long-term-planner',
  );
  const manifest: Manifest = {
    format: FULL_BACKUP_FORMAT,
    schemaVersion: m.schemaVersion,
    appVersion: typeof m.appVersion === 'string' ? m.appVersion : '',
    exportedAt: typeof m.exportedAt === 'string' ? m.exportedAt : '',
    modules,
    includesAttachments: m.includesAttachments === true,
    attachments: (Array.isArray(m.attachments) ? m.attachments : [])
      .map(a => a as { uri?: unknown; path?: unknown })
      .filter(a => typeof a.uri === 'string' && typeof a.path === 'string')
      .map(a => ({ uri: a.uri as string, path: a.path as string })),
  };

  let duplicates = 0;
  let life: BackupInput | null = null;
  if (modules.includes('manage-life')) {
    const lists = ['projects', 'tasks', 'reports', 'reviews'].map(n =>
      parseList(read.texts, `manage-life/${n}.json`),
    );
    if (lists.some(l => l === 'bad')) return { ok: false, error: 'bad_json' };
    const [projects, tasks, reports, reviews] = lists as unknown[][];
    duplicates += [projects, tasks, reports, reviews].reduce(
      (s, l) => s + duplicateIds(l),
      0,
    );
    life = { projects, tasks, reports, reviews };
  }

  let planner: ReturnType<typeof sanitize> | null = null;
  if (modules.includes('long-term-planner')) {
    const names = ['projects', 'nodes', 'statuses', 'categories', 'notes'];
    const lists = names.map(n =>
      parseList(read.texts, `long-term-planner/${n}.json`),
    );
    if (lists.some(l => l === 'bad')) return { ok: false, error: 'bad_json' };
    const [projects, nodes, statuses, categories, notes] = lists as unknown[][];
    duplicates += duplicateIds(projects) + duplicateIds(nodes);
    let settings: unknown = {};
    try {
      settings = read.texts['long-term-planner/settings.json']
        ? JSON.parse(read.texts['long-term-planner/settings.json'])
        : {};
    } catch {
      return { ok: false, error: 'bad_json' };
    }
    planner = sanitize({
      projects,
      nodes,
      statuses,
      categories,
      notes,
      settings,
    });
  }
  if (!life && !planner) return { ok: false, error: 'not_backup' };

  return {
    ok: true,
    value: {
      manifest,
      life,
      planner,
      staged: read.files,
      counts: {
        lifeProjects: life?.projects.length ?? 0,
        lifeTasks: life?.tasks.length ?? 0,
        lifeReports: life?.reports.length ?? 0,
        planProjects: planner?.projects.length ?? 0,
        planNodes: planner?.nodes.length ?? 0,
        milestones:
          planner?.nodes.filter((n: LongTermNode) => n.kind === 'milestone')
            .length ?? 0,
      },
      duplicates,
      repaired: planner?.repaired ?? 0,
    },
  };
}

/**
 * Original uri → restored uri, from the manifest's attachment table and the
 * native adopt result (staged uri → permanent uri).
 */
export function restoredUris(
  manifest: Manifest,
  staged: Record<string, string>,
  adopted: Record<string, string>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of manifest.attachments) {
    const stagedUri = staged[a.path];
    const finalUri = stagedUri ? adopted[stagedUri] : undefined;
    if (finalUri) map.set(a.uri, finalUri);
  }
  return map;
}

/** Rewrites picture/attachment uris; ones not restored are cleared. */
export function remapUris(
  parsed: ParsedArchive,
  map: Map<string, string>,
): ParsedArchive {
  const fix = (u: unknown) =>
    typeof u === 'string' && u.startsWith('file://') ? map.get(u) ?? '' : u;
  const life = parsed.life && {
    ...parsed.life,
    projects: parsed.life.projects.map(p => ({
      ...(p as object),
      imageUri: fix((p as { imageUri?: unknown }).imageUri),
    })),
    tasks: parsed.life.tasks.map(p => ({
      ...(p as object),
      imageUri: fix((p as { imageUri?: unknown }).imageUri),
    })),
  };
  const planner = parsed.planner && {
    ...parsed.planner,
    projects: parsed.planner.projects.map(p => ({
      ...p,
      imageUri: fix(p.imageUri) as string,
      coverUri: fix(p.coverUri) as string,
    })),
    nodes: parsed.planner.nodes.map(n => ({
      ...n,
      imageUri: fix(n.imageUri) as string,
      attachments: n.attachments
        .map(a => ({ ...a, uri: fix(a.uri) as string }))
        .filter(a => a.uri),
    })),
  };
  return { ...parsed, life, planner };
}

export function fullBackupFileName(now: Date, plannerOnly = false): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const d = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return plannerOnly
    ? `LongTermPlanner_${d}.json`
    : `ManageLife_Backup_${d}.zip`;
}
