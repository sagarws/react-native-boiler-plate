import NativeLifeBackup from '@/specs/NativeLifeBackup';
import { appVersion, logger } from '@/shared/utils';
import { pickZip } from '@/shared/utils/pickFile';
import {
  plannerStore,
  type PlannerRestoreSummary,
} from '../planner/store/planner.store';
import { lifeStore, type RestoreSummary } from '../store/life.store';
import {
  buildArchive,
  fullBackupFileName,
  parseArchive,
  plannerJson,
  remapUris,
  restoredUris,
  type ParsedArchive,
  type ReadArchive,
} from './fullBackup';

export class FullBackupError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface PendingArchive {
  parsed: ParsedArchive;
  stageId: string;
}

export interface FullRestoreSummary {
  life: RestoreSummary | null;
  planner: PlannerRestoreSummary | null;
  attachments: number;
}

const codeOf = (e: unknown) => (e as { code?: string })?.code || 'failed';

function need() {
  if (!NativeLifeBackup) throw new FullBackupError('unavailable');
  return NativeLifeBackup;
}

/**
 * Full Manage Life backup: one ZIP with Manage Life and Long-Term Planner
 * JSON (+ optional attachments), and the matching staged restore.
 */
export const fullBackup = {
  available: (): boolean => NativeLifeBackup != null,

  /** Full backup (both modules). Resolves false when cancelled. */
  async exportZip(
    includeAttachments: boolean,
    now: Date = new Date(),
  ): Promise<boolean> {
    const { manifest, entries } = buildArchive(
      lifeStore.read(),
      plannerStore.read(),
      {
        includeAttachments,
        appVersion,
        exportedAt: now,
      },
    );
    try {
      return await need().saveZip(
        fullBackupFileName(now),
        JSON.stringify(manifest),
        JSON.stringify(entries),
      );
    } catch (e) {
      logger.warn('full backup export failed', codeOf(e));
      throw new FullBackupError('export_failed');
    }
  },

  /** Long-Term Planner only, as one JSON file. */
  async exportPlannerJson(now: Date = new Date()): Promise<boolean> {
    try {
      return await need().saveText(
        fullBackupFileName(now, true),
        'application/json',
        plannerJson(plannerStore.read(), appVersion, now),
      );
    } catch (e) {
      logger.warn('planner export failed', codeOf(e));
      throw new FullBackupError('export_failed');
    }
  },

  /** Picks and validates a backup; nothing changes yet. Null when cancelled. */
  async pick(): Promise<PendingArchive | null> {
    const native = need();
    const file = await pickZip();
    if (!file) return null;
    let read: ReadArchive;
    try {
      read = JSON.parse(await native.readZip(file.uri)) as ReadArchive;
    } catch (e) {
      const code = codeOf(e);
      logger.warn('full backup read failed', code);
      throw new FullBackupError(
        [
          'unsafe_entry',
          'duplicate_entry',
          'too_large',
          'no_manifest',
          'bad_manifest',
        ].includes(code)
          ? code
          : 'not_zip',
      );
    }
    const parsed = parseArchive(read);
    if (!parsed.ok) {
      native.discardStaged(read.stageId);
      throw new FullBackupError(parsed.error);
    }
    return { parsed: parsed.value, stageId: read.stageId };
  },

  /** Drops a previewed backup (deletes its staged files). */
  cancel(pending: PendingArchive) {
    NativeLifeBackup?.discardStaged(pending.stageId);
  },

  /**
   * Applies a previewed backup. Attachments are moved into app storage
   * first and their uris rewritten; then Manage Life and the planner are
   * restored. If the planner step fails, Manage Life is rolled back to its
   * state from just before, so a failure never leaves half a restore.
   */
  async apply(
    pending: PendingArchive,
    mode: 'merge' | 'replace',
  ): Promise<FullRestoreSummary> {
    const native = need();
    let adopted: Record<string, string> = {};
    if (Object.keys(pending.parsed.staged).length) {
      adopted = JSON.parse(await native.adoptStaged(pending.stageId)) as Record<
        string,
        string
      >;
    } else {
      native.discardStaged(pending.stageId);
    }
    const uris = restoredUris(
      pending.parsed.manifest,
      pending.parsed.staged,
      adopted,
    );
    const parsed = remapUris(pending.parsed, uris);

    const lifeBefore = lifeStore.read();
    let life: RestoreSummary | null = null;
    let planner: PlannerRestoreSummary | null = null;
    if (parsed.life) life = lifeStore.restore(parsed.life, mode);
    try {
      if (parsed.planner) planner = plannerStore.restore(parsed.planner, mode);
    } catch (e) {
      if (parsed.life) {
        lifeStore.restore(
          {
            projects: lifeBefore.projects,
            tasks: lifeBefore.tasks,
            reports: lifeBefore.reports,
            reviews: lifeBefore.reviews,
          },
          'replace',
        );
      }
      logger.error('full restore failed; rolled back', codeOf(e));
      throw new FullBackupError('restore_failed');
    }
    return { life, planner, attachments: uris.size };
  },
};
