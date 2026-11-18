import type { BackupJobArchive } from '@shared/types/masterBackup'
import { recordsJob } from '@shared/constants/jobs'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished AJIO backups, kept on this machine — one record per run.
 *
 * WHY KEEP ANYTHING, when the rows are already stored? Because the stored rows
 * cannot answer "did last night's job run, and did it find anything". Coverage
 * says what is held; it says nothing about the attempt. A daily re-sync that
 * has been failing for a week looks exactly like a week with no new data until
 * somebody can see the runs.
 *
 * Mirrors refillArchive.store: same collection shape, same bound, same
 * never-throws contract — an archive is a record OF work, never part of it, and
 * a backup whose rows are already on disk must not fail over its bookkeeping.
 */

const COLLECTION = 'ajio-backup-jobs'

/** The newest runs kept; older ones fall off. */
const MAX_JOBS = 200

let collection: JsonCollection<BackupJobArchive> | null = null

export const initialiseBackupArchive = (): void => {
  collection = new JsonCollection<BackupJobArchive>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<BackupJobArchive> | null => collection

/** Every run, newest first. */
export const readBackupJobs = async (): Promise<BackupJobArchive[]> => {
  const records = await (store()
    ?.read()
    .catch(() => [] as BackupJobArchive[]) ?? Promise.resolve([] as BackupJobArchive[]))

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

/**
 * Adds or replaces one run, then keeps the newest MAX_JOBS. Never throws.
 *
 * The switch is read HERE, at the end of the run, so a machine that must not
 * keep operator history can stop keeping it without changing what a backup
 * does — see shared/constants/jobs.ts.
 */
export const saveBackupJob = async (archive: BackupJobArchive): Promise<void> => {
  if (!recordsJob('ajio-master-backup')) return

  const target = store()

  if (!target) return

  await target
    .mutate(records => {
      const rest = records.filter(record => record.jobId !== archive.jobId)
      const next = [archive, ...rest]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => logger.warn(`[ajio-backup] could not record job ${archive.jobId}`, error))
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * ONE KIND AT A TIME is the whole point: "Master data backup" is a run the operator can
 * name, and clearing everything to be rid of one noisy list is how the record
 * of a run somebody still needs gets lost. The page clears what it is filtered
 * to, so what goes is what is on screen.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 *
 * Never throws: the archive is a record OF work, never part of it.
 */
export const clearBackupJobs = async (): Promise<number> => {
  const open = store()

  if (!open) return 0

  try {
    // Counted before it goes, so the confirmation can say how many — "cleared"
    // over an already-empty list reads as a failure.
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the Master data backup history', error)

    return 0
  }
}
