import { net } from 'electron'
import { IMPORT_SCHEDULE_EVENTS } from '@shared/constants/channels'
import type { ImportScheduleState } from '@shared/types/importSchedule'
import { isRunDue, isValidSyncTime, nextRunAt } from '@shared/utils/importSchedule'
import { getPlatform } from '@trackvid/automation-core/common/platforms'
import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { readScheduleRecord, writeScheduleRecord } from './importScheduleStore'
import { masterImportRows, resyncMasterImport } from './masterImport.service'
import { broadcast } from '../ipc/broadcast'
import { logger } from './logger'
import { automationsHalted, isScheduleStopRequested, onStopRequested } from './schedulerPause.store'
import { runStoppable } from './automationStop'
import { requestMonitorCheck } from './monitorSignal'
import {
  incompleteJobPlatforms,
  recordJobAbandoned,
  recordJobCompletion,
  recordJobStart
} from './cronHistory.store'
import type { CronRunStatus } from '@shared/utils/cronStatus'
import { AUTOMATION_MODES } from '@shared/constants/automationModes'

/**
 * Runs the master import on this machine, on the company's schedule.
 *
 * The company sets a time of day (`settings.masterImportSyncTime`, "HH:mm" in
 * IST). For each platform the company has routed to desktop execution, an
 * import runs once that moment has passed since the last run.
 *
 * NO TIMER OF ITS OWN. The automation monitor is the only clock in this app: it
 * wakes at `nextImportAt()` — the next platform's time — and calls
 * `runDueImports()` on every pass. This file loads the schedule from TrackVid
 * and decides which platforms are owed; it never decides when to look.
 *
 * Three things this deliberately does NOT do:
 *
 *   It does not trust a timer to have fired. A machine that sleeps for six
 *   hours wakes with its timers unfired, so every pass asks "is a run owed?"
 *   against the scheduled moment rather than counting on the wake-up.
 *
 *   It does not run without a network. An import that starts offline fails
 *   slowly and noisily; the check simply defers and retries.
 *
 *   It does not fire on a fresh install. `isRunDue` needs a baseline, recorded
 *   the first time this machine sees the schedule, so installing at 09:00 does
 *   not immediately trigger the 02:00 import.
 */

/** How long to wait before re-checking after finding no network. */
const OFFLINE_RETRY_MS = 15 * 60 * 1000

/**
 * How many times a due run may fail before the window is closed.
 *
 * Without this the day never completes, so `isRunDue` stays true and the import
 * is attempted on every monitor pass, forever. Three attempts is
 * enough to ride out a transient portal or network problem; past that the
 * problem is not going to fix itself before the next scheduled window, and
 * repeating it only buries the first, most useful error.
 */
const MAX_SCHEDULED_ATTEMPTS = 3

/** Signed in and Automations on: the monitor may run imports. */
let started = false

/**
 * THE TOGGLE_ON AUTOMATION, for the master import: Automations were switched
 * on, so every platform imports once, now, whatever its time says.
 *
 * Asked for as a flag and turned into the platform list on the first pass that
 * has one — the schedule may still be loading from TrackVid when the switch
 * moves. Each platform leaves the set as its import completes, so this is one
 * pass and never a loop; switching off clears it.
 */
let forcePending = false
const forced = new Set<string>()

export const forceImportsOnce = (): void => {
  forcePending = true
}
let offlineUntil = 0
let state: ImportScheduleState = {
  syncTime: null,
  syncTimes: {},
  schedulablePlatforms: [],
  platforms: [],
  lastRunAt: null,
  nextRunAt: null,
  running: false,
  lastError: null,
  offline: false
}

const publish = (next: Partial<ImportScheduleState>): void => {
  state = { ...state, ...next }
  broadcast(IMPORT_SCHEDULE_EVENTS.state, state)
}

export const scheduleState = (): ImportScheduleState => state

interface RoutingResponse {
  masterImportSyncTime?: unknown
  masterImportSyncTimes?: Record<string, string | null>
  masterImportPlatforms?: string[]
  desktopExecution?: Record<string, Record<string, boolean>>
}

/**
 * Re-reads the company's schedule and which platforms are routed here.
 *
 * Called on every launch, as the plan requires, and again whenever the operator
 * changes the time — a schedule cached from a previous run would keep this
 * machine importing on a time nobody chose.
 */
export const refreshSchedule = async (): Promise<Result<ImportScheduleState>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to load the import schedule')

  // The company-scoped endpoint, NOT the system-admin one of the same name.
  // That one is adminOnly, so an operator's token was answered 401 and the card
  // showed a bare "Unauthorized." with no schedule at all.
  const response = await apiRequest<RoutingResponse>('/cms/automation-routing', { token })

  if (!response.success) {
    // Keep whatever schedule is already loaded: a transient read failure must
    // not silently stop a schedule that was working a minute ago.
    logger.warn('Could not refresh the import schedule', response.error)
    publish({ lastError: response.error.message })

    return response
  }

  const raw = response.data?.masterImportSyncTime
  const syncTime = isValidSyncTime(raw) ? raw.trim() : null

  // Per-platform times. The server sends both shapes; this one is the
  // authority, and the scalar above stays only for the older stored form.
  const syncTimes = response.data?.masterImportSyncTimes ?? {}
  const schedulablePlatforms = response.data?.masterImportPlatforms ?? []

  const desktop = response.data?.desktopExecution ?? {}
  const platforms = Object.entries(desktop)
    .filter(([platform, automations]) => {
      if (automations?.masterImport !== true) return false

      // Guard against a platform the server knows and this build does not.
      return (getPlatform(platform)?.automations ?? []).includes('masterImport')
    })
    .map(([platform]) => platform)

  // First sight of a schedule sets the baseline, so the first run lands on the
  // next scheduled moment rather than immediately.
  const record = await readScheduleRecord()

  if (record.baselineAt === undefined) await writeScheduleRecord({ baselineAt: Date.now() })

  const lastRunAt = record.lastRunAt ?? null

  publish({
    syncTime,
    syncTimes,
    schedulablePlatforms,
    platforms,
    lastRunAt,
    nextRunAt: nextRunAt(syncTime),
    lastError: null
  })

  logger.info(
    `Import schedule: ${syncTime ?? 'none'} IST for [${platforms.join(', ') || 'no platforms'}]`
  )

  // The times may have moved; the monitor works out its next wake-up again.
  requestMonitorCheck({ reason: 'the master-import schedule was reloaded', planOnly: true })

  return ok(state)
}

/** The time this platform is scheduled for, falling back to the company-wide one. */
const timeFor = (platform: string): string | null => {
  const perPlatform = state.syncTimes?.[platform]

  return isValidSyncTime(perPlatform) ? perPlatform.trim() : state.syncTime
}

/** The soonest moment any scheduled platform is next due — for the UI. */
const soonestNextRun = (): number | null => {
  const times = state.platforms
    .map((platform) => nextRunAt(timeFor(platform)))
    .filter((at): at is number => at !== null)

  return times.length > 0 ? Math.min(...times) : nextRunAt(state.syncTime)
}

/**
 * Runs one platform's import and records the outcome against THAT platform.
 *
 * Each platform is scheduled, retried and closed independently: a Meesho
 * failure must not consume Ajio's attempts, and Ajio succeeding must not mark
 * Meesho's window done.
 */
/** How one platform's import ended, for its history row. */
interface PlatformOutcome {
  status: CronRunStatus
  total: number
  succeeded: number
  failed: number
  detail: string
}

const runPlatform = async (platform: string, previousAttempts: number): Promise<PlatformOutcome> => {
  const close = async (failures: number): Promise<void> => {
    const record = await readScheduleRecord()

    await writeScheduleRecord({
      platforms: {
        ...(record.platforms ?? {}),
        [platform]: { lastRunAt: Date.now(), failedAttempts: failures }
      }
    })
  }

  try {
    const rowsResult = await masterImportRows()

    if (!rowsResult.success) throw new Error(rowsResult.error.message)

    const due = rowsResult.data.filter((row) => row.platform === platform)

    // Nothing to import is a completed run, not a failure — otherwise a
    // platform with no credentials retries every minute forever.
    if (due.length === 0) {
      logger.info(`Master import due for ${platform} but it has no accounts here — nothing to run`)
      await close(0)

      return { status: 'completed', total: 0, succeeded: 0, failed: 0, detail: 'No accounts on this machine' }
    }

    // The scheduled run IS the manual Resync. Deliberately the same path: a
    // scheduled import that behaved differently from the button would be a
    // second thing to debug, and the button is the one that gets exercised.
    const result = await resyncMasterImport({
      rows: due.map((row) => ({
        platform: row.platform,
        credentialId: row.credentialId,
        username: row.username
      }))
    })

    if (!result.success) throw new Error(result.error.message)

    const failed = result.data.filter((outcome) => !outcome.ok)

    // The window closes either way. A partial failure is recorded with what
    // failed rather than retried wholesale: re-running every account because
    // one credential is bad would re-import the good ones and hammer portals
    // that already answered.
    await close(0)

    if (failed.length === 0) {
      logger.info(`Master import completed for ${platform} (${result.data.length} account(s))`)
      publish({ lastRunAt: Date.now(), lastError: null })

      return {
        status: 'completed',
        total: result.data.length,
        succeeded: result.data.length,
        failed: 0,
        detail: `${result.data.length} account(s) imported`
      }
    }

    const summary = failed.map((o) => `${o.credentialId}: ${o.message ?? 'failed'}`).join('; ')

    logger.warn(
      `Master import for ${platform} finished with ${failed.length} of ${result.data.length} ` +
        `account(s) failing — ${summary}`
    )
    publish({ lastRunAt: Date.now(), lastError: `${platform} — ${summary}` })

    return {
      status: failed.length === result.data.length ? 'failed' : 'completed_with_errors',
      total: result.data.length,
      succeeded: result.data.length - failed.length,
      failed: failed.length,
      detail: summary
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const attempts = previousAttempts + 1

    if (attempts >= MAX_SCHEDULED_ATTEMPTS) {
      // Close the window. The run did not happen and the error says so, but
      // retrying a minute later for the rest of the day would bury it.
      await close(0)
      logger.error(
        `Master import for ${platform} failed ${attempts} time(s) — giving up until its next ` +
          `scheduled run: ${message}`
      )
      publish({ lastError: `${platform} — ${message} (gave up after ${attempts} attempts)` })

      return { status: 'failed', total: 0, succeeded: 0, failed: 1, detail: `${message} (gave up after ${attempts} attempts)` }
    }

    const record = await readScheduleRecord()

    await writeScheduleRecord({
      platforms: {
        ...(record.platforms ?? {}),
        [platform]: { ...(record.platforms?.[platform] ?? {}), failedAttempts: attempts }
      }
    })
    logger.error(
      `Master import for ${platform} failed (attempt ${attempts} of ${MAX_SCHEDULED_ATTEMPTS}, ` +
        'retrying on the next monitor check): ' + message
    )
    publish({ lastError: `${platform} — ${message}` })

    return { status: 'failed', total: 0, succeeded: 0, failed: 1, detail: message }
  }
}

/** What a platform's import races against: Automations being switched off. */
const ABANDONED = Symbol('abandoned')

/**
 * Runs one platform's import as ONE ROW of `cron-history-master-import`:
 * started before the import, completed after it with that platform's result.
 *
 * SWITCHED OFF MID-IMPORT, the row is left INCOMPLETE — no completion time —
 * and the monitor runs that platform again when Automations come back on. The
 * import runs in a stoppable context (see automationStop), so it also stops at
 * its next step — between report types, between reports, and out of its
 * ten-minute wait for a report — instead of carrying on unwatched. It re-reads
 * reports, so running it again is safe.
 *
 * Returns false when the switch went off, so the caller stops.
 */
const runPlatformRecorded = async (platform: string, previousAttempts: number): Promise<boolean> => {
  const execution = await recordJobStart(
    'master-import',
    [platform],
    forced.has(platform) ? AUTOMATION_MODES.TOGGLE_ON : AUTOMATION_MODES.SCHEDULE
  )
  let stopWaiting = (): void => undefined
  let stopped = false
  const abandoned = new Promise<typeof ABANDONED>(resolve => {
    stopWaiting = onStopRequested(() => {
      stopped = true
      resolve(ABANDONED)
    })
  })
  const work = runStoppable(() => stopped || isScheduleStopRequested(), () => runPlatform(platform, previousAttempts))
  const first = await Promise.race([work, abandoned]).finally(() => stopWaiting())

  if (first === ABANDONED) {
    work.catch(error => logger.warn(`Master import for ${platform} ended after it was abandoned`, error))
    await recordJobAbandoned(execution)
    logger.info(`Master import for ${platform} left incomplete — Automations were switched off`)

    return false
  }

  // One pass only: the forced import has happened.
  forced.delete(platform)

  await recordJobCompletion(execution, first.status, {
    detail: first.detail,
    error: first.status === 'failed' ? first.detail : null,
    total: first.total,
    succeeded: first.succeeded,
    failed: first.failed,
    platforms: [
      { platform, total: first.total, succeeded: first.succeeded, failed: first.failed, detail: first.detail }
    ]
  })

  return true
}

/**
 * Runs every platform whose import is owed. Called by the monitor on each
 * pass, and by nothing else.
 */
export const runDueImports = async (): Promise<void> => {
  if (!started) return
  if (state.running) return
  if (await automationsHalted()) return
  if (state.platforms.length === 0) return
  if (Date.now() < offlineUntil) return

  if (forcePending) {
    forcePending = false
    for (const platform of state.platforms) forced.add(platform)
  }

  const record = await readScheduleRecord()
  const baseline = record.baselineAt ?? Date.now()
  // A platform whose latest history row has no completion was cut short, and
  // is owed a re-run whatever its time says.
  const incomplete = new Set(await incompleteJobPlatforms('master-import'))

  // Each platform against ITS OWN time and ITS OWN last run.
  const due = state.platforms.filter((platform) => {
    if (incomplete.has(platform) || forced.has(platform)) return true

    const perPlatform = record.platforms?.[platform]
    // Fall back to the shared lastRunAt so a record written by the previous
    // single-time version does not re-fire everything once on upgrade.
    const lastRun = perPlatform?.lastRunAt ?? record.lastRunAt ?? 0

    return isRunDue(timeFor(platform), Math.max(baseline, lastRun))
  })

  if (due.length === 0) return

  if (!net.isOnline()) {
    // Defer rather than fail: the import would only get partway through and
    // leave half-written state behind.
    offlineUntil = Date.now() + OFFLINE_RETRY_MS
    publish({ offline: true, lastError: 'No network — retrying in 15 minutes' })
    logger.warn('Master import due but the machine is offline; retrying in 15 minutes')

    return
  }

  publish({ offline: false, running: true, lastError: null })
  logger.info(`Master import due for [${due.join(', ')}]`)

  try {
    // Sequential. Each opens a browser, and two at once would compete for the
    // screen and make a failure impossible to attribute.
    for (const platform of due) {
      // Switched off part-way: the rest wait.
      if (await automationsHalted()) break

      const carriedOn = await runPlatformRecorded(platform, record.platforms?.[platform]?.failedAttempts ?? 0)

      if (!carriedOn) break
    }
  } finally {
    publish({ running: false, nextRunAt: soonestNextRun() })
  }
}

/** Records a completed run, so the day is not attempted again. */
export const recordRun = async (at: number = Date.now()): Promise<void> => {
  // Clearing the counter matters as much as stamping the time: the next window
  // must start with a full allowance of attempts.
  await writeScheduleRecord({ lastRunAt: at, failedAttempts: 0 })
  publish({ lastRunAt: at, nextRunAt: soonestNextRun(), running: false })
}

/**
 * When the monitor should next wake for an import: the soonest platform time,
 * IST. Null when nothing is scheduled here, or the imports are stopped.
 */
export const nextImportAt = (): number | null =>
  started && state.platforms.length > 0 ? soonestNextRun() : null

/**
 * Lets the monitor run imports, and loads the schedule they run on.
 *
 * Asks for a pass once the schedule is in, which is what the old one-minute
 * tick did within a minute of sign-in: a platform owed since the app was
 * closed runs now rather than at tomorrow's time.
 */
export const startImportScheduler = (): void => {
  if (started) return

  started = true

  void refreshSchedule().finally(() => {
    requestMonitorCheck({ reason: 'the master-import schedule was loaded' })
  })
}

export const stopImportScheduler = (): void => {
  started = false
  // A forced pass belongs to the switch-on that asked for it.
  forcePending = false
  forced.clear()
}

/** Changes the company's scheduled time, then re-reads it back. */
/**
 * Sets one platform's master-import time.
 *
 * Per platform rather than per company: an operator running four marketplaces
 * has four report APIs to be polite to, and stacking every import on the same
 * minute is how a night's run turns into four simultaneous browser sessions.
 */
export const setPlatformSyncTime = async (payload: unknown): Promise<Result<ImportScheduleState>> => {
  const input = (payload ?? {}) as { platform?: unknown; syncTime?: unknown }

  // Typed narrowly rather than String()-ed: String({}) is "[object Object]",
  // which would sail past the emptiness check below and be sent to the server
  // as a platform name.
  const platform =
    typeof input.platform === 'string' ? input.platform.toLowerCase().trim() : ''

  if (!platform) return fail('VALIDATION_ERROR', 'Choose a platform')

  const value = input.syncTime
  const syncTime =
    value === null || value === undefined || value === ''
      ? null
      : typeof value === 'string'
        ? value.trim()
        : '<invalid>'

  if (syncTime !== null && !isValidSyncTime(syncTime)) {
    return fail('VALIDATION_ERROR', 'Enter a time as HH:mm, or clear it to turn the schedule off')
  }

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to change the schedule')

  const response = await apiRequest<unknown>('/cms/automation-routing/sync-time', {
    method: 'PUT',
    token,
    // A map with one entry: the server merges it over what is stored, so this
    // changes one platform without clearing the others.
    body: { masterImportSyncTimes: { [platform]: syncTime } }
  })

  if (!response.success) return response

  return refreshSchedule()
}

export const setSyncTime = async (payload: unknown): Promise<Result<ImportScheduleState>> => {
  const value = (payload as { syncTime?: unknown })?.syncTime
  // Anything that is not a string or an explicit null is rejected below rather
  // than stringified — String({}) would become "[object Object]" and fail the
  // pattern check with a message that names the wrong problem.
  const syncTime =
    value === null || value === undefined || value === ''
      ? null
      : typeof value === 'string'
        ? value.trim()
        : '<invalid>'

  if (syncTime !== null && !isValidSyncTime(syncTime)) {
    return fail('VALIDATION_ERROR', 'Enter a time as HH:mm, for example 02:00')
  }

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to change the schedule')

  // Writes only the sync time, on the caller's own company. The system-admin
  // endpoint could also rewrite desktopExecution and apiBasedAutomation across
  // every company — far more authority than changing an import time needs, and
  // an operator's token is refused there anyway.
  const response = await apiRequest<unknown>('/cms/automation-routing/sync-time', {
    method: 'PUT',
    token,
    body: { masterImportSyncTime: syncTime }
  })

  if (!response.success) return response

  // Re-read rather than assume: the server validates and may normalise, and
  // showing what it stored beats showing what was asked for.
  return refreshSchedule()
}
