import { useCallback, useRef, useState } from 'react';
import { logger } from '@/shared/utils';
import {
  BackupError,
  lifeBackup,
  type PendingImport,
} from '../services/backup.service';
import type { RestoreMode, RestoreSummary } from '../store/life.store';

export type BackupStatus =
  | { kind: 'idle' }
  | { kind: 'exporting' }
  | { kind: 'exported' }
  | { kind: 'reading' }
  | { kind: 'review'; pending: PendingImport }
  | { kind: 'imported'; mode: RestoreMode; summary: RestoreSummary }
  | { kind: 'error'; code: string };

export interface UseLifeBackup {
  available: boolean;
  status: BackupStatus;
  exportBackup: () => Promise<void>;
  /** Picks a file and shows what it contains (nothing changes yet). */
  chooseBackup: () => Promise<void>;
  /** Applies the reviewed backup. */
  restore: (mode: RestoreMode) => void;
  reset: () => void;
}

const codeOf = (error: unknown) =>
  error instanceof BackupError ? error.code : 'failed';

/**
 * Backup & restore for Manage Life: export everything to an .xlsx, or pick
 * one, review its counts, then merge it in or replace the current data.
 */
export function useLifeBackup(): UseLifeBackup {
  const [status, setStatus] = useState<BackupStatus>({ kind: 'idle' });
  const busy = useRef(false);

  const run = useCallback(async (work: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await work();
    } catch (error) {
      logger.warn('life backup failed', codeOf(error));
      setStatus({ kind: 'error', code: codeOf(error) });
    } finally {
      busy.current = false;
    }
  }, []);

  const exportBackup = useCallback(
    () =>
      run(async () => {
        setStatus({ kind: 'exporting' });
        const saved = await lifeBackup.exportToFile();
        setStatus(saved ? { kind: 'exported' } : { kind: 'idle' });
      }),
    [run],
  );

  const chooseBackup = useCallback(
    () =>
      run(async () => {
        setStatus({ kind: 'reading' });
        const pending = await lifeBackup.pickBackup();
        setStatus(pending ? { kind: 'review', pending } : { kind: 'idle' });
      }),
    [run],
  );

  const restore = useCallback(
    (mode: RestoreMode) => {
      if (status.kind !== 'review') return;
      try {
        const summary = lifeBackup.apply(status.pending, mode);
        setStatus({ kind: 'imported', mode, summary });
      } catch (error) {
        logger.warn('life restore failed', codeOf(error));
        setStatus({ kind: 'error', code: 'restore_failed' });
      }
    },
    [status],
  );

  return {
    available: lifeBackup.available(),
    status,
    exportBackup,
    chooseBackup,
    restore,
    reset: () => setStatus({ kind: 'idle' }),
  };
}
