import type { BulkJobArchive, BulkSpfRun } from '@shared/types/bulkSpf'
import { attemptOf } from '@shared/types/bulkSpf'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished bulk-claim jobs, kept on this machine — one record per job id.
 *
 * TrackVid keeps each job's counts and the AWBs it did not file (`scriptjobs`).
 * The TICKETS it raised live here instead: they are what the job's .xlsx report
 * lists under Success, and this is the machine that raised them.
 *
 * Separate from `bulkSpf.store`, which holds only the current run: that one is
 * replaced when the next run starts, and a history must not be.
 *
 * Bounded. A job is a deliberate, occasional act, but hundreds of rows each, and
 * a store nobody prunes grows until the app reads it slowly on every open.
 */

const COLLECTION = 'bulk-spf-jobs'

/** The newest jobs kept; older ones fall off. */
const MAX_JOBS = 200

/** Outcomes that mean the article was not filed. */
const UNFILED = new Set(['Failed', 'Help Center Failed', 'Not Claimable', 'Skipped'])

/** A finished run → its archive record. Pure, exported for tests. */
export const archiveFromRun = (run: BulkSpfRun): BulkJobArchive => ({
  jobId: run.id,
  status: run.status === 'failed' ? 'failed' : 'done',
  startedAt: run.startedAt,
  finishedAt: run.finishedAt,
  error: run.error,
  accounts: run.accounts,
  fileNames: run.uploads.map(upload => `${upload.claimType}: ${upload.fileName}`),
  // The same two numbers the server's report opens with: distinct returns in the
  // uploads, and the article rows they became.
  inputAwbs: new Set(run.rows.map(row => row.awb).filter(Boolean)).size,
  claimRows: run.rows.length,
  summary: run.summary,
  tickets: run.rows
    .filter(row => row.result === 'Success')
    .map(row => ({ awb: row.awb, sku: row.sku, ticketId: row.ticketNumber, attempt: attemptOf(row) })),
  unfiled: run.rows
    .filter(row => UNFILED.has(row.result))
    .map(row => ({
      awb: row.awb,
      sku: row.sku,
      result: row.result,
      reason: row.error || row.reason,
      attempt: attemptOf(row)
    }))
})

let collection: JsonCollection<BulkJobArchive> | null = null

export const initialiseBulkJobArchive = (): void => {
  collection = new JsonCollection<BulkJobArchive>({ name: COLLECTION, directory: dataDirectory() })
}

const store = (): JsonCollection<BulkJobArchive> => {
  if (!collection) throw new Error('Bulk job archive used before initialiseBulkJobArchive()')

  return collection
}

/** Every archived job, newest first. For the Jobs page's list. */
export const readJobArchives = async (): Promise<BulkJobArchive[]> => {
  const records = await store()
    .read()
    .catch(() => [] as BulkJobArchive[])

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export const readJobArchive = async (jobId: string): Promise<BulkJobArchive | null> => {
  const records = await store()
    .read()
    .catch(() => [] as BulkJobArchive[])

  return records.find(record => record.jobId === jobId) ?? null
}

/** Adds or replaces one job, then keeps the newest MAX_JOBS. Never throws. */
export const writeJobArchive = async (archive: BulkJobArchive): Promise<void> => {
  await store()
    .mutate(records => {
      const next = [...records.filter(record => record.jobId !== archive.jobId), archive]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => {
      // The claims are filed and the run's own report is on disk; losing the
      // archive entry costs History its ticket list, not the tickets.
      logger.warn(`[bulk-spf] could not archive job ${archive.jobId}`, error)
    })
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * ONE KIND AT A TIME is the whole point: "AJIO bulk claim" is a run the operator can
 * name, and clearing everything to be rid of one noisy list is how the record
 * of a run somebody still needs gets lost. The page clears what it is filtered
 * to, so what goes is what is on screen.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 *
 * Never throws: the archive is a record OF work, never part of it.
 */
export const clearBulkJobArchives = async (): Promise<number> => {
  const open = store()

  if (!open) return 0

  try {
    // Counted before it goes, so the confirmation can say how many — "cleared"
    // over an already-empty list reads as a failure.
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the AJIO bulk claim history', error)

    return 0
  }
}
