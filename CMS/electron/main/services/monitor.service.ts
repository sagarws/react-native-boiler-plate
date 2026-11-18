import { net } from 'electron'
import {
  AUTOMATION_MONITOR_INTERVAL_MINUTES,
  AUTOMATION_MONITOR_INTERVAL_MS
} from '@shared/constants/automationMonitor'
import { scheduledTaskInfo } from '@shared/constants/automationSchedule'
import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import { nextMonitorWake, planQueue } from '@shared/utils/cronQueue'
import { fail } from '@shared/types/result'
import { AUTOMATION_MODES } from '@shared/constants/automationModes'
import { automationHolder, isAutomationBusy, whenAutomationFree } from './automationLock'
import {
  SESSIONS,
  isDisarmed,
  isScheduleBusy,
  runManualTask,
  runScheduledTask,
  serialise,
  sessionsEnabled,
  setQueued,
  snapshots
} from './automationScheduler.service'
import { cronLog } from './cronLog.store'
import { logger } from './logger'
import {
  onAutomationsSwitched,
  onMonitorCheckRequested,
  registerManualRunner,
  type MonitorCheckRequest
} from './monitorSignal'
import { automationsHalted, isPaused, onStopRequested } from './schedulerPause.store'
import { getSession } from './session.store'
import {
  forceImportsOnce,
  nextImportAt,
  runDueImports,
  startImportScheduler,
  stopImportScheduler
} from './importScheduler.service'
import {
  drainQueueIfDue,
  nextQueueCheckAt,
  startMasterImportQueue,
  stopMasterImportQueue
} from './masterImportQueue.service'
import { startDraining } from './claimAutoRunner.service'
import { stopReClaim } from './reClaim.service'

/**
 * THE AUTOMATION MONITOR — the only thing that starts a scheduled task.
 *
 * TWO KINDS OF AUTOMATION run through it, defined in
 * `shared/constants/automationModes.ts` and recorded on every history row as
 * `trigger`: SCHEDULE (a task is owed by its time, its interval, a missed slot,
 * a retry or an incomplete run) and TOGGLE_ON (Automations switched from off
 * to on: every enabled task once, now). Run now is neither — it is `manual`.
 *
 * It reads two things off disk:
 *
 *   automation-schedule        what each task is set to: on or off, and when
 *   cron-history-<taskId>      one table per task: every run, how it ended
 *
 * and, on the same pass, the MASTER IMPORT: its times come from TrackVid's
 * settings (`masterImportSyncTime`, written from Trackvid-Monitor) and its runs
 * are recorded in `import-schedule`, so `importScheduler.service` decides which
 * platform is owed and `masterImportQueue.service` when a requested report is
 * next checked — but neither has a timer. The monitor wakes for them too.
 *
 * and from them alone decides what is owed (`planQueue`), then runs it — one
 * task at a time, in dependency order, stopping at the first failure so the
 * tasks after it wait. Nothing it decides is held in memory between passes; a
 * restart rebuilds the same answer from the same tables.
 *
 * IT SLEEPS UNTIL THE NEXT TRIGGER, worked out from the system clock and each
 * task's schedule (`nextMonitorWake`): a fixed time wakes it at that time of
 * day (IST), an interval at the last completion plus the interval. So a 10:00
 * sync starts at 10:00, not at the next half-hour. It never sleeps longer than
 * AUTOMATION_MONITOR_INTERVAL_MINUTES — that routine check is what retries a
 * failure and picks up work that was due but could not start (offline, the
 * browser in use), and it is the safety net if a timer is lost to
 * sleep.
 *
 * ONE DOOR IN. The launch, a sign-in, the master switch, a skip and a login fix
 * all used to start the queue themselves. They now ask for a pass
 * (`requestMonitorCheck`) and this decides. Run now comes through here too
 * (`requestManualRun`): the scheduler checks the button press, and this runs it
 * on the same queue as its passes.
 *
 * A TIMER IS A WAKE-UP, NOT THE SCHEDULE. Electron sleeps and has its timers
 * paused by the OS, so nothing here trusts the interval to have fired the right
 * number of times. Each pass works out the truth from the tables, which is why
 * a machine woken at 09:00 still runs the 02:00 slot once, and only once.
 */

/** How long to hold off after finding no network. */
const OFFLINE_RETRY_MS = 15 * 60 * 1000

let timer: NodeJS.Timeout | null = null
let started = false
let offlineUntil = 0

/*
 * ONE PASS WAITING AT A TIME.
 *
 * A launch, a sign-in and the interval can all ask within the same second.
 * Queuing three passes would run the second and third over tables the first
 * has just brought up to date — harmless, but noise in the log. So a request
 * arriving while one is still waiting to start joins it, and a catch-up asked
 * by either one is kept.
 */
let pending: { request: MonitorCheckRequest; done: Promise<void> } | null = null

/**
 * Asks the marketplace logins first when the app has been closed.
 *
 * THE SESSIONS GO FIRST EVEN WHEN THEY ARE NOT DUE, and this is the one rule
 * `planQueue` cannot work out for itself.
 *
 * THE BUG IT IS FOR. The staleness rule is per task, and that let this shape
 * through: Session update ran at 18:54, the app was reopened at 19:35, and the
 * catch-up found the AJIO sync, the refill and the claims all owed while the
 * sessions — forty-one minutes old — were not. Three jobs that sign in ran
 * against sessions nobody had asked the marketplace about.
 *
 * A session is not fresh because a clock says so; it is fresh because the
 * marketplace was asked. Anything ELSE being owed on a catch-up means this
 * machine has been shut, so the sessions are re-checked before the work that
 * depends on them — one probe per account when they are all fine.
 *
 * Returns false when the pass should stop here.
 */
const catchUp = async (): Promise<boolean> => {
  const plan = planQueue(await snapshots())
  const owed = plan.filter(decision => decision.due)

  if (owed.length === 0) return false

  if (!net.isOnline()) {
    cronLog('waiting', 'Schedule', 'Catch-up skipped — the machine is offline')

    return false
  }

  cronLog('info', 'Schedule', `Catching up on ${owed.length} task(s)`, {
    detail: owed.map(decision => scheduledTaskInfo(decision.id).label).join(' → ')
  })

  const sessions = plan.find(decision => decision.id === SESSIONS)
  const othersOwed = owed.some(decision => decision.id !== SESSIONS)

  if (
    othersOwed &&
    sessions !== undefined &&
    !sessions.due &&
    (await sessionsEnabled()) &&
    !(await automationsHalted())
  ) {
    cronLog('info', scheduledTaskInfo(SESSIONS).label, 'Re-checking logins first', {
      taskId: SESSIONS,
      detail: 'Everything else here signs in, and a session is only fresh once the marketplace has been asked.'
    })
    await runScheduledTask(SESSIONS)
  }

  return true
}

/**
 * Runs what is owed, one task at a time, re-reading the tables between each.
 *
 * ONE TASK, THEN LOOK AGAIN. Deciding a batch up front assumes the world holds
 * still for an hour, which it does not: one that falls due during a long run
 * should be picked up in this pass rather than half an hour later.
 *
 * A FAILURE IS PASSED OVER, AUTOMATICALLY. The failed task is noted as skipped
 * for this pass and the tasks after it run, in order. It is still due — its
 * latest row says it failed — so the monitor's next check tries it again.
 * `attempted` is what stops this pass picking the same failed task straight
 * back up and looping on it.
 */
const runDueTasks = async (): Promise<void> => {
  const attempted = new Set<ScheduledTaskId>()

  for (;;) {
    // Stopped means stopped: a pass already going must not start the next task
    // after the scheduler has been taken down.
    if (isDisarmed()) return
    // The Automations switch, read before every task: off — for any reason —
    // means nothing further starts.
    if (await automationsHalted()) return
    if (isScheduleBusy()) return
    if (Date.now() < offlineUntil) return

    const tasks = await snapshots()
    const plan = planQueue(tasks)
    const next = plan.find(decision => decision.eligible && !attempted.has(decision.id))

    if (!next) return

    const forced = tasks.find(task => task.id === next.id)?.forced === true

    const label = scheduledTaskInfo(next.id).label

    if (!net.isOnline()) {
      // Defer rather than fail: every one of these talks to a marketplace, and
      // starting offline only gets partway through and leaves half-written state.
      offlineUntil = Date.now() + OFFLINE_RETRY_MS
      cronLog('waiting', label, 'Due, but the machine is offline', {
        taskId: next.id,
        detail: 'Every one of these talks to a marketplace. The monitor will try again on its next check.'
      })

      return
    }

    if (isAutomationBusy() && forced) {
      /*
       * SWITCHED ON BY HAND: WAIT FOR THE BROWSER, DON'T GIVE UP.
       *
       * Toggle-on means every task, now. Deferring to the 30-minute check on a
       * busy browser turned that into "nothing at all" — a run abandoned by the
       * switch-off a moment earlier was still releasing the browser, and the
       * whole pass ended on the first task. So wait for it, unless Automations
       * are switched off again meanwhile.
       */
      cronLog('waiting', label, 'Due — waiting for the browser to be free', {
        taskId: next.id,
        detail: `${automationHolder()} is using it. Automations were switched on by hand, so this starts as soon as it is released.`
      })

      let unsubscribe = (): void => undefined

      await Promise.race([
        whenAutomationFree(),
        new Promise<void>(resolve => {
          unsubscribe = onStopRequested(resolve)
        })
      ])
      unsubscribe()

      // Back to the top: the switch, the network and the plan are read again.
      continue
    }

    if (isAutomationBusy()) {
      // Somebody is filing claims by hand, or a bulk run is going. Deferred to
      // the next pass rather than queued behind it: starting an unattended
      // browser sweep the moment a two-hour bulk claim ends, with nobody
      // expecting it, is the thing to avoid.
      cronLog('waiting', label, 'Due, but the browser is in use', {
        taskId: next.id,
        detail: `${automationHolder()} is using it. Starting an unattended run on top would put two marketplace windows on screen.`
      })

      return
    }

    await setQueued(
      plan
        .filter(decision => decision.id !== next.id && decision.due && !attempted.has(decision.id))
        .map(decision => decision.id)
    )
    cronLog('info', label, next.needsRecovery ? 'Due — retrying after a failure' : 'Due', {
      taskId: next.id
    })

    attempted.add(next.id)

    const result = await runScheduledTask(next.id)

    await setQueued([])

    // Switched off under it: the loop's own check ends the pass. Otherwise a
    // failure is passed over and the next task runs.
    if (!result.success && !(await automationsHalted())) {
      cronLog('skip', label, 'Failed — skipped, the rest carry on', {
        taskId: next.id,
        detail: 'Nothing waits on it. It is tried again on the monitor\'s next check.'
      })
    }
  }
}

const pass = async (request: MonitorCheckRequest): Promise<void> => {
  if (request.planOnly) return
  if (isDisarmed()) return
  if (await automationsHalted()) return

  logger.info(`[monitor] checking the schedule — ${request.reason}`)

  if (!request.catchUp || (await catchUp())) await runDueTasks()

  /*
   * THE MASTER IMPORT, on the same pass and the same queue, after the six
   * tasks — whatever they did. Each checks the switch itself.
   */
  await runDueImports()
  await drainQueueIfDue()
}

/**
 * Runs a monitor pass on the shared queue, joining one already waiting.
 *
 * Resolves when that pass has finished, so a caller — a test, mostly — can
 * know the tables are settled.
 */
export const runMonitorPass = (request: MonitorCheckRequest): Promise<void> => {
  if (pending) {
    pending.request.catchUp = pending.request.catchUp === true || request.catchUp === true
    // A real pass outranks a re-plan: joining must never turn one into the other.
    pending.request.planOnly = pending.request.planOnly === true && request.planOnly === true

    return pending.done
  }

  const entry: { request: MonitorCheckRequest; done: Promise<void> } = {
    request: { ...request },
    done: Promise.resolve()
  }

  entry.done = serialise(async () => {
    // Started: a request from here on queues the NEXT pass, because this one
    // has already read the tables it would have read.
    if (pending === entry) pending = null

    try {
      await pass(entry.request)
    } finally {
      // Whatever the pass did — ran everything, ran nothing, bailed early —
      // the next trigger is worked out again from what is on disk now.
      await planNextWake()
    }
  }).catch(error => logger.warn('[monitor] a pass failed', error))

  pending = entry

  return entry.done
}

/**
 * Sets the one timer for the soonest trigger, replacing any already set.
 *
 * A setTimeout re-planned after every pass, not a setInterval: the gap is
 * different every time — four minutes to the next hourly Login update, then
 * twenty to a fixed-time sync — and only a fresh read of the tables knows it.
 */
const planNextWake = async (): Promise<void> => {
  if (!started) return

  const now = Date.now()
  const wake = nextMonitorWake(await snapshots(), now, AUTOMATION_MONITOR_INTERVAL_MS)

  // Stopped while the tables were being read.
  if (!started) return

  if (timer) clearTimeout(timer)

  let at = wake.at
  let reason =
    wake.taskId === null
      ? `the ${AUTOMATION_MONITOR_INTERVAL_MINUTES}-minute check`
      : `${scheduledTaskInfo(wake.taskId).label} is due`

  /*
   * THE MASTER IMPORT'S TWO CLOCKS, on this one timer. Only a moment still
   * ahead counts, by the same rule as `nextMonitorWake`: an import that is due
   * now but could not run (offline, or failed) is retried on the routine check,
   * not in a loop.
   */
  const others: Array<[number | null, string]> = [
    [nextImportAt(), 'the master import is due'],
    [nextQueueCheckAt(), 'the master-import queue is due a check']
  ]

  for (const [candidate, label] of others) {
    if (candidate !== null && candidate > now && candidate < at) {
      at = candidate
      reason = label
    }
  }

  timer = setTimeout(() => {
    timer = null
    void runMonitorPass({ reason })
  }, at - now)
  // Unref so a pending wake-up never holds the app open during quit.
  timer.unref?.()

  logger.info(`[monitor] next check ${new Date(at).toISOString()} — ${reason}`)
}

onMonitorCheckRequested(request => {
  void runMonitorPass(request)
})

/**
 * Run now: one task, on the operator's say-so, whatever its schedule says.
 *
 * NOT A PASS. It runs the one task asked for and nothing after it, and it is
 * not held by the master switch — somebody pressed a button in front of them.
 * It waits its turn on the same queue as a pass, so it never starts beside a
 * scheduled task, and the next wake-up is planned again from what it recorded:
 * a completion moves an interval task's next trigger.
 */
registerManualRunner(async taskId => {
  // Switched off means nothing runs — a button press included.
  if (await automationsHalted()) {
    return fail('CONFLICT', 'Automations are switched off — switch them on to run this.')
  }

  logger.info(`[monitor] Run now — ${scheduledTaskInfo(taskId).label}`)

  return serialise(async () => {
    try {
      return await runManualTask(taskId)
    } finally {
      await planNextWake()
    }
  })
})

/**
 * Starts the monitor and plans its first wake-up. Idempotent.
 *
 * Arming the schedule asks for the first pass itself, so this does not run one
 * straight away — a launch with the schedule switched off should do nothing at
 * all, not a pass that finds nothing to do.
 */
export const startMonitor = (): void => {
  if (started) return

  started = true
  logger.info(
    `[monitor] started — waking at each task's trigger time, and at least every ${AUTOMATION_MONITOR_INTERVAL_MINUTES} minutes`
  )
  void runMonitorPass({ reason: 'the monitor started', planOnly: true })
}

export const stopMonitor = (): void => {
  started = false

  if (!timer) return

  clearTimeout(timer)
  timer = null
}

/**
 * Starts the monitor at launch — only if Automations are switched on.
 *
 * The switch is stored, so a machine switched off stays off across a restart:
 * the monitor does not start, and nothing in the background runs until
 * somebody switches it on.
 */
export const startMonitorIfOn = async (): Promise<void> => {
  if (await isPaused()) {
    logger.info('[monitor] not started — Automations are switched off')

    return
  }

  startMonitor()
}

/*
 * THE AUTOMATIONS SWITCH IS THE MONITOR'S ON/OFF — and every background
 * process goes with it.
 *
 * OFF stops the monitor's clock and the timers of the master-import schedule
 * and report queue, and asks the bulk re-claim to stop after the ticket in
 * hand. Work already in flight — a scheduled task, a Run now, a claim from the
 * socket, a bulk SPF run — reads `automationsHalted` between its steps and
 * stops there; nothing is cut off mid-claim.
 *
 * ON starts them again: the monitor, then — for a signed-in operator — the
 * master-import schedule and queue, and the claims that arrived from TrackVid
 * while the switch was off.
 */
onAutomationsSwitched((on, mode) => {
  if (!on) {
    stopMonitor()
    stopImportScheduler()
    stopMasterImportQueue()
    stopReClaim()
    logger.info('[monitor] Automations switched OFF — monitor and background processes stopping')

    return
  }

  startMonitor()

  if (getSession()) {
    // TOGGLE_ON: every platform's master import runs once now, beside the six
    // tasks the scheduler forced — whatever TrackVid's times say.
    if (mode === AUTOMATION_MODES.TOGGLE_ON) forceImportsOnce()

    startImportScheduler()
    startMasterImportQueue()
    startDraining()
  }

  logger.info('[monitor] Automations switched ON — monitor and background processes started')
})

