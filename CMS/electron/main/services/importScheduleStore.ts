import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'

/**
 * Two timestamps the scheduler needs to survive a restart.
 *
 * `baselineAt` is when this machine first saw a schedule; `lastRunAt` is when an
 * import last completed. Together they answer "is a run owed?" without which
 * the scheduler either fires on install or never fires at all.
 *
 * Stored through JsonCollection rather than a bespoke file so it inherits the
 * atomic write and serialised mutations the other stores already use. A
 * single-record array is the shape that buys, and the cost is one wrapper.
 */
export interface ImportScheduleRecord {
  baselineAt?: number
  lastRunAt?: number
  /**
   * Per-platform last run and failure count, keyed by platform.
   *
   * Each platform has its OWN scheduled time, so one shared `lastRunAt` cannot
   * express the state: with ajio at 02:00 and myntra at 06:00, recording ajio's
   * run would tell the scheduler myntra had run too, and myntra would be
   * skipped until the next day.
   *
   * `lastRunAt` / `failedAttempts` below remain for the older single-time form
   * and for reading a record written by a previous version.
   */
  platforms?: Record<string, { lastRunAt?: number; failedAttempts?: number }>
  /**
   * Failed attempts at the CURRENT due window.
   *
   * A scheduled run that fails must not simply be retried forever: the tick is
   * a minute, so an import that cannot succeed produces a failure a minute
   * until someone notices. Counted here rather than in memory so a restart does
   * not reset the count and start the loop over.
   */
  failedAttempts?: number
}

let collection: JsonCollection<ImportScheduleRecord> | null = null

export const initialiseImportScheduleStore = (): void => {
  collection = new JsonCollection<ImportScheduleRecord>({
    name: 'import-schedule',
    directory: dataDirectory()
  })
}

const store = (): JsonCollection<ImportScheduleRecord> => {
  if (!collection) throw new Error('Import schedule store used before initialisation')

  return collection
}

export const readScheduleRecord = async (): Promise<ImportScheduleRecord> => {
  const records = await store().read()

  return records[0] ?? {}
}

export const writeScheduleRecord = async (patch: ImportScheduleRecord): Promise<void> => {
  await store().mutate(records => {
    const current = records[0] ?? {}

    return { records: [{ ...current, ...patch }], result: undefined }
  })
}
