import type { ScheduledRunArchive } from '@shared/types/automationSchedule'
import { recordsJob } from '@shared/constants/jobs'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Finished scheduled runs, kept on this machine — one record per window.
 *
 * Mirrors refillArchive.store: same collection shape, same bound, same
 * never-throws contract. An archive is a record OF work, never part of it, so a
 * failed write here must not fail a run whose claims are already filed.
 */

const COLLECTION = 'scheduled-run-jobs'

/** The newest runs kept; older ones fall off. Four tasks a night is roughly seven weeks. */
const MAX_JOBS = 200

let collection: JsonCollection<ScheduledRunArchive> | null = null

export const initialiseScheduledRunArchive = (): void => {
  collection = new JsonCollection<ScheduledRunArchive>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<ScheduledRunArchive> | null => collection

/** Every scheduled run, newest first. */
export const readScheduledRuns = async (): Promise<ScheduledRunArchive[]> => {
  const records = await (store()
    ?.read()
    .catch(() => [] as ScheduledRunArchive[]) ?? Promise.resolve([] as ScheduledRunArchive[]))

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

export const readScheduledRun = async (jobId: string): Promise<ScheduledRunArchive | null> =>
  (await readScheduledRuns()).find(record => record.jobId === jobId) ?? null

/** Adds or replaces one run, then keeps the newest MAX_JOBS. Never throws. */
export const writeScheduledRun = async (archive: ScheduledRunArchive): Promise<void> => {
  if (!recordsJob('scheduled-run')) return

  const target = store()

  if (!target) {
    logger.warn(`[schedule] run ${archive.jobId} was not archived — the store is not open`)

    return
  }

  await target
    .mutate(records => {
      const next = [...records.filter(record => record.jobId !== archive.jobId), archive]
        .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
        .slice(0, MAX_JOBS)

      return { records: next, result: undefined }
    })
    .catch(error => logger.warn(`[schedule] could not archive run ${archive.jobId}`, error))
}

/**
 * Throw this history away. An operator's decision, never the app's.
 *
 * ONE KIND AT A TIME is the whole point: "Scheduled" is a run the operator can
 * name, and clearing everything to be rid of one noisy list is how the record
 * of a run somebody still needs gets lost. The page clears what it is filtered
 * to, so what goes is what is on screen.
 *
 * Returns what it removed rather than nothing, so the confirmation can say how
 * many — "cleared" over an already-empty list reads as a failure.
 *
 * Never throws: the archive is a record OF work, never part of it.
 */
export const clearScheduledRuns = async (): Promise<number> => {
  const open = store()

  if (!open) return 0

  try {
    // Counted before it goes, so the confirmation can say how many — "cleared"
    // over an already-empty list reads as a failure.
    const existing = await open.read()

    await open.clear()

    return existing.length
  } catch (error) {
    logger.warn('Could not clear the Scheduled history', error)

    return 0
  }
}
