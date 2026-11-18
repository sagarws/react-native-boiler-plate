import { randomUUID } from 'node:crypto'
import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import type { CronLogEntry, CronLogLevel } from '@shared/types/cronLog'
import { AUTOMATION_SCHEDULE_EVENTS } from '@shared/constants/channels'
import { broadcast } from '../ipc/broadcast'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { getPreferences } from './preferences.service'
import { logger } from './logger'

/**
 * The scheduler's activity log — what it did, and what it decided not to do.
 *
 * TWO PLACES AT ONCE, on purpose:
 *
 *   IN MEMORY, always. The log has to work on an ordinary machine with nothing
 *   switched on, because the question it answers — "what is it doing right
 *   now?" — is asked while the app is open. Bounded, so a machine left running
 *   for a fortnight cannot grow it without limit.
 *
 *   ON DISK, only in developer mode. Persisting every decision for every user
 *   would write a file nobody reads, on a schedule that ticks once a minute. In
 *   developer mode it is kept so yesterday's run can be read after a restart,
 *   which is the case it exists for.
 *
 * ITS OWN COLLECTION, separate from `cron-history-<task>`. Those are the RUNS,
 * one row each, and the scheduler reads them to make decisions. This is the
 * narration, many lines per run, and nothing reads it but a person.
 *
 * Never throws. A log is a record OF work, never part of it.
 */

const COLLECTION = 'cron-activity-log'

/** Kept in memory. Roughly a day of ticks, and every line of four runs. */
const MEMORY_LIMIT = 400

/** Kept on disk in developer mode. Enough to read back over a long weekend. */
const DISK_LIMIT = 2000

let collection: JsonCollection<CronLogEntry> | null = null

/** Newest last, so appending is cheap and the UI reverses once. */
const recent: CronLogEntry[] = []

export const initialiseCronLog = (): void => {
  collection = new JsonCollection<CronLogEntry>({
    name: COLLECTION,
    directory: dataDirectory()
  })
}

/** Developer mode decides whether the log outlives the process. */
const persists = (): boolean => {
  try {
    return getPreferences().devMode === true
  } catch {
    // Preferences not open yet — in memory only, which is the safe default.
    return false
  }
}

/**
 * Writes one line.
 *
 * Also goes to the app log, because the two audiences are different and both
 * are real: this list is for somebody watching the app, and `main.log` is for
 * whoever is sent the file afterwards.
 */
export const cronLog = (
  level: CronLogLevel,
  label: string,
  message: string,
  options: { taskId?: ScheduledTaskId | null; detail?: string | null } = {}
): void => {
  const entry: CronLogEntry = {
    id: randomUUID(),
    at: new Date().toISOString(),
    taskId: options.taskId ?? null,
    label,
    level,
    message,
    detail: options.detail ?? null
  }

  recent.push(entry)

  if (recent.length > MEMORY_LIMIT) recent.splice(0, recent.length - MEMORY_LIMIT)

  // Live, so the modal fills in while somebody is watching it rather than only
  // when they reopen it.
  broadcast(AUTOMATION_SCHEDULE_EVENTS.log, entry)

  const line = `[SCHEDULER] ${label}: ${message}${entry.detail ? ` — ${entry.detail}` : ''}`

  if (level === 'failure') logger.error(line)
  else if (level === 'blocked' || level === 'waiting' || level === 'partial') logger.warn(line)
  else logger.info(line)

  if (!persists() || !collection) return

  void collection
    .mutate(records => ({
      records: [...records, entry].slice(-DISK_LIMIT),
      result: undefined
    }))
    .catch(error => logger.warn('[SCHEDULER] could not persist a log line', error))
}

/**
 * The log, newest first.
 *
 * Merges what is on disk with what this process has said, because the two
 * differ in developer mode only by what happened before the last restart — and
 * de-duplicating by id costs nothing and stops a line appearing twice.
 */
export const readCronLog = async (): Promise<CronLogEntry[]> => {
  const stored = persists()
    ? await (collection?.read().catch(() => [] as CronLogEntry[]) ??
        Promise.resolve([] as CronLogEntry[]))
    : []

  const byId = new Map<string, CronLogEntry>()

  for (const entry of [...stored, ...recent]) byId.set(entry.id, entry)

  /*
   * REVERSED BEFORE SORTING, and it is not a flourish.
   *
   * The scheduler writes several lines in the same millisecond — "due", then
   * "started", then the run's own lines — so their timestamps TIE. Array.sort
   * is stable, which means a tie keeps the order it was given, and the map is
   * in insertion order: oldest first. Sorting that by descending time leaves
   * every tied group upside down, so a run reads "Completed, Started, Due".
   *
   * Reversing first makes the input newest-first, and the stable sort then
   * keeps tied lines that way round.
   */
  return [...byId.values()].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
}

/** Empties both copies. Used by the log view's own Clear. */
export const clearCronLog = async (): Promise<void> => {
  recent.length = 0

  await collection?.clear().catch(error => logger.warn('[SCHEDULER] could not clear the log', error))
}
