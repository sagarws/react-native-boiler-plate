import type { ReClaimJobArchive } from '@shared/types/reClaim'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished Myntra re-claim jobs, kept on this machine — one record per job id.
 *
 * THIS IS THE ONLY RECORD. A bulk claim's counts also live in TrackVid's
 * `scriptjobs`, so its archive here is a supplement; a re-claim is raised
 * straight at Myntra with nothing in between, and TrackVid never hears about
 * it. Lose this file and there is no answer to "which tickets did we dispute,
 * and what did Myntra say" short of opening the portal one ticket at a time.
 *
 * Mirrors bulkSpfArchive.store: same collection shape, same bound, same
 * never-throws contract — a failed archive write must not fail disputes that
 * were already raised.
 */

const COLLECTION = 're-claim-jobs'

/** The newest jobs kept; older ones fall off. */
const MAX_JOBS = 200

let collection: JsonCollection<ReClaimJobArchive> | null = null

export const initialiseReClaimArchive = (): void => {
  collection = new JsonCollection<ReClaimJobArchive>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<ReClaimJobArchive> => {
  if (!collection) throw new Error('Re-claim archive used before initialiseReClaimArchive()')

  return collection
}

/** Every job, newest first. */
export const readReClaimJobs = async (): Promise<ReClaimJobArchive[]> => {
  const records = await store()
    .read()
    .catch(() => [] as ReClaimJobArchive[])

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export const readReClaimJob = async (jobId: string): Promise<ReClaimJobArchive | null> => {
  const records = await readReClaimJobs()

  return records.find(record => record.jobId === jobId) ?? null
}

/** Adds or replaces one job, then keeps the newest MAX_JOBS. Never throws. */
export const writeReClaimJob = async (archive: ReClaimJobArchive): Promise<void> => {
  await store()
    .mutate(records => {
      const next = [...records.filter(record => record.jobId !== archive.jobId), archive]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => {
      logger.warn(`[re-claim] could not archive job ${archive.jobId}`, error)
    })
}

/**
 * Marks a job left mid-flight by a crash.
 *
 * This process holds the single-instance lock, so a job still marked `running`
 * when the store is first read cannot be running — there is nobody to be
 * running it. The same reasoning as `recoverInterruptedRun` for the bulk claim,
 * and exact rather than a timeout guess.
 *
 * The disputes it had already raised stay in the record. They were raised;
 * Myntra is re-validating them whatever happened to this app.
 */
export const recoverInterruptedReClaims = async (): Promise<void> => {
  const running = (await readReClaimJobs()).filter(job => job.status === 'running')

  for (const job of running) {
    logger.warn(`[re-claim] job ${job.jobId} was interrupted — marking it stopped`)

    await writeReClaimJob({
      ...job,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error:
        'The app stopped before this run finished. The disputes already raised are listed ' +
        'below; the rest were never sent.'
    })
  }
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * ONE KIND AT A TIME is the whole point: "Myntra re-claim" is a run the operator can
 * name, and clearing everything to be rid of one noisy list is how the record
 * of a run somebody still needs gets lost. The page clears what it is filtered
 * to, so what goes is what is on screen.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 *
 * Never throws: the archive is a record OF work, never part of it.
 */
export const clearReClaimJobs = async (): Promise<number> => {
  const open = store()

  if (!open) return 0

  try {
    // Counted before it goes, so the confirmation can say how many — "cleared"
    // over an already-empty list reads as a failure.
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the Myntra re-claim history', error)

    return 0
  }
}
