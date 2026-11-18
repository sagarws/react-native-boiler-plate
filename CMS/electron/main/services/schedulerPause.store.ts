import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Whether the operator has switched the whole schedule off.
 *
 * ON DISK, and that is the point of the file. The per-task records already say
 * which automations are enabled, and this is a different question: those are a
 * configuration somebody chose once, this is "not tonight". An operator who
 * stops everything because a marketplace is misbehaving, or because they are
 * about to use the machine, must not find it all running again after a restart
 * — and must not have to remember which four switches they turned off and put
 * each one back.
 *
 * SEPARATE FROM THE TASK RECORDS rather than a fifth row in them. That
 * collection is keyed by `ScheduledTaskId`, a union the registry, the store and
 * the card all check against; a row that is not a task would have to be
 * special-cased in each. One value in its own file costs less than that.
 */

/**
 * WHO stopped the schedule, which decides who may start it again.
 *
 *   operator  somebody moved the switch. It stays off until they move it back
 *             — an app that undid that decision by itself would be unusable.
 *   sessions  the Login update could not re-capture every login, so nothing
 *             below it can work. This one is the app's own decision, and the
 *             app takes it back the moment the logins are good again.
 *
 * The distinction is the whole feature: without it, an automatic pause would
 * either need an operator to notice and clear it, or would quietly override a
 * deliberate "not tonight".
 */
export type PauseReason = 'operator' | 'sessions'

interface PauseRecord {
  /** Always "scheduler" — one document, so one record. */
  key: string
  paused: boolean
  /** Why. Absent on a record written before this existed — read as operator. */
  reason?: PauseReason
  /** What to tell the operator: which logins, in their own words. */
  detail?: string
  /** When it was last switched, for the log and the modal's wording. */
  changedAt: string
}

const KEY = 'scheduler'

let collection: JsonCollection<PauseRecord> | null = null

export const initialiseSchedulerPause = (): void => {
  collection = new JsonCollection<PauseRecord>({
    name: 'scheduler-pause',
    directory: dataDirectory()
  })
}

/**
 * Running unless someone said otherwise.
 *
 * A read before the store is open, or of a file that cannot be parsed, answers
 * "not paused" — the schedule is what the app is for, and failing closed would
 * turn an unreadable file into a night nobody noticed was missed.
 */
export const isPaused = async (): Promise<boolean> => {
  if (!collection) return false

  try {
    const records = await collection.read()

    return records.find(record => record.key === KEY)?.paused === true
  } catch (error) {
    logger.warn('[schedule] could not read the pause flag; treating the schedule as running', error)

    return false
  }
}

export const writePaused = async (
  paused: boolean,
  reason: PauseReason = 'operator',
  detail = ''
): Promise<void> => {
  if (!collection) return

  await collection.mutate(() => ({
    records: [
      {
        key: KEY,
        paused,
        // Recorded only while paused: a reason on a running schedule would
        // describe a pause that is over.
        ...(paused ? { reason, detail } : {}),
        changedAt: new Date().toISOString()
      }
    ],
    result: undefined
  }))
}

/**
 * Why the schedule is off, or null when it is running.
 *
 * A record with no reason predates this and is read as the operator's: that is
 * the safe way round, because the alternative — treating an old manual pause
 * as automatic — would have the app switch automations back on by itself.
 */
export const pauseReason = async (): Promise<{ reason: PauseReason; detail: string } | null> => {
  if (!collection) return null

  try {
    const record = (await collection.read()).find(entry => entry.key === KEY)

    if (!record?.paused) return null

    return { reason: record.reason ?? 'operator', detail: record.detail ?? '' }
  } catch (error) {
    logger.warn('[schedule] could not read why the schedule is paused', error)

    return null
  }
}

/* -------------------------------------------------------------------------- *
 * The stop signal
 * -------------------------------------------------------------------------- */

/**
 * "Stop as soon as you safely can", readable without awaiting anything.
 *
 * SEPARATE FROM THE FLAG ABOVE, and the difference is what made the switch
 * look broken. That one is the persisted setting and lives on disk; this is the
 * live request, set the instant the switch moves and read from inside a task
 * that is already running.
 *
 * WHY IT HAD TO BE SYNCHRONOUS. A scheduled Session update is ONE task that
 * signs in to seven accounts in a loop. Checking the persisted flag between
 * TASKS — which is all the first version did — meant switching off during that
 * loop stopped nothing for several minutes: the switch said "Stopping…" while
 * the run carried on through all seven logins. The loop needs a check it can
 * make between accounts, and a `await isPaused()` inside a tight browser loop
 * is a file read per item.
 *
 * SCOPED TO SCHEDULED WORK. Only `automationTasks.ts` reads it, and that file
 * is the scheduler's seam — every manual button calls the underlying service
 * directly and is unaffected. Switching the schedule off must not cancel the
 * capture an operator started by hand a second earlier.
 */
let stopRequested = false

/** Called the moment the switch goes off. */
/** Called the instant a stop is asked for. See `onStopRequested`. */
const stopListeners = new Set<() => void>()

export const requestScheduleStop = (): void => {
  stopRequested = true

  for (const listener of [...stopListeners]) {
    try {
      listener()
    } catch (error) {
      logger.warn('[schedule] a stop listener failed', error)
    }
  }
}

/**
 * Be told the moment a stop is asked for — at once if one already stands.
 *
 * WHAT IT IS FOR: abandoning a run the instant Automations go off, rather than
 * at its next safe step. The run's own loop still stops at that step (it reads
 * the flag), but whoever is WAITING on it lets go now. Returns the
 * unsubscribe; a run that ends normally must call it.
 */
export const onStopRequested = (listener: () => void): (() => void) => {
  if (stopRequested) {
    listener()

    return () => undefined
  }

  stopListeners.add(listener)

  return () => stopListeners.delete(listener)
}

/** Called when it goes back on, so the next run is not stopped before it starts. */
export const clearScheduleStop = (): void => {
  stopRequested = false
}

export const isScheduleStopRequested = (): boolean => stopRequested

/**
 * THE ONE CONDITION EVERY BACKGROUND PROCESS OBEYS: the Automations switch is
 * off — by the operator or by the app, for failed logins — or a stop has been
 * asked for and not yet cleared.
 *
 * Checked before a process starts and between its steps: the scheduled tasks,
 * Run now, the master-import schedule and report queue, claims filed from the
 * socket, bulk re-claim and bulk SPF. The step in hand always finishes — a
 * claim half-filed can exist on the marketplace with nothing here recording it
 * — but nothing after it starts.
 */
export const automationsHalted = async (): Promise<boolean> =>
  stopRequested || (await isPaused())
