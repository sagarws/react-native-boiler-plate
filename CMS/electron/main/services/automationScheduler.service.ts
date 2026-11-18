import { randomUUID } from 'node:crypto'
import { runStoppable } from './automationStop'
import { AUTOMATION_SCHEDULE_EVENTS } from '@shared/constants/channels'
import {
  SCHEDULED_TASK_IDS,
  isScheduledTaskId,
  scheduledTaskInfo
} from '@shared/constants/automationSchedule'
import type {
  AutomationScheduleState,
  CronExecution,
  PlatformResult,
  ScheduledRunArchive,
  ScheduledTaskId,
  ScheduledTaskState,
  TaskOutcome
} from '@shared/types/automationSchedule'
import { fail, ok, type Result } from '@shared/types/result'
import {
  cronFromLegacyTime,
  cronProblem,
  describeCron,
  mostRecentOccurrence,
  nextCronRun,
  normaliseCron,
  type CronSchedule
} from '@shared/utils/cronSchedule'
import { classifyOutcome } from '@shared/utils/cronStatus'
import type { TaskSnapshot } from '@shared/utils/cronQueue'
import { isValidSyncTime } from '@shared/utils/importSchedule'
import { AUTOMATION_LAUNCH_OFF_MS, AUTOMATION_MONITOR_INTERVAL_MINUTES } from '@shared/constants/automationMonitor'
import {
  AUTOMATION_MODES,
  RUN_TRIGGER_LABEL,
  type RunTrigger
} from '@shared/constants/automationModes'
import { broadcast } from '../ipc/broadcast'
import { automationHolder, isAutomationBusy, whenAutomationFree } from './automationLock'
import { readTaskRecord, readTaskRecords, writeTaskRecord } from './automationSchedule.store'
import {
  handledOccurrences,
  lastSuccessfulCompletion,
  latestExecution,
  readHistory,
  recordAbandoned,
  recordCompletion,
  recordSkip,
  recordStart,
  recoverInterruptedExecutions
} from './cronHistory.store'
import {
  clearScheduleStop,
  isPaused,
  isScheduleStopRequested,
  onStopRequested,
  requestScheduleStop,
  writePaused,
  pauseReason
} from './schedulerPause.store'
import {
  outstandingSessions,
  sessionPauseEnabled,
  taskRunner
} from './automationTasks'
import { onSessionChanged } from './sessionChangeSignal'
import { automationsSwitched, requestManualRun, requestMonitorCheck } from './monitorSignal'
import { clearPlatformSkips, requestPlatformSkip } from './platformSkip.store'
import { readBackupSettings } from './masterBackup.store'
import { writeScheduledRun } from './scheduledRunArchive.store'
import { cronLog } from './cronLog.store'
import { logger } from './logger'

/**
 * The nightly schedule: a registry of tasks, and a job row each. The clock that
 * starts them is `monitor.service.ts`.
 *
 * WHAT THIS FILE KNOWS: how to tell whether a run is owed, how to take the
 * browser politely, and how to write down what happened. What it does NOT know
 * is what any task does — that is four adapters in `automationTasks.ts`, and the
 * separation is the point. Changing what Refill Data does cannot break the
 * schedule; adding a fifth automation does not touch this file at all.
 *
 * A TICK, NOT A TIMER SET FOR 02:00. A machine that sleeps for six hours wakes
 * with its long timers unfired — the classic way a nightly job silently stops
 * happening on a laptop. So the monitor asks "is a run owed?" every
 * AUTOMATION_MONITOR_INTERVAL_MINUTES, against
 * the scheduled moment rather than against "24 hours since the last run", which
 * also stops the schedule drifting later every day. An app closed at 02:00 and
 * opened at 09:00 still runs that day's window; one opened at 09:00 the NEXT day
 * runs it once, not twice.
 *
 * The time arithmetic is `@shared/utils/importSchedule` — pure, IST, and already
 * carrying the master import. Two schedulers agreeing on what "02:00" means is
 * worth more than a file whose name matches this one.
 */

/*
 * THIS FILE NO LONGER DECIDES WHEN ANYTHING RUNS.
 *
 * It used to own a one-minute tick, and four other paths — the launch catch-up,
 * a sign-in, a skip, a login fix — each started the queue themselves. All of
 * that is `monitor.service.ts` now: it wakes every
 * AUTOMATION_MONITOR_INTERVAL_MINUTES, reads `automation-schedule` and every
 * `cron-history-<task>` table, and is the only caller of `runScheduledTask`.
 * What stays here is how ONE run is carried out and recorded, the settings, and
 * the state the card reads. Where this file used to start work, it now calls
 * `requestMonitorCheck` and lets the monitor decide.
 */

/*
 * THERE IS NO THREE-STRIKES LIMIT. A failed task is passed over — the tasks
 * after it run — and retried on every monitor check until it completes. The
 * monitor's interval is the spacing, so it never hammers a marketplace.
 */

/** Armed once per launch, sign-in or switch-on; see `armScheduler`. */
let armed = false

/**
 * True between `stopAutomationScheduler` and the next arming.
 *
 * THE BUG WITHOUT IT: stopping the scheduler cleared the timer and nothing
 * else. A pass already in flight kept going — it carries on after every
 * completed task — so a scheduler that had been stopped could still start the
 * NEXT automation, minutes later, with a browser window, on a machine that was
 * signing out or shutting down. "Stopped" has to mean the queue stops, not
 * that no new ticks arrive. The monitor reads this through `isDisarmed`.
 */
let disarmed = false

/** Read by the monitor before every pass and between tasks. */
export const isDisarmed = (): boolean => disarmed

/**
 * The tasks running right now.
 *
 * A SET, NOT ONE SLOT — and the difference is the bug it fixes. Any task
 * running blocked every other one, so pressing Run now on Auto claim while the
 * Session update was signing in ONE marketplace was refused outright: the
 * claims for every platform whose session was already good sat there, waiting
 * on a login they did not need.
 *
 * Nothing about that was protecting anything. `withAutomationLock` is a QUEUE:
 * two tasks wanting the browser take it in turn, they never share it. What this
 * guard is actually for is a task racing ITSELF — a Run now on top of the same
 * task already going, which would double-file — and that is all it stops now.
 */
const running = new Set<ScheduledTaskId>()

/**
 * Tasks the operator has asked to cut short while they were running.
 *
 * NOT THE MASTER SWITCH, which stops everything and keeps it stopped. This is
 * "not this one, not now": the task in flight stops at its next safe boundary —
 * between accounts, between marketplaces — and the queue carries straight on to
 * whatever is next. An operator watching Login update grind through a
 * marketplace that is plainly refusing everything should not have to choose
 * between waiting it out and switching the whole schedule off.
 *
 * Per run rather than persisted, and cleared when the task returns: it answers
 * THIS execution. The next scheduled one is unaffected, which is the difference
 * between skipping a run and turning a task off.
 */
const skipping = new Set<ScheduledTaskId>()

/**
 * Tasks that are owed and waiting their turn behind the one running.
 *
 * Held so the modal can say "queued" rather than "scheduled" — the nightly
 * sequence is one at a time by design, and between two tasks there would
 * otherwise be nothing on screen to say the run is still going.
 */
const queued = new Set<ScheduledTaskId>()

/**
 * Tasks to run on this pass whatever their schedule says.
 *
 * WHY THE SWITCH FILLS THIS. "On" used to mean "re-arm, and catch up anything
 * overdue" — which, on a machine where everything ran an hour ago, means
 * nothing happens at all. The log said `switched ON — re-arming and catching
 * up` and then went quiet, and an operator who had just decided the machine
 * should be working saw no reason to believe it.
 *
 * So turning it on now runs the night's work from the top: the Login update
 * first, then everything behind it, in the ordinary order and one at a time.
 * It does NOT override a task the operator switched off, and it does not skip
 * the dependency checks — `forced` only makes a task DUE.
 *
 * EMPTIED AS EACH TASK FINISHES, so it cannot become a task that runs every
 * minute for ever; and cleared outright when the switch goes off, so a pause
 * does not leave a forced pass waiting to ambush the next start.
 */
const forced = new Set<ScheduledTaskId>()

/**
 * Run now presses that are waiting their turn on the chain.
 *
 * Distinct from `running`: a task can be neither running nor finished but
 * already spoken for, and a second press in that window is the double-click
 * this exists to refuse.
 */
const pendingManual = new Set<ScheduledTaskId>()

/** Set the moment the master switch goes off, cleared when the last task stops. */
let stopping = false

export const isScheduleRunning = (): boolean => running.size > 0

/* -------------------------------------------------------------------------- *
 * State, as the card reads it
 * -------------------------------------------------------------------------- */

/**
 * Everything the queue needs about one task, read from the history on disk.
 *
 * THE DATABASE IS THE SOURCE OF TRUTH, and this is where that is enforced. The
 * in-memory `running` set is an optimisation that a crash erases; the history
 * files are what a restart reconstructs the scheduler from, so every decision
 * below is taken from them rather than from anything held in this process.
 */
const snapshotOf = async (id: ScheduledTaskId): Promise<TaskSnapshot> => {
  const info = scheduledTaskInfo(id)
  const records = await readTaskRecords()
  const record = records.find(entry => entry.taskId === id)
  // A record written before the dialog existed carries a single `time`;
  // read forward so nobody's 02:00 becomes "not set" on upgrade.
  const cron = record?.cron ?? cronFromLegacyTime(record?.time)
  const enabled = record?.enabled === true && cron !== null && cronProblem(cron) === null

  const history = await readHistory(id)
  const latest = history[0] ?? null
  const occurrence = mostRecentOccurrence(cron)
  const handled = await handledOccurrences(id)

  /*
   * A MACHINE THAT RAN THIS BEFORE THERE WAS A HISTORY.
   *
   * Every install predating these files has a `lastRunAt` on its record and no
   * rows at all. Read literally that is "never run here", which would make all
   * four tasks due the moment the app updated — four browser automations at
   * once, on somebody's machine, for no reason visible to them.
   *
   * So an empty history falls back to what the old record already knows. Read
   * forward, never written back: the first real run writes a proper row and
   * this stops being consulted. The same tolerant read the other stores use for
   * a field that arrived late.
   */
  const legacyRunAt = history.length === 0 ? (record?.lastRunAt ?? null) : null
  const successAt = (await lastSuccessfulCompletion(id)) ?? legacyRunAt

  /*
   * FAILURES SINCE THE LAST SUCCESS, counted off the history rather than kept
   * in a field. A counter in a record drifts: it is cleared on some paths and
   * not others, and a crash between the run and the write loses it entirely.
   * The rows already say what happened, so the count is derived.
   */
  let consecutiveFailures = 0

  for (const execution of history) {
    /*
     * A RUN THE APP KILLED IS NOT AN ATTEMPT THAT FAILED, and counting it as
     * one is how a developer restarting the app three times ends up waiting an
     * hour for the next try. It still blocks — nothing knows how far it got —
     * but the backoff is meant to space out attempts the MARKETPLACE refused.
     */
    if (execution.interrupted === true) continue

    if (execution.status === 'failed') consecutiveFailures += 1
    else if (execution.status !== 'running') break
  }

  return {
    id,
    order: info.order,
    label: info.label,
    enabled,
    cron,
    // `completed` for the legacy case rather than null: a task the old record
    // says ran last night has run, and calling it "never" is what would make it
    // due immediately.
    lastStatus: latest?.status ?? (legacyRunAt === null ? null : 'completed'),
    lastSuccessAt: successAt,
    lastAttemptAt: latest?.completedAt ? Date.parse(latest.completedAt) : legacyRunAt,
    consecutiveFailures,
    // Switched on by hand a moment ago: run it this pass whatever its window
    // says. Dropped as the task finishes, so it is one pass and not a loop.
    forced: forced.has(id),
    occurrence,
    occurrenceHandled: occurrence !== null && handled.has(occurrence)
  }
}

/** Every task as the queue sees it: `automation-schedule` plus its history table. */
export const snapshots = async (): Promise<TaskSnapshot[]> =>
  Promise.all(SCHEDULED_TASK_IDS.map(snapshotOf))

const stateOf = async (): Promise<AutomationScheduleState> => {
  const records = await readTaskRecords()
  const tasks: ScheduledTaskState[] = await Promise.all(
    SCHEDULED_TASK_IDS.map(async id => {
      const info = scheduledTaskInfo(id)
      const record = records.find(entry => entry.taskId === id)
      const cron = record?.cron ?? cronFromLegacyTime(record?.time)
      const enabled = record?.enabled === true && cron !== null && cronProblem(cron) === null
      const latest = await latestExecution(id)
      const successAt = await lastSuccessfulCompletion(id)

      return {
        id,
        label: info.label,
        description: info.description,
        enabled,
        cron,
        lastRunAt: record?.lastRunAt ? new Date(record.lastRunAt).toISOString() : null,
        /*
         * Measured from the last SUCCESSFUL COMPLETION, which is the whole
         * point of an interval: "every two hours" has to mean two hours between
         * finished runs, or a run that takes twenty minutes pushes the next one
         * twenty minutes later every single time.
         */
        nextRunAt: enabled
          ? nextCronRun(cron, successAt ?? record?.baselineAt ?? 0)
          : null,
        lastDetail: record?.lastDetail ?? null,
        lastError: record?.lastError ?? null,
        running: running.has(id),
        queued: queued.has(id),
        lastStatus: latest?.status ?? null,
        lastStartedAt: latest?.startedAt ?? null,
        lastCompletedAt: successAt === null ? null : new Date(successAt).toISOString(),
        // Only ever an actual unresolved failure — never "the task before it is
        // not due yet", which is not a reason to hold anything up.
        consecutiveFailures: (await snapshotOf(id)).consecutiveFailures
      }
    })
  )

  const why = await pauseReason()

  return {
    tasks,
    busy: automationHolder(),
    paused: await isPaused(),
    pausedBy: why?.reason ?? null,
    pausedDetail: why?.detail ?? '',
    // Only while something is actually still going; a paused schedule with
    // nothing running is stopped, not stopping.
    stopping: stopping && running.size > 0
  }
}

const publish = async (): Promise<void> => {
  broadcast(AUTOMATION_SCHEDULE_EVENTS.state, await stateOf())
}

/**
 * What the monitor is about to work through, so the card can say "queued"
 * rather than "scheduled" between two tasks. Pass an empty list to clear.
 */
export const setQueued = async (ids: readonly ScheduledTaskId[]): Promise<void> => {
  queued.clear()
  for (const id of ids) queued.add(id)
  await publish()
}

export const scheduleState = async (): Promise<Result<AutomationScheduleState>> =>
  ok(await stateOf())

/* -------------------------------------------------------------------------- *
 * Running one task
 * -------------------------------------------------------------------------- */

const archive = async (
  id: ScheduledTaskId,
  startedAt: string,
  outcome: TaskOutcome | null,
  error: string | null
): Promise<void> => {
  const info = scheduledTaskInfo(id)
  const record: ScheduledRunArchive = {
    jobId: randomUUID(),
    taskId: id,
    label: info.label,
    platform: info.platform,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: error ? 'failed' : 'done',
    detail: outcome?.detail ?? error ?? '',
    total: outcome?.total ?? 0,
    succeeded: outcome?.succeeded ?? 0,
    failed: outcome?.failed ?? 0,
    summary: outcome?.summary ?? [],
    rows: outcome?.rows ?? [],
    error
  }

  await writeScheduledRun(record)
}

/**
 * Runs one task, records it, and closes its window.
 *
 * `manual` is a Run now from the card. It takes the same path on purpose — a
 * schedule that can only be tested by waiting until 02:00 is a schedule nobody
 * tests — but it does NOT close the window or touch the failure count, so
 * testing a task at eleven in the morning cannot cancel that night's run.
 */
/** What `runTask` races the runner against: the switch going off. */
const ABANDONED = Symbol('abandoned')

/**
 * The run's result per marketplace, for its history row.
 *
 * A runner that works across marketplaces reports its own breakdown. One that
 * belongs to a single marketplace — the AJIO and Snapdeal syncs — does not need
 * to: its whole result IS that platform's, and the registry says which.
 */
const platformResults = (id: ScheduledTaskId, outcome: TaskOutcome): PlatformResult[] | undefined => {
  if (outcome.platforms) return outcome.platforms

  const { platform } = scheduledTaskInfo(id)

  if (platform === 'All') return undefined

  return [
    {
      platform: platform.toLowerCase(),
      total: outcome.total,
      succeeded: outcome.succeeded,
      failed: outcome.failed,
      detail: outcome.detail
    }
  ]
}

/**
 * Which kind of automation is starting this run — see `automationModes`.
 *
 * A task in `forced` is there because Automations were switched on, so that is
 * what started it, even if its schedule happened to be due as well: the switch
 * would have run it either way.
 */
const triggerOf = (id: ScheduledTaskId, manual: boolean): RunTrigger => {
  if (manual) return 'manual'

  return forced.has(id) ? AUTOMATION_MODES.TOGGLE_ON : AUTOMATION_MODES.SCHEDULE
}

const runTask = async (id: ScheduledTaskId, manual: boolean): Promise<Result<TaskOutcome>> => {
  // ONLY AGAINST ITSELF. Another task running is not a reason to refuse: its
  // browser work queues behind whatever holds the lock, and the platforms this
  // run can already file for do not need the other task at all.
  if (running.has(id)) {
    return fail('CONFLICT', `${scheduledTaskInfo(id).label} is already running`)
  }

  const startedAt = new Date().toISOString()
  const info = scheduledTaskInfo(id)

  /*
   * THE START IS PERSISTED BEFORE THE WORK BEGINS, and that ordering is the
   * whole reason crash recovery is possible. Written afterwards, a run the app
   * died in the middle of leaves nothing behind at all, and the next launch
   * cannot tell "never ran" from "died halfway through". Written first, the
   * same crash leaves a row with no `completedAt` — which is exactly the signal
   * `recoverInterruptedExecutions` keys on.
   */
  const snapshot = await snapshotOf(id)
  const execution = await recordStart(id, {
    // The fixed-time slot this run is answering, so a run that starts at 10:00
    // and finishes at 10:20 cannot be read as owing the 10:00 slot all over
    // again for the rest of the day.
    occurrence: manual ? null : snapshot.occurrence,
    manual,
    trigger: triggerOf(id, manual)
  })

  running.add(id)
  await publish()
  cronLog('start', info.label, `Started — ${RUN_TRIGGER_LABEL[execution.trigger ?? triggerOf(id, manual)]}`, {
    taskId: id
  })

  const close = async (failures: number): Promise<void> => {
    if (manual) return

    await writeTaskRecord(id, { lastRunAt: Date.now(), failedAttempts: failures })
  }

  try {
    /*
     * Two ways to be told to stop. A skip is about THIS run, and ends it at its
     * next safe step with a completion like any other. The Automations switch
     * is about EVERYTHING — and it ABANDONS the run, at once.
     *
     * ABANDONED, NOT FINISHED. The moment the switch goes off this stops
     * waiting: the history row is left with no completion time (the monitor
     * runs an incomplete task again), the task stops counting as running, and
     * the switch reads Off. The runner itself is told to stop through its own
     * predicate, so its browser finishes only the action it is in the middle
     * of — no claim is left half-submitted — and then closes, unwatched.
     *
     * `abandoned` is per run and never cleared: switching back on a second
     * later clears the global flag, and an abandoned runner that read only
     * that flag would wake up and carry on beside the re-run.
     */
    let abandoned = false
    let stopWaiting = (): void => undefined
    const abandonedSignal = new Promise<typeof ABANDONED>(resolve => {
      stopWaiting = onStopRequested(() => {
        abandoned = true
        resolve(ABANDONED)
      })
    })
    const shouldStop = (): boolean => abandoned || skipping.has(id) || isScheduleStopRequested()
    // In a stoppable context, so a loop at any depth can see the switch — see
    // automationStop. Threading the predicate alone left the innermost loops
    // (AJIO's report pages) running after the run was recorded as stopped.
    const work = runStoppable(shouldStop, () => taskRunner(id)(shouldStop))
    const first = await Promise.race([work, abandonedSignal]).finally(() => stopWaiting())

    if (first === ABANDONED) {
      // Whatever the runner does from here is nobody's business: it must not
      // surface as an unhandled rejection, and it must not write a result.
      work.catch(error =>
        logger.warn(`[schedule] ${info.label}: the abandoned run ended with an error`, error)
      )
      await recordAbandoned(execution)
      cronLog('skip', info.label, 'Stopped — Automations switched off', {
        taskId: id,
        detail:
          'Left incomplete, with no completion time. It runs again, first, when Automations are switched on.'
      })

      return fail('CONFLICT', `${info.label} was stopped — Automations were switched off`)
    }

    const outcome = first

    /*
     * A RUN IS NOT A SUCCESS BECAUSE IT RETURNED.
     *
     * Every runner converts marketplace failures into counters and returns
     * normally, so "did not throw" was calling a night in which all seven
     * logins failed a success — archiving it green, clearing the error and
     * resetting the retry budget. The numbers that say otherwise were on this
     * object the whole time. See shared/utils/cronStatus.
     */
    /*
     * THE GATE FOR EVERYTHING BELOW THIS TASK.
     *
     * The Login update runs first because the refill and the claims sign in
     * with what it re-captures. A run that fixed none of them used to be
     * followed by both anyway: a night of opening browsers, each claim burning
     * an attempt against a login the marketplace refuses, and every row ending
     * Failed for a reason that has nothing to do with the claim.
     *
     * So the app stops itself here and says why — and starts again, by itself,
     * once the logins are good. Decided from `outstandingSessions`, the shared
     * rule, rather than from this run's counters: a capture can succeed and the
     * marketplace still refuse the session it produced.
     */
    // A skip belongs to the run it was pressed on. Cleared here, where every
    // task ends, rather than in each runner.
    clearPlatformSkips(id)
    // One pass only — see `forced`.
    forced.delete(id)

    if (id === SESSIONS) await settleAgainstSessions(execution.trigger ?? triggerOf(id, manual))

    const status = classifyOutcome(outcome)
    const failedOutright = status === 'failed'

    /*
     * VERIFIED, NOT ASSUMED. The queue moves past this task on the strength of
     * the completion record, so a write that silently failed would let it step
     * over a run whose outcome nothing knows. `recordCompletion` reads the row
     * back and says whether it is really there.
     */
    const persisted = await recordCompletion(execution, status, {
      detail: outcome.detail,
      error: failedOutright ? outcome.detail : null,
      total: outcome.total,
      succeeded: outcome.succeeded,
      failed: outcome.failed,
      platforms: platformResults(id, outcome)
    })

    if (!persisted) {
      // Treated as a failure rather than shrugged off: an unverifiable run is
      // one the next launch cannot reason about, and blocking is the safe read.
      const message = 'The run finished but its completion could not be saved'

      await archive(id, startedAt, outcome, message)
      cronLog('failure', info.label, 'Could not save the completion', {
        taskId: id,
        detail: 'The run finished, but nothing can confirm it. Treated as a failure.'
      })

      return fail('INTERNAL_ERROR', message)
    }

    await archive(id, startedAt, outcome, failedOutright ? outcome.detail : null)
    await close(failedOutright ? (snapshot.consecutiveFailures ?? 0) + 1 : 0)
    await writeTaskRecord(id, {
      lastDetail: outcome.detail,
      lastError: failedOutright ? outcome.detail : null
    })

    if (failedOutright) {
      cronLog('failure', info.label, 'Failed — none of the work succeeded', {
        taskId: id,
        detail: outcome.detail
      })

      return fail('INTERNAL_ERROR', outcome.detail)
    }

    if (status === 'completed_with_errors') {
      /*
       * SAID PLAINLY, because this is the line people misread. The run counts
       * as done and nothing is blocked — but some of it failed, and that is
       * worth seeing before it becomes a pattern.
       */
      cronLog('partial', info.label, `Completed, ${outcome.failed} of ${outcome.total} failed`, {
        taskId: id,
        detail: outcome.detail
      })
    } else {
      cronLog('success', info.label, 'Completed', { taskId: id, detail: outcome.detail })
    }

    return ok(outcome)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const record = await readTaskRecord(id)
    const attempts = (record?.failedAttempts ?? 0) + 1

    /*
     * THE HISTORY ROW IS CLOSED HERE TOO, and it matters more than the archive:
     * a row left open would be read on the next launch as a run the app died
     * inside, when in fact it failed cleanly and the reason is known. Recovery
     * would then report the wrong cause for a fault that had already explained
     * itself.
     */
    await recordCompletion(execution, 'failed', { error: message, detail: message })
    await archive(id, startedAt, null, message)
    await writeTaskRecord(id, {
      lastError: message,
      ...(manual ? {} : { failedAttempts: attempts })
    })

    /*
     * NO LONGER GIVES UP AFTER THREE. The old rule closed the window so a
     * failing task would not launch a browser every minute all night — right
     * about the problem, wrong about the remedy now that a failure BLOCKS the
     * tasks after it. Giving up would mean giving up on those too, silently.
     * The wait between retries is the backoff in shared/utils/cronQueue.
     */
    cronLog('failure', info.label, `Failed (attempt ${attempts}) — retrying`, {
      taskId: id,
      // Said on every failure because it is the thing somebody watching a
      // blocked queue needs to know: it is not stuck, and it is not going to
      // give up. The way out of a failure that cannot fix itself is Skip.
      detail: `${message} — will try again on the next check, and keep trying until it completes`
    })

    return fail('INTERNAL_ERROR', message)
  } finally {
    running.delete(id)
    // The decision was about the run that has just ended. Leaving it set would
    // cut the next one short before it started a single account.
    skipping.delete(id)
    await publish()

    // Asked for while this run was going — claims saved after it had already
    // read its list. One more run picks them up. Deferred, because this is
    // still inside the monitor's chain and the next run queues behind it.
    if (followUp.delete(id)) {
      setImmediate(() => void requestTaskRun(id, 'work added during the last run'))
    }
  }
}

/**
 * Cut the running task short, and let the queue move on.
 *
 * WHAT IT IS FOR. A task that is going to take twenty minutes getting the same
 * refusal from a marketplace holds up every task behind it, and the only ways
 * out were to wait or to switch the whole schedule off — which also stops the
 * three tasks that were fine. This stops exactly one run.
 *
 * STOPS AT A SAFE BOUNDARY, not instantly. The flag is read between the units a
 * task loops over, so a claim being filed is finished and a browser is closed
 * properly; what is abandoned is the work not yet started. That is the same
 * contract the master switch has, and the reason neither is a kill.
 *
 * THE RUN IS STILL RECORDED, with what it managed before it was stopped — a
 * skipped run that left no trace would read, the next morning, exactly like one
 * that never started.
 */
export const skipRunningTask = async (payload: unknown): Promise<Result<AutomationScheduleState>> => {
  const request = (payload ?? {}) as { taskId?: unknown }

  if (!isScheduledTaskId(request.taskId)) return fail('VALIDATION_ERROR', 'Unknown task')

  const id = request.taskId
  const info = scheduledTaskInfo(id)

  if (!running.has(id)) {
    return fail('CONFLICT', `${info.label} is not running`)
  }

  if (skipping.has(id)) {
    // Already asked. Saying so beats a second identical log line and a toast
    // that implies something new happened.
    return ok(await stateOf())
  }

  skipping.add(id)

  cronLog('skip', info.label, 'Skipping — stopping at the next safe point', {
    taskId: id,
    detail:
      'The step in hand finishes first, then the queue moves on to the next task. ' +
      'This run only — the next scheduled one is unaffected.'
  })

  await publish()

  return ok(await stateOf())
}

/* -------------------------------------------------------------------------- *
 * What the monitor drives
 * -------------------------------------------------------------------------- */

/**
 * THE ONE QUEUE EVERY RUN WAITS ON.
 *
 * A monitor pass and a Run now both go through this chain, so "only one cron
 * at a time" is a property of the code rather than a rule two callers have to
 * remember. Without it a Run now pressed during a monitor pass would start a
 * second browser automation on top of the first.
 */
let chain: Promise<unknown> = Promise.resolve()

/** Queues work on the single chain. Rejections never break the chain. */
export const serialise = <T>(work: () => Promise<T>): Promise<T> => {
  const run = chain.then(work, work)

  chain = run.catch(() => undefined)

  return run
}

/** True while a cron is actually executing, from this process's point of view. */
export const isScheduleBusy = (): boolean => running.size > 0

/**
 * Runs one task as the SCHEDULE, not as a Run now.
 *
 * THE MONITOR IS ITS ONLY CALLER — that is the rule this export exists to
 * keep. Anything else that wants a task to run asks the monitor for a pass
 * (`requestMonitorCheck`) and lets it decide whether the task is owed.
 */
export const runScheduledTask = (id: ScheduledTaskId): Promise<Result<TaskOutcome>> =>
  runTask(id, false)

/**
 * Runs one task as a Run now: recorded as manual, and not stopped by the
 * master switch. The monitor is its only caller too — `runTaskNow` below checks
 * the request and hands it over through `requestManualRun`.
 */
export const runManualTask = (id: ScheduledTaskId): Promise<Result<TaskOutcome>> =>
  runTask(id, true)

/**
 * Why the schedule is off, if it is.
 *
 *   none      on
 *   operator  somebody switched it off
 *   sessions  the app switched it off because logins need re-capturing
 *
 * EITHER WAY NOTHING RUNS — the Login update included. The reason is kept only
 * so a capture can lift the app's own pause (`releaseSessionPause`) without
 * ever undoing an operator's.
 */
export const scheduleHold = async (): Promise<'none' | 'operator' | 'sessions'> => {
  if (!(await isPaused())) return 'none'

  return (await pauseReason())?.reason === 'sessions' ? 'sessions' : 'operator'
}

/* -------------------------------------------------------------------------- *
 * Settings
 * -------------------------------------------------------------------------- */

/**
 * Turns one task on or off, or changes how often it runs.
 *
 * Switching a task ON sets its baseline to now, which is what stops it firing
 * immediately: with no baseline there is no way to tell "armed a minute ago"
 * from "has not run for a week", and treating that as owed would open a browser
 * on top of whoever just used the switch.
 *
 * THE SAME VALIDATION THE DIALOG RUNS, deliberately repeated here. A schedule
 * only the form checks is one an IPC call can still write — and this is the
 * thing that decides when a browser opens on an unattended machine.
 */
export const saveTaskSchedule = async (
  payload: unknown
): Promise<Result<AutomationScheduleState>> => {
  const request = (payload ?? {}) as { taskId?: unknown; enabled?: unknown; cron?: unknown }

  if (!isScheduledTaskId(request.taskId)) return fail('VALIDATION_ERROR', 'Unknown task')

  const enabled = request.enabled === true
  const raw = (request.cron ?? null) as CronSchedule | null
  const cron = raw ? normaliseCron(raw) : null

  if (cron) {
    const problem = cronProblem(cron)

    if (problem) return fail('VALIDATION_ERROR', problem)
  }

  if (enabled && !cron) return fail('VALIDATION_ERROR', 'Set a schedule before turning this on')

  const current = await readTaskRecord(request.taskId)
  const previous = current?.cron ?? cronFromLegacyTime(current?.time)
  const changed = JSON.stringify(previous) !== JSON.stringify(cron)

  await writeTaskRecord(request.taskId, {
    enabled,
    cron,
    // The single-time field this replaced. Cleared on any write, so a record
    // cannot carry two schedules that disagree — the reader prefers `cron`,
    // and a stale `time` beside it would be a trap for whoever reads the file.
    time: null,
    // Re-based whenever it is switched on, and whenever the schedule CHANGES: a
    // task moved from 02:00 to 23:00 at midday must not read as owed for 02:00,
    // and one moved to "every 15 minutes" must not be instantly overdue.
    ...(enabled && (!current?.enabled || changed)
      ? { baselineAt: Date.now(), failedAttempts: 0 }
      : {})
  })

  logger.info(
    `[schedule] ${scheduledTaskInfo(request.taskId).label}: ` +
      (enabled ? `${describeCron(cron)} IST` : 'off')
  )

  await publish()
  // Its next trigger has moved. Re-planned only — editing a schedule is not a
  // reason to start anything.
  requestMonitorCheck({ reason: `${scheduledTaskInfo(request.taskId).label} was rescheduled`, planOnly: true })

  return ok(await stateOf())
}

/** Runs one task now. Same path as the schedule; see `runTask`. */
export const runTaskNow = async (payload: unknown): Promise<Result<TaskOutcome>> => {
  const taskId = (payload ?? {}) as { taskId?: unknown }

  if (!isScheduledTaskId(taskId.taskId)) return fail('VALIDATION_ERROR', 'Unknown task')

  /*
   * STILL REFUSED WHILE SOMETHING HOLDS THE BROWSER, and deliberately, even
   * though a task running is no longer a reason to refuse (see `runTask`).
   *
   * The two are not the same guard. Most browser work queues on the lock and is
   * safe to start behind — but the SESSION CAPTURE does not take that lock at
   * all; it guards itself per platform. So with this gone, a Run now during a
   * bulk claim could put a second marketplace browser on screen, which is the
   * one thing the lock exists to prevent.
   */
  if (isAutomationBusy()) {
    return fail('CONFLICT', `${automationHolder()} is using the browser — try again when it ends`)
  }

  const id = taskId.taskId


  /*
   * REFUSED IF THIS TASK IS ALREADY GOING OR ALREADY WAITING.
   *
   * Serialising alone would turn a double-click into two runs back to back
   * rather than two at once — still two, and this task files claims. The
   * `running` check inside `runTask` cannot catch it either, because by the
   * time the second one reaches the front of the queue the first has finished.
   * So the refusal has to happen when the button is pressed.
   */
  if (running.has(id) || pendingManual.has(id)) {
    return fail('CONFLICT', `${scheduledTaskInfo(id).label} is already running`)
  }

  /*
   * HANDED TO THE MONITOR rather than started here. The monitor is the only
   * thing that starts a task, Run now included: it queues the run on the same
   * chain as its own passes, so it never runs beside a scheduled task, and it
   * re-plans its next wake-up from the completion this run records.
   */
  pendingManual.add(id)

  try {
    return await requestManualRun(id)
  } finally {
    pendingManual.delete(id)
  }
}

/**
 * Requests for a run that arrived while the task was already going, or while
 * the browser was busy. A SET, so fifteen saves during one run still make one
 * follow-up run — which reads the whole list again and so covers all fifteen.
 */
const followUp = new Set<ScheduledTaskId>()
/** Tasks already waiting for the browser to come free, so one waits, not many. */
const awaitingBrowser = new Set<ScheduledTaskId>()

/**
 * Start a task because something happened — a claim was saved — rather than
 * because the operator pressed Run now.
 *
 * THE SAME PATH AS RUN NOW (the monitor's chain), with two differences:
 *   • never a second run. Already running or queued, the request is noted
 *     and one more run follows when this one ends — so a claim saved while
 *     Auto claim is mid-run is still filed, without two runs side by side;
 *   • it respects the task's own switch. An Auto claim the operator turned
 *     off is not turned back on by a save. The Automations switch is
 *     respected too: with it off there is no monitor to run anything.
 *
 * Never throws and returns nothing: the caller has already succeeded at its
 * own work, and a run that could not start is a log line, not its failure.
 */
export const requestTaskRun = async (id: ScheduledTaskId, reason: string): Promise<void> => {
  const label = scheduledTaskInfo(id).label

  try {
    const record = await readTaskRecord(id)

    if (record?.enabled !== true) {
      logger.info(`[schedule] ${label} not started after ${reason} — the task is switched off`)

      return
    }

    if (running.has(id) || pendingManual.has(id)) {
      if (!followUp.has(id)) logger.info(`[schedule] ${label} is running — it runs again after (${reason})`)
      followUp.add(id)

      return
    }

    // Something else holds the browser (a Create Ticket batch, a capture).
    // Waits for it to finish rather than refusing — the lock tells us when.
    if (isAutomationBusy()) {
      if (awaitingBrowser.has(id)) return

      awaitingBrowser.add(id)
      logger.info(`[schedule] ${label} waits for ${automationHolder()} to finish (${reason})`)

      void whenAutomationFree().then(() => {
        awaitingBrowser.delete(id)
        void requestTaskRun(id, reason)
      })

      return
    }

    pendingManual.add(id)
    logger.info(`[schedule] ${label} started — ${reason}`)

    try {
      const outcome = await requestManualRun(id)

      if (!outcome.success) logger.info(`[schedule] ${label} after ${reason}: ${outcome.error.message}`)
    } finally {
      pendingManual.delete(id)
    }
  } catch (error) {
    logger.warn(`[schedule] ${label} could not be started after ${reason}`, error)
  }
}

/**
 * One task's execution history, newest first.
 *
 * Straight from the local database rather than from anything this process
 * holds: the rows outlive the process, and a crash — the case the history
 * exists to explain — is precisely when memory has nothing to say.
 */
export const taskHistory = async (payload: unknown): Promise<Result<CronExecution[]>> => {
  const request = (payload ?? {}) as { taskId?: unknown }

  /*
   * NO TASK MEANS EVERY TASK, merged and newest first.
   *
   * The per-task view answers "is this one healthy"; the merged view answers
   * "what has this machine actually done", which is the question asked of a
   * run history and cannot be read off four separate lists without somebody
   * interleaving them by hand.
   */
  if (request.taskId === undefined || request.taskId === null) {
    const all = await Promise.all(SCHEDULED_TASK_IDS.map(id => readHistory(id)))

    /*
     * COMPLETION BREAKS A TIE ON THE START TIME, and the tie is not rare: tasks
     * run back to back, and four of them can start inside the same millisecond
     * on a machine with nothing to do. A plain sort on `startedAt` then leaves
     * the order to whatever the arrays happened to be in — which is registry
     * order, i.e. oldest-looking first, the exact opposite of what this asks
     * for. They finish in the order they ran, so that settles it.
     */
    return ok(
      all.flat().sort((a, b) => {
        const started = Date.parse(b.startedAt) - Date.parse(a.startedAt)

        if (started !== 0) return started

        return Date.parse(b.completedAt ?? b.startedAt) - Date.parse(a.completedAt ?? a.startedAt)
      })
    )
  }

  if (!isScheduledTaskId(request.taskId)) return fail('VALIDATION_ERROR', 'Unknown task')

  return ok(await readHistory(request.taskId))
}

/**
 * Stops retrying a failed run, on the operator's say-so.
 *
 * WHAT IT IS FOR NOW. The monitor passes over a failure by itself — the tasks
 * after it run regardless — but it retries the failed task on every check. Some
 * failures cannot clear on their own (a login that needs a person), and
 * retrying them every half hour only opens a browser to be refused again. A
 * skip ends that: it is written into the history as `skipped`, so the task is
 * no longer owed a retry, and its next scheduled run happens normally.
 *
 * REFUSED WHEN THERE IS NOTHING TO SKIP. Skipping a healthy task would mean
 * marking work as dealt with that nobody has looked at, and the button only
 * exists beside a failure.
 */
export const skipBlockedRun = async (
  payload: unknown
): Promise<Result<AutomationScheduleState>> => {
  const request = (payload ?? {}) as { taskId?: unknown }

  if (!isScheduledTaskId(request.taskId)) return fail('VALIDATION_ERROR', 'Unknown task')

  const id = request.taskId
  const info = scheduledTaskInfo(id)

  // Not while it is going: the run may yet succeed, and skipping it would
  // record a decision about an outcome nobody has seen.
  if (running.has(id)) {
    return fail('CONFLICT', `${info.label} is running — wait for it to finish`)
  }

  const snapshot = await snapshotOf(id)

  if (snapshot.lastStatus !== 'failed') {
    return fail('VALIDATION_ERROR', `${info.label} has not failed — there is nothing to skip`)
  }

  /*
   * The SLOT is recorded as well as the decision, so a fixed-time task does not
   * simply become due again a minute later. Skipping answers this occurrence;
   * the next one comes round normally.
   */
  await recordSkip(id, snapshot.occurrence, 'Passed over by the operator after a failure')

  cronLog('skip', info.label, 'Skipped by the operator after a failure', {
    taskId: id,
    detail: 'The tasks after it may now run. This task will try again at its next scheduled time.'
  })

  await writeTaskRecord(id, { lastError: null })
  await publish()

  // Whatever was waiting behind it can go now — if the monitor finds it owed.
  requestMonitorCheck({ reason: `${info.label} was skipped after a failure` })

  return ok(await stateOf())
}

/**
 * Puts every task back to the schedule the app ships with.
 *
 * WHAT IT RESTORES is the same thing a fresh machine gets — `defaultCron` from
 * the registry, switched on — because that is what "reset" has to mean to be
 * worth pressing: an operator who has turned things off and moved times about
 * needs one way back to a known state, not a note in a manual about what the
 * defaults were.
 *
 * WHAT IT KEEPS is the history. `lastRunAt` and the last outcome describe runs
 * that really happened, and a card claiming "has not run on this machine yet"
 * about a machine that ran all week would be a lie told by a settings button.
 * The failure COUNT goes, because it is about the schedule rather than the
 * past: a task that gave up after three attempts should get its three back.
 *
 * A task already running is left to finish. Nothing here touches the run; the
 * new schedule applies from its next window.
 */
export const resetSchedule = async (): Promise<Result<AutomationScheduleState>> => {
  for (const id of SCHEDULED_TASK_IDS) {
    await writeTaskRecord(id, {
      enabled: true,
      cron: scheduledTaskInfo(id).defaultCron,
      time: null,
      baselineAt: Date.now(),
      failedAttempts: 0,
      lastError: null
    })
  }

  logger.info('[schedule] reset to the shipped defaults')
  await publish()
  requestMonitorCheck({ reason: 'the schedule was reset', planOnly: true })

  return ok(await stateOf())
}

/* -------------------------------------------------------------------------- *
 * Start-up
 * -------------------------------------------------------------------------- */

/**
 * Carries a daily backup time this machine already had onto the new schedule.
 *
 * The AJIO card used to arm its own `setTimeout` on `dailyTime`. An operator who
 * set 02:30 there should not have to discover that it stopped meaning anything —
 * so the first time this runs with no AJIO record, that time becomes the task's,
 * switched on. Once. After that the schedule owns it, and a task switched off
 * deliberately stays off.
 *
 * The one thing that changes is whose clock it is: `dailyTime` was the machine's
 * local time and this is IST. On a machine in IST — every machine running this —
 * that is the same minute.
 */
const migrateBackupTime = async (): Promise<void> => {
  if (await readTaskRecord('ajio-master-data')) return

  const { dailyTime } = await readBackupSettings()

  if (!isValidSyncTime(dailyTime)) return

  await writeTaskRecord('ajio-master-data', {
    enabled: true,
    time: dailyTime,
    baselineAt: Date.now()
  })
  logger.info(`[schedule] carried the AJIO daily re-sync (${dailyTime}) onto the schedule`)
}

/**
 * Arms the shipped schedule on a machine that has never set one.
 *
 * An installation with everything off does nothing all night and looks exactly
 * like one that is working — the card says "Has not run on this machine yet"
 * either way, and the first anyone knows is a month of claims nobody filed. So
 * the defaults in the registry are what a fresh machine DOES, and turning a
 * task off is the deliberate act.
 *
 * ONLY WHERE THERE IS NO RECORD. A record exists the moment an operator touches
 * a task, so a deliberate "off" is never quietly switched back on — which is
 * also why this runs AFTER `migrateBackupTime`: that carries a time the
 * operator already chose, and seeding first would hide it behind a default.
 */
const seedShippedSchedule = async (): Promise<void> => {
  for (const taskId of SCHEDULED_TASK_IDS) {
    if (await readTaskRecord(taskId)) continue

    const { defaultCron } = scheduledTaskInfo(taskId)

    await writeTaskRecord(taskId, {
      enabled: true,
      cron: defaultCron,
      baselineAt: Date.now()
    })
    logger.info(`[schedule] armed ${taskId} with its shipped schedule: ${describeCron(defaultCron)}`)
  }
}

/** The task everything else signs in with. */
export const SESSIONS: ScheduledTaskId = 'session-refresh'

export const sessionsEnabled = async (): Promise<boolean> =>
  (await readTaskRecords()).find(entry => entry.taskId === SESSIONS)?.enabled === true

/**
 * Puts the shipped schedule back if it is missing, then asks the monitor to
 * catch up.
 *
 * WHAT IS OWED IS NOT DECIDED HERE. The app is closed overnight and over
 * weekends, so a launch or a sign-in usually finds work owed — but which work,
 * in what order, and whether the logins are re-checked first is the monitor's
 * call (`catchUp` in `monitor.service.ts`). This only makes sure there is a
 * schedule for it to read.
 */
const seedThenCatchUp = async (reason: string): Promise<void> => {
  await seedShippedSchedule()
  requestMonitorCheck({ reason, catchUp: true })
}

/**
 * Puts the schedule back after somebody signs in.
 *
 * THE BUG THIS FIXES. Signing out wipes this machine's local data, the schedule
 * records included — and the scheduler is armed once, at launch, so nothing
 * re-seeded them. The next operator signed in to an app whose tick found no
 * task enabled: no session update, no backup, no refill, no claims, and an
 * empty history that made it look as though nothing was due. It stayed that way
 * until somebody restarted the app.
 *
 * So a sign-in does what a launch does — put the shipped schedule back if it is
 * missing, then run whatever this machine has not run within the hour, which
 * for a fresh sign-in is all four.
 */
export const resumeSchedule = (): void => {
  // Signing in resumes the schedule, so it re-arms as surely as a launch does.
  // Without this a sign-out followed by a sign-in leaves the queue disarmed and
  // nothing ever runs again until the app restarts.
  disarmed = false

  /*
   * AND THE TRANSIENT STOP GOES WITH IT.
   *
   * Signing out asks whatever is running to stop at its next safe boundary,
   * and that request lives in memory until something clears it. The only
   * thing that did was the master switch being turned back ON — so a sign-out
   * followed by a sign-in left the flag set, and every task started and
   * stopped again at its first boundary, for ever, with the switch showing On.
   */
  clearScheduleStop()

  void (async () => {
    // Not while the schedule is switched off. Signing in is not a decision to
    // start everything again — the operator who switched it off has to switch
    // it back on, which is the whole point of the flag surviving a restart.
    if (await isPaused()) {
      logger.info('[schedule] sign-in did not resume the schedule: it is switched off')

      return
    }

    await seedThenCatchUp('signed in')
  })().catch(error => logger.warn('[schedule] could not resume after sign-in', error))
}

/**
 * The master switch: stop the whole schedule, or start it again.
 *
 * OFF stops the tick and drops whatever was queued, immediately. What it does
 * NOT do is kill a task already running: it finishes the step it is on. That is
 * a deliberate limit, and the same one `stopReClaim` draws — a claim abandoned
 * half-submitted can exist on the marketplace with no row here recording it,
 * and the next run would file it again. The state reports `stopping` until the
 * last one lets go, so the switch never claims to have done more than it has.
 *
 * ON re-arms the tick and then catches up: the tasks whose window was missed,
 * in dependency order, one at a time. Not every task unconditionally — flipping
 * the switch should not open a browser and file claims that were filed twenty
 * minutes ago.
 *
 * PERSISTED, so a machine that is switched off stays switched off across a
 * restart. Otherwise the operator who stopped everything at midnight because a
 * marketplace was throwing errors finds it all running again at nine.
 */
/**
 * Stop everything because the logins are not usable — and say so.
 *
 * WHY THIS IS AUTOMATIC. Every task below the Login update signs in with the
 * sessions it re-captures: a refill asks the marketplace, a claim files on it.
 * Running them with logins the marketplace has refused does not fail cleanly —
 * it spends a night opening browsers, burns each claim's attempts against a
 * dead session, and leaves rows marked Failed for a reason that has nothing to
 * do with the claim. Stopping is the honest response, and nobody is awake at
 * 02:00 to decide it.
 *
 * NOT THE OPERATOR'S SWITCH, though it moves the same lever. It is recorded as
 * the app's own decision, so `releaseSessionPause` can take it back when the
 * logins are fixed — and so a deliberate "not tonight" is never undone by a
 * capture landing.
 *
 * @param detail which logins, in the words the sidebar will show
 */
/*
 * A CAPTURE ANYWHERE LIFTS THE HOLD.
 *
 * The Login update is not the only way a login gets fixed: an operator who
 * re-captures one by hand on the Login page has done the same work, and
 * leaving the automations off until the next hourly run would make the app
 * look stuck — they fixed the thing the alert named and nothing happened.
 *
 * Only ever RELEASES. A capture is never a reason to start holding, so the
 * decision here is one-way; the hold itself is set after a Login update, from
 * what that run actually left behind.
 */
onSessionChanged(() => {
  void (async () => {
    try {
      if ((await scheduleHold()) !== 'sessions') return

      // A hold the flag no longer permits goes now, whatever the logins say.
      const { count } = sessionPauseEnabled() ? await outstandingSessions() : { count: 0 }

      await releaseSessionPause(count)
    } catch (error) {
      logger.warn('[schedule] could not re-check the login hold after a capture', error)
    }
  })()
})

/**
 * Pause or resume on the state of the logins, whichever way it has gone.
 *
 * Best effort: a switch that could not be written must not fail a Session
 * update that did its work, and the next run asks again.
 */
const settleAgainstSessions = async (trigger: RunTrigger): Promise<void> => {
  try {
    /*
     * THE OPERATOR MAY NOT WANT THIS AT ALL.
     * `AUTOMATION_PAUSE_ON_SESSION_FAIL = false` means "leave the automations
     * on and let them try anyway" — for the machine where one marketplace is
     * permanently unhappy and the other seven working matters more than being
     * held for it.
     *
     * It also RELEASES, not merely declines to pause: a hold set while the
     * flag was on would otherwise outlive it, leaving the schedule off for a
     * rule that no longer applies and no obvious way to see why.
     */
    if (!sessionPauseEnabled()) {
      await releaseSessionPause(0)

      return
    }

    const { count, detail } = await outstandingSessions()

    if (count === 0) {
      await releaseSessionPause(0)

      return
    }

    /*
     * NOT WHEN AUTOMATIONS WERE JUST SWITCHED ON BY HAND.
     *
     * The TOGGLE_ON automation runs every task, compulsorily — that is what an
     * operator switching it on asked for. Pausing here, after its first task,
     * turned "run everything now" into "run the Login update and stop", which
     * is the opposite. So the remaining tasks run: the claims pass over the
     * accounts whose login was refused (`onDeadSession: 'skip'`) and the refill
     * skips marketplaces with no live session, so nothing is filed on a dead
     * login. The safeguard still applies to every SCHEDULED Login update.
     */
    if (trigger === AUTOMATION_MODES.TOGGLE_ON) {
      cronLog('waiting', 'Automations', 'Logins need re-capturing — carrying on', {
        detail:
          `${detail}. Automations were switched on by hand, so every task still runs; ` +
          'accounts with a refused login are passed over. The next scheduled Login update pauses as usual.'
      })

      return
    }

    await pauseForSessions(detail)
  } catch (error) {
    logger.warn('[schedule] could not settle the automations switch against the logins', error)
  }
}

/**
 * Pass over one marketplace on the task that is running.
 *
 * ONLY WHILE IT RUNS, and only for a task that is actually going: a skip
 * recorded against an idle task would sit in memory and surprise whoever
 * started it next.
 *
 * The runner decides what passing over MEANS for it — an account not signed
 * in, a marketplace's remaining rows left unasked, its claims left unfiled —
 * and each reports it as skipped rather than failed, because nobody tried.
 */
export const skipRunningPlatform = async (
  payload: unknown
): Promise<Result<AutomationScheduleState>> => {
  const { taskId, platform } = (payload ?? {}) as { taskId?: unknown; platform?: unknown }

  if (typeof taskId !== 'string' || !SCHEDULED_TASK_IDS.includes(taskId as ScheduledTaskId)) {
    return fail('VALIDATION_ERROR', 'Say which automation to skip a marketplace on.')
  }

  if (typeof platform !== 'string' || platform.trim() === '') {
    return fail('VALIDATION_ERROR', 'Say which marketplace to pass over.')
  }

  if (!running.has(taskId as ScheduledTaskId)) {
    return fail('VALIDATION_ERROR', 'That automation is not running.')
  }

  requestPlatformSkip(taskId, platform)
  cronLog('waiting', scheduledTaskInfo(taskId as ScheduledTaskId).label, 'Marketplace skipped', {
    taskId: taskId as ScheduledTaskId,
    detail: `${platform} passed over by hand — the rest of the run carries on.`
  })

  return ok(await stateOf())
}

export const pauseForSessions = async (detail: string): Promise<void> => {
  // Already off by somebody's choice: leave their decision, and their reason,
  // exactly where they are.
  if (await isPaused()) return

  await writePaused(true, 'sessions', detail)

  /*
   * THE SAME OFF AS THE OPERATOR'S: the monitor stops and every background
   * process stops at its next step — the Login update included. Nothing runs
   * until the logins are captured by hand on the Login page (a capture lifts
   * this pause; see `onSessionChanged` above) or somebody switches Automations
   * back on.
   */
  requestScheduleStop()
  queued.clear()
  automationsSwitched(false)

  logger.warn(`[schedule] switched OFF by the app — ${detail}`)
  cronLog('waiting', 'Automations', 'Paused — logins need re-capturing', {
    detail: `${detail}. Nothing below the Login update can run on a login the marketplace refuses.`
  })

  await publish()
}

/**
 * Start again once every login is good — and ONLY from the pause this file set.
 *
 * The other half of the feature: an operator who re-captures the accounts that
 * caused the stop should not also have to find the switch. But a schedule the
 * OPERATOR turned off stays off, whatever the sessions do, which is why the
 * reason is recorded rather than just the flag.
 *
 * Called whenever session health changes — a capture, a verdict, the Login
 * update finishing — so it is cheap and says nothing when there is nothing to
 * say.
 */
export const releaseSessionPause = async (outstanding: number): Promise<boolean> => {
  if (outstanding > 0) return false

  const reason = await pauseReason()

  if (reason?.reason !== 'sessions') return false

  await writePaused(false)
  clearScheduleStop()
  automationsSwitched(true)

  logger.info('[schedule] every login is good again — switching automations back ON')
  cronLog('start', 'Automations', 'Resumed — every login is updated', {
    detail: 'The app stopped the schedule because logins needed re-capturing; they no longer do.'
  })

  await publish()
  requestMonitorCheck({ reason: 'every login is good again', catchUp: true })

  return true
}

export const setSchedulePaused = async (payload: unknown): Promise<Result<AutomationScheduleState>> => {
  const { paused } = (payload ?? {}) as { paused?: unknown }

  if (typeof paused !== 'boolean') {
    return fail('VALIDATION_ERROR', 'Say whether the schedule should be on or off.')
  }

  await writePaused(paused, 'operator')

  if (paused) {
    // FIRST, and synchronously: a task already running reads this between its
    // own units of work — between the seven accounts of a Session update,
    // between marketplaces on a refill, between claims on the nightly run.
    // Without it "stop" only meant "do not start the NEXT task", which on a
    // Session update is several minutes of logins away.
    requestScheduleStop()
    stopAutomationScheduler()
    queued.clear()
    // A forced pass belongs to the switch-on that asked for it. Left armed, it
    // would ambush whoever turns the schedule back on tomorrow.
    forced.clear()
    // Only meaningful while something is still going; `stateOf` folds that in.
    stopping = true
    // The monitor goes off, and every background process with it.
    automationsSwitched(false)
    logger.info(
      running.size > 0
        ? `[schedule] switched OFF — ${running.size} task(s) will stop after the step in flight`
        : '[schedule] switched OFF'
    )
  } else {
    clearScheduleStop()
    stopping = false

    /*
     * ON MEANS "DO THE NIGHT'S WORK NOW", not "wait for the next window".
     *
     * Every enabled task is marked due for this one pass. The queue then runs
     * them in the ordinary order, one at a time; a failure is passed over and
     * the rest carry on — the switch decides WHETHER, not what order.
     *
     * Only the ENABLED ones: a task the operator turned off in Settings stays
     * off, because that is a different decision and this must not quietly
     * overrule it.
     */
    const enabled = (await snapshots()).filter(task => task.enabled)

    forced.clear()
    for (const task of enabled) forced.add(task.id)

    logger.info(
      enabled.length > 0
        ? `[schedule] switched ON — running all ${enabled.length} enabled task(s) from the top`
        : '[schedule] switched ON — no task is enabled, so there is nothing to run'
    )
    // The monitor comes back on, and the background processes with it — as
    // the TOGGLE_ON automation, which also imports every platform once.
    automationsSwitched(true, AUTOMATION_MODES.TOGGLE_ON)
    startAutomationScheduler()
  }

  const state = await stateOf()

  await publish()

  return ok(state)
}

/**
 * Launch: Automations OFF, a short pause, then ON — see AUTOMATION_LAUNCH_OFF_MS.
 *
 * Through `setSchedulePaused`, the operator's own toggle path, so the switch on
 * screen shows it and a launch is exactly a hand switch-on: every enabled task
 * runs once, one at a time, from the top.
 */
export const switchOnAtLaunch = async (switchOn = true): Promise<void> => {
  await setSchedulePaused({ paused: true })

  // Settings → Common settings said to open with Automations off. The pause
  // above is the operator's kind, so it stays off until somebody moves the
  // switch — exactly as if they had switched it off by hand.
  if (!switchOn) {
    logger.info('[schedule] launch — Automations left off, as Common settings asks')

    return
  }

  logger.info(`[schedule] launch — Automations off for ${AUTOMATION_LAUNCH_OFF_MS / 1000}s, then on`)
  await new Promise(resolve => setTimeout(resolve, AUTOMATION_LAUNCH_OFF_MS))

  const result = await setSchedulePaused({ paused: false })

  if (!result.success) logger.warn(`[schedule] launch — could not switch Automations on: ${result.error.message}`)
}

export const startAutomationScheduler = (): void => {
  if (armed) return

  void (async () => {
    // A machine that was switched off stays off across a restart. Checked here
    // rather than by the caller so every entry point — launch, sign-in, the
    // switch — gets the same answer.
    // Switched the flag off since last time? Then a hold left over from when
    // it was on is lifted here, at the first moment the app is in a position
    // to notice — rather than at the next Login update, hours away.
    // Guarded on its own: arming is the thing that makes this machine work at
    // all, and a store read that failed here must not be the reason nothing
    // ran tonight.
    try {
      if (!sessionPauseEnabled()) await releaseSessionPause(0)
    } catch (error) {
      logger.warn('[schedule] could not re-check the login hold while arming', error)
    }

    // A hold on the logins still arms: the Login update has to keep trying, or
    // the hold it set could never lift.
    if ((await scheduleHold()) === 'operator') {
      logger.info('[schedule] not armed: the schedule is switched off')

      return
    }

    await armScheduler()
  })().catch(error => logger.warn('[schedule] could not arm', error))
}

const armScheduler = async (): Promise<void> => {
  if (armed) return

  // Set before the first await, so a second start arriving mid-arm cannot run
  // the recovery and the catch-up twice.
  armed = true
  disarmed = false

  await migrateBackupTime()
    .catch(error => logger.warn('[schedule] could not read the old backup time', error))

  /*
   * NOTE ANYTHING THE APP DIED INSIDE, before the first pass.
   *
   * A row still without a completion in a FRESH PROCESS cannot be running: the
   * app holds the single-instance lock, so there is nobody else to be working
   * it. It is NOT closed — no completion is written for a run that did not
   * end. It stays incomplete, and the monitor runs that job again before the
   * jobs after it.
   */
  const interrupted = await recoverInterruptedExecutions().catch(error => {
    logger.warn('[SCHEDULER] could not recover interrupted executions', error)

    return [] as string[]
  })

  for (const id of interrupted) {
    const taskId = isScheduledTaskId(id) ? id : null

    cronLog(
      'failure',
      taskId ? scheduledTaskInfo(taskId).label : id,
      'Incomplete — the app stopped mid-run',
      {
        taskId,
        detail: 'Left without a completion time. The monitor runs it again, ahead of the tasks after it.'
      }
    )
  }

  cronLog(
    'info',
    'Schedule',
    `Armed — the monitor checks every ${AUTOMATION_MONITOR_INTERVAL_MINUTES} minutes`
  )

  // No timer here: the monitor's is the only one. This asks it for a first
  // pass now rather than leaving the launch to wait half an hour.
  void seedThenCatchUp('the schedule was armed').catch(error =>
    logger.warn('[schedule] catch-up failed', error)
  )
}

export const stopAutomationScheduler = (): void => {
  // The monitor keeps waking, and finds this set: a pass already on the chain
  // stops before its next task, and no new one starts anything.
  disarmed = true
  armed = false
}
