import type { BulkSpfRun } from '@shared/types/bulkSpf'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'
import { archiveFromRun, writeJobArchive } from './bulkSpfArchive.store'

/**
 * The bulk claim run, on disk.
 *
 * Persisted for the same reason the claim queue is: a run takes hours, and an
 * operator who closes the app — or loses power — halfway through must be able
 * to see what was filed. The rows are the only record this machine holds of
 * tickets it raised at AJIO; losing them means the next run cannot tell what it
 * already did except by asking AJIO one return at a time.
 *
 * One run is kept. A bulk claim is a deliberate, occasional act, not a stream,
 * and keeping a history of them would grow a file nobody reads. Starting a new
 * run replaces the old one, which is also what makes "the current run" a
 * question with one answer.
 */

const COLLECTION = 'bulk-spf-run'
const KEY = 'current'

interface StoredRun extends BulkSpfRun {
  key: string
}

let collection: JsonCollection<StoredRun> | null = null

export const initialiseBulkSpfStore = (): void => {
  collection = new JsonCollection<StoredRun>({ name: COLLECTION, directory: dataDirectory() })
}

const store = (): JsonCollection<StoredRun> => {
  if (!collection) throw new Error('Bulk SPF store used before initialiseBulkSpfStore()')

  return collection
}

export const readRun = async (): Promise<BulkSpfRun | null> => {
  const records = await store()
    .read()
    .catch(() => [] as StoredRun[])

  return records.find(record => record.key === KEY) ?? null
}

export const writeRun = async (run: BulkSpfRun): Promise<void> => {
  await store()
    .mutate(records => ({
      records: [...records.filter(record => record.key !== KEY), { ...run, key: KEY }],
      result: undefined
    }))
    .catch(error => {
      // Non-fatal: the run itself is what matters, and failing a claim that was
      // filed at AJIO because its progress could not be saved would be the
      // wrong trade. The report on disk is the durable copy.
      logger.warn('[bulk-spf] could not persist run progress', error)
    })
}

/**
 * Marks a run left mid-flight by a crash.
 *
 * This process holds the single-instance lock, so a run still marked `running`
 * when the store is first read cannot be running — there is nobody to be
 * running it. Same reasoning as `recoverInterruptedRuns` for single claims, and
 * it is exact rather than a timeout guess.
 */
export const recoverInterruptedRun = async (): Promise<void> => {
  const run = await readRun()

  if (!run || (run.status !== 'running' && run.status !== 'preparing')) return

  logger.warn(`[bulk-spf] run ${run.id} was interrupted — marking it stopped`)

  const stopped: BulkSpfRun = {
    ...run,
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error:
      'The app stopped before this run finished. Claims already filed are in the report; ' +
      're-upload the same files to claim the rest.'
  }

  await writeRun(stopped)
  // Its tickets so far still belong in History.
  await writeJobArchive(archiveFromRun(stopped))
}
