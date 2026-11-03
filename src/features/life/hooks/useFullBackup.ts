import { useCallback, useRef, useState } from 'react';
import { logger } from '@/shared/utils';
import {
  FullBackupError,
  fullBackup,
  type FullRestoreSummary,
  type PendingArchive,
} from '../services/fullBackup.service';

export type FullBackupStatus =
  | { kind: 'idle' }
  | { kind: 'busy'; what: 'export' | 'plannerExport' | 'read' | 'restore' }
  | { kind: 'exported' }
  | { kind: 'review'; pending: PendingArchive }
  | { kind: 'restored'; mode: 'merge' | 'replace'; summary: FullRestoreSummary }
  | { kind: 'error'; code: string };

const codeOf = (e: unknown) =>
  e instanceof FullBackupError ? e.code : 'failed';

/** Full ZIP backup / planner JSON export / staged ZIP restore. */
export function useFullBackup() {
  const [status, setStatus] = useState<FullBackupStatus>({ kind: 'idle' });
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const busy = useRef(false);

  const run = useCallback(
    async (
      what: Extract<FullBackupStatus, { kind: 'busy' }>['what'],
      work: () => Promise<FullBackupStatus>,
    ) => {
      if (busy.current) return;
      busy.current = true;
      setStatus({ kind: 'busy', what });
      try {
        setStatus(await work());
      } catch (e) {
        logger.warn('full backup failed', codeOf(e));
        setStatus({ kind: 'error', code: codeOf(e) });
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  return {
    available: fullBackup.available(),
    status,
    includeAttachments,
    setIncludeAttachments,
    exportZip: () =>
      run('export', async () =>
        (await fullBackup.exportZip(includeAttachments))
          ? { kind: 'exported' }
          : { kind: 'idle' },
      ),
    exportPlanner: () =>
      run('plannerExport', async () =>
        (await fullBackup.exportPlannerJson())
          ? { kind: 'exported' }
          : { kind: 'idle' },
      ),
    choose: () =>
      run('read', async () => {
        const pending = await fullBackup.pick();
        return pending ? { kind: 'review', pending } : { kind: 'idle' };
      }),
    restore: (mode: 'merge' | 'replace') => {
      if (status.kind !== 'review') return;
      const { pending } = status;
      run('restore', async () => ({
        kind: 'restored',
        mode,
        summary: await fullBackup.apply(pending, mode),
      }));
    },
    cancel: () => {
      if (status.kind === 'review') fullBackup.cancel(status.pending);
      setStatus({ kind: 'idle' });
    },
  };
}
