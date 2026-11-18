import type { RefillJobArchive } from '@shared/types/refill'
import { recordsJob } from '@shared/constants/jobs'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished Refill Data runs, kept on this machine — one record per run.
 *
 * THIS IS THE ONLY RECORD. A refill writes its answers onto the claims and tells
 * TrackVid nothing about the run itself, so without this there is no way to
 * answer "what did that run actually change" once the window is closed — which
 * is precisely the question asked when a row looks wrong the next day.
 *
 * Mirrors reClaimArchive.store: same collection shape, same bound, same
 * never-throws contract. A failed archive write must not fail a run whose
 * answers are already on the claims.
 */

const COLLECTION = 'refill-jobs'

/** The newest runs kept; older ones fall off. */
const MAX_JOBS = 200

let collection: JsonCollection<RefillJobArchive> | null = null

export const initialiseRefillArchive = (): void => {
  collection = new JsonCollection<RefillJobArchive>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

/**
 * Null until the app initialises it.
 *
 * Reads and writes treat that as "no history", not as an error: the archive is
 * a record OF work, never part of it, and a run whose answers are already on
 * the claims must not fail because the store was not ready.
 */
const store = (): JsonCollection<RefillJobArchive> | null => collection

/** Every run, newest first. */
export const readRefillJobs = async (): Promise<RefillJobArchive[]> => {
  const records = await (store()
    ?.read()
    .catch(() => [] as RefillJobArchive[]) ?? Promise.resolve([] as RefillJobArchive[]))

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export const readRefillJob = async (jobId: string): Promise<RefillJobArchive | null> => {
  const records = await readRefillJobs()

  return records.find(record => record.jobId === jobId) ?? null
}

/**
 * Adds or replaces one run, then keeps the newest MAX_JOBS. Never throws.
 *
 * Checked against JOB_RECORDING here rather than at the call site, so a kind
 * turned off is off wherever it is written from.
 */
export const writeRefillJob = async (archive: RefillJobArchive): Promise<void> => {
  if (!recordsJob('refill-data')) return

  const collection = store()

  if (!collection) {
    logger.warn(`[refill-data. run ${archive.jobId} was not archived — the store is not open`)

    return
  }

  await collection
    .mutate(records => {
      const next = [...records.filter(record => record.jobId !== archive.jobId), archive]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => {
      logger.warn(`[refill-data. could not archive run ${archive.jobId}`, error)
    })
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * ONE KIND AT A TIME is the whole point: "Refill Data" is a run the operator can
 * name, and clearing everything to be rid of one noisy list is how the record
 * of a run somebody still needs gets lost. The page clears what it is filtered
 * to, so what goes is what is on screen.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 *
 * Never throws: the archive is a record OF work, never part of it.
 */
export const clearRefillJobs = async (): Promise<number> => {
  const open = store()

  if (!open) return 0

  try {
    // Counted before it goes, so the confirmation can say how many — "cleared"
    // over an already-empty list reads as a failure.
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the Refill Data history', error)

    return 0
  }
}
