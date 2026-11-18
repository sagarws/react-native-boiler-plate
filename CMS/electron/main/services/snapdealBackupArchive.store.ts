import type { SnapdealJobArchive } from '@shared/types/snapdealBackup'
import { recordsJob } from '@shared/constants/jobs'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished Snapdeal backup passes, kept on this machine — one record per run.
 *
 * Mirrors `masterBackupArchive.store`: same collection shape, same bound, same
 * never-throws contract. An archive is a record OF work, never part of it, and
 * a pass whose rows are already on disk must not fail over its bookkeeping.
 *
 * It earns its place more here than it does for AJIO. A Snapdeal pass can
 * legitimately store nothing — every report it asked for may still be
 * building — so "did last night's pass run" cannot be answered from the rows
 * at all. The request table says what is outstanding; this says whether
 * anything went looking.
 */

const COLLECTION = 'snapdeal-backup-jobs'

/** The newest runs kept; older ones fall off. */
const MAX_JOBS = 200

let collection: JsonCollection<SnapdealJobArchive> | null = null

export const initialiseSnapdealBackupArchive = (): void => {
  collection = new JsonCollection<SnapdealJobArchive>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

/** Every run, newest first. */
export const readSnapdealBackupJobs = async (): Promise<SnapdealJobArchive[]> => {
  const records = await (collection
    ?.read()
    .catch(() => [] as SnapdealJobArchive[]) ?? Promise.resolve([] as SnapdealJobArchive[]))

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

/** Adds or replaces one run, then keeps the newest MAX_JOBS. Never throws. */
export const saveSnapdealBackupJob = async (archive: SnapdealJobArchive): Promise<void> => {
  if (!recordsJob('snapdeal-master-backup')) return

  const target = collection

  if (!target) return

  await target
    .mutate(records => {
      const rest = records.filter(record => record.jobId !== archive.jobId)
      const next = [archive, ...rest]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => logger.warn(`[snapdeal-backup] could not record job ${archive.jobId}`, error))
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 */
export const clearSnapdealBackupJobs = async (): Promise<number> => {
  const open = collection

  if (!open) return 0

  try {
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the Snapdeal report sync history', error)

    return 0
  }
}
