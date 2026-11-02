import NativeLifeBackup from '@/specs/NativeLifeBackup';
import { logger } from '@/shared/utils';
import { pickSpreadsheet } from '@/shared/utils/pickFile';
import {
  lifeStore,
  type BackupInput,
  type RestoreMode,
  type RestoreSummary,
} from '../store/life.store';
import {
  backupCounts,
  backupFileName,
  fromSheets,
  toSheets,
  type SheetData,
} from './backup';

export class BackupError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface PendingImport {
  input: BackupInput;
  counts: ReturnType<typeof backupCounts>;
  /** When the backup was made (ISO), if the file says. */
  exportedAt: string | null;
}

const codeOf = (error: unknown) =>
  (error as { code?: string })?.code || 'failed';

function need() {
  if (!NativeLifeBackup) throw new BackupError('unavailable');
  return NativeLifeBackup;
}

/**
 * Manage Life backup to / from an Excel (.xlsx) file. Export writes every
 * project, task, target, pause, progress entry and review; import reads
 * such a file back and restores it through the store (validated, merged or
 * replaced). Files go only where the user picks; contents are never logged.
 */
export const lifeBackup = {
  available: (): boolean => NativeLifeBackup != null,

  /** Resolves true when saved, false when the user cancelled. */
  async exportToFile(now: Date = new Date()): Promise<boolean> {
    const sheets = toSheets(lifeStore.read(), now);
    try {
      return await need().saveWorkbook(
        backupFileName(now),
        JSON.stringify(sheets),
      );
    } catch (error) {
      logger.warn('life export failed', codeOf(error));
      throw new BackupError(
        codeOf(error) === 'unavailable' ? 'unavailable' : 'export_failed',
      );
    }
  },

  /** Picks and reads a backup; null when the user cancelled the picker. */
  async pickBackup(): Promise<PendingImport | null> {
    const native = need();
    const file = await pickSpreadsheet();
    if (!file) return null;
    let sheets: SheetData[];
    try {
      sheets = JSON.parse(await native.readWorkbook(file.uri)) as SheetData[];
    } catch (error) {
      const code = codeOf(error);
      logger.warn('life import read failed', code);
      throw new BackupError(code === 'too_large' ? 'too_large' : 'not_xlsx');
    }
    const parsed = fromSheets(Array.isArray(sheets) ? sheets : []);
    if (!parsed.ok) throw new BackupError(parsed.error);
    return {
      input: parsed.input,
      counts: backupCounts(parsed.input),
      exportedAt: parsed.exportedAt,
    };
  },

  apply(pending: PendingImport, mode: RestoreMode): RestoreSummary {
    return lifeStore.restore(pending.input, mode);
  },
};
