import type { ScheduledTaskId } from '@shared/types/automationSchedule'
import type { CronSchedule } from '@shared/utils/cronSchedule'
import { isValidCron, nextCronRun } from '@shared/utils/cronSchedule'
import type { CronRunStatus } from '@shared/utils/cronStatus'
import { needsRetry } from '@shared/utils/cronStatus'

/**
 * Which task the scheduler should run next, and why every other one may not.
 *
 * THE RULE THIS ENCODES, and the misreading it exists to prevent:
 *
 *   Schedules are INDEPENDENT. A task never waits for an earlier task's next
 *   window. If Login update last ran at 09:30 and runs hourly, its next window
 *   is 10:30 — and that says nothing whatever about Refill Data, which runs at
 *   10:00 and should run at 10:00.
 *
 *   Execution is MUTUALLY EXCLUSIVE. One at a time, always.
 *
 *   NOTHING BLOCKS. A task that failed — or was left incomplete — is passed
 *   over and the tasks after it run, in order, in the same pass; the failed one
 *   is due again and retried on the monitor's next check. "Not due yet" is not
 *   a gate either: reading it as one turns independent schedules into a
 *   pipeline in which the last task runs once a day at best.
 *
 * Pure, and given plain values rather than stores, so every one of those rules
 * can be tested against a literal instead of a mocked filesystem.
 */

const MINUTE_MS = 60_000

/**
 * A FAILED TASK IS RETRIED FOR EVER — no backoff, no limit — and it holds
 * nothing up while it is.
 *
 * WHAT STOPS IT BEING A HAMMER. A failed task is retried by the monitor's
 * routine check (AUTOMATION_MONITOR_INTERVAL_MINUTES), or sooner when the
 * monitor wakes for another task's trigger — never in a loop of its own, because
 * the pass that fails it does not pick it up again, and `nextMonitorWake` does
 * not wake for a task that is due but could not run.
 *
 * The way to stop retrying a failure that cannot clear itself is the operator's
 * Skip, which is a decision and is recorded as one.
 */

/** Everything the decision needs about one task, read from disk by the caller. */
export interface TaskSnapshot {
  id: ScheduledTaskId
  /** Registry order, 1..4. Decides priority and what "earlier" means. */
  order: number
  label: string
  enabled: boolean
  cron: CronSchedule | null
  /** How its most recent execution ended, or null when it has never run here. */
  lastStatus: CronRunStatus | null
  /** When it last completed work — what an interval is measured from. */
  lastSuccessAt: number | null
  /** When the last attempt, successful or not, finished. */
  lastAttemptAt: number | null
  /** Failures since the last success. Reported, not used to delay a retry. */
  consecutiveFailures: number
  /**
   * Run it this pass whatever its schedule says.
   *
   * SET BY THE SWITCH, not by the clock. Turning Automations on means "do the
   * night's work now" — the operator has just decided the machine should be
   * working, and leaving three of the four tasks waiting for their next window
   * makes the switch look like it did nothing. The log read
   * `switched ON — re-arming and catching up` and then nothing ran, because
   * nothing happened to be overdue.
   *
   * IT ONLY MAKES A TASK DUE. Order, dependencies, the one-at-a-time rule and
   * the retry rules are untouched, so a forced pass is the ordinary
   * sequence — Login update first, then the rest — rather than four tasks
   * racing for one browser.
   *
   * ONE PASS ONLY: the scheduler drops the flag as each task finishes, so this
   * cannot turn into a task that runs every minute for ever.
   */
  forced?: boolean
  /** The fixed-time slot that has most recently passed, or null for an interval. */
  occurrence: number | null
  /** Has that slot already been run successfully? */
  occurrenceHandled: boolean
}

export type NotDueReason = 'disabled' | 'no-schedule' | 'not-due' | 'due'

export interface TaskDecision {
  id: ScheduledTaskId
  order: number
  /** Should this run, ignoring what else is going on? */
  due: boolean
  /** May it run? The same as `due` now that nothing blocks. */
  eligible: boolean
  /** Is this a retry — its last run failed, or never finished? */
  needsRecovery: boolean
  reason: NotDueReason
}

/**
 * Is this task owed a run?
 *
 * FOUR WAYS TO BE DUE, and the first two are the ones that used to be missed:
 *
 *   never run here    — the strongest case. A machine with no history has done
 *                       nothing, which is not the same as being up to date.
 *   failed last time  — or left incomplete. It is retried, and its schedule
 *                       is beside the point.
 *   interval elapsed  — measured from the last COMPLETION, never app start, so
 *                       a run that takes twenty minutes does not push the next
 *                       one twenty minutes later every time.
 *   a slot has passed — and this particular slot has not been answered yet.
 */
const isDue = (task: TaskSnapshot, now: number): boolean => {
  if (!task.enabled) return false
  if (!task.cron || !isValidCron(task.cron)) return false

  // The operator just switched everything on. Checked after `enabled` and the
  // cron, so a task somebody turned off stays off and one with a broken
  // schedule is still not run.
  if (task.forced) return true

  // Never run on this machine. Due now, whatever the schedule says.
  if (task.lastStatus === null) return true

  // Failed, and therefore owed a retry rather than a wait for its next window.
  if (needsRetry(task.lastStatus)) return true

  if (task.cron.kind === 'interval') {
    // No successful completion but it HAS run means every attempt failed; the
    // line above has already caught that, so this is a genuine interval check.
    const from = task.lastSuccessAt ?? task.lastAttemptAt

    if (from === null) return true

    return now - from >= task.cron.everyMinutes * MINUTE_MS
  }

  // Fixed time: a slot has passed and nothing has answered it yet.
  return task.occurrence !== null && !task.occurrenceHandled
}

/**
 * The full picture: every task, whether it is due, and what is stopping it.
 *
 * `tasks` need not be sorted — this orders by `order` itself, because "earlier"
 * has to mean the registry's order and not the order an array happened to be
 * built in.
 */
export const planQueue = (tasks: TaskSnapshot[], now: number = Date.now()): TaskDecision[] =>
  [...tasks]
    .sort((a, b) => a.order - b.order)
    .map(task => {
      const due = isDue(task, now)
      const reason: NotDueReason = !task.enabled
        ? 'disabled'
        : !task.cron || !isValidCron(task.cron)
          ? 'no-schedule'
          : due
            ? 'due'
            : 'not-due'

      return {
        id: task.id,
        order: task.order,
        due,
        /*
         * NO TASK WAITS FOR ANOTHER'S FAILURE. A failed or incomplete task is
         * due — it is retried — but it holds nothing up: the monitor passes over
         * it and runs the tasks after it in the same pass.
         */
        eligible: due,
        needsRecovery: task.enabled && task.lastStatus !== null && needsRetry(task.lastStatus),
        reason
      }
    })

/**
 * The one task to run next, or null.
 *
 * Lowest `order` among those that may run — deterministic, so two tasks falling
 * due in the same minute always start in the same sequence rather than in
 * whatever order a map happened to resolve.
 */
export const nextToRun = (
  tasks: TaskSnapshot[],
  now: number = Date.now()
): ScheduledTaskId | null =>
  planQueue(tasks, now).find(decision => decision.eligible)?.id ?? null

/**
 * When this task next comes round, worked out from the clock and its schedule.
 *
 *   due now           `now`. Never run here, failed last time, switched on by
 *                     hand, an interval already elapsed, or a slot passed that
 *                     nothing has answered.
 *   interval          the last completion plus the interval — "every two
 *                     hours" means two hours after the last run FINISHED.
 *   fixed times       the next of its times of day (IST) strictly after `now`.
 *   off / no schedule null: it never comes round.
 *
 * THE SAME RULES AS `isDue`, by construction: the "due now" case IS `isDue`, so
 * the monitor can never wake for a task the queue then declines, or sleep
 * through one the queue would have run.
 */
export const nextTriggerAt = (task: TaskSnapshot, now: number = Date.now()): number | null => {
  if (!task.enabled || !task.cron || !isValidCron(task.cron)) return null
  if (isDue(task, now)) return now

  if (task.cron.kind === 'interval') {
    const from = task.lastSuccessAt ?? task.lastAttemptAt

    // Unreachable — no completion at all means `isDue` said yes — but a null
    // here must never become "fifty-six years ago".
    if (from === null) return now

    return from + task.cron.everyMinutes * MINUTE_MS
  }

  return nextCronRun(task.cron, 0, now)
}

export interface MonitorWake {
  /** When the monitor should next look. Always after `now`. */
  at: number
  /** The task whose trigger this is, or null for the routine check. */
  taskId: ScheduledTaskId | null
}

/**
 * When the monitor should next wake: the soonest task trigger still in the
 * future, or the routine check — whichever comes first.
 *
 * A TRIGGER AT `now` IS NOT A REASON TO WAKE AT `now`. The monitor asks this
 * straight after a pass, so a task still due at that moment is one the pass
 * could not run — offline, the browser in use, or a failure this pass has
 * already passed over and is waiting to retry. Waking for it again
 * immediately would be a loop; it is picked up by the routine check instead,
 * which is what `maxWaitMs` is.
 */
export const nextMonitorWake = (
  tasks: TaskSnapshot[],
  now: number,
  maxWaitMs: number
): MonitorWake => {
  let wake: MonitorWake = { at: now + maxWaitMs, taskId: null }

  for (const task of tasks) {
    const at = nextTriggerAt(task, now)

    if (at !== null && at > now && at < wake.at) wake = { at, taskId: task.id }
  }

  return wake
}
