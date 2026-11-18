import type { TaskOutcome } from '@shared/types/automationSchedule'

/**
 * How a scheduled run ended, and whether that holds the queue up.
 *
 * WHAT THIS REPLACED, and why it is the load-bearing part of the scheduler:
 * a run used to be a success if the runner returned without throwing. All four
 * runners convert marketplace failures into COUNTERS and return normally — so a
 * night in which every single login failed was archived "done", cleared the
 * error, reset the retry budget and closed the window. The numbers saying
 * otherwise were on the returned object the whole time and were never read.
 *
 * Pure, and in `shared/` rather than beside the scheduler, so the rule can be
 * tested against a plain object with no Electron surface anywhere near it.
 */

export type CronRunStatus = 'running' | 'completed' | 'completed_with_errors' | 'failed' | 'skipped'

/** What the operator is shown. The stored value is the lowercase one. */
export const CRON_STATUS_LABEL: Record<CronRunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  completed_with_errors: 'Completed with errors',
  failed: 'Failed',
  skipped: 'Skipped'
}

/**
 * The outcome of a run that returned, read off the counters it carries.
 *
 * THE RULE: A CRON THAT GOT AN ANSWER FOR EVERY ITEM HAS COMPLETED — whatever
 * those answers were. Completing is about the RUN reaching the end of its work,
 * not about the work all succeeding. Individual items fail for their own
 * reasons, and those reasons belong to the items.
 *
 *   nothing to do   → COMPLETED. A quiet night is not an error.
 *   some failed     → COMPLETED_WITH_ERRORS. It reached the end; some items
 *                     did not work, and the counts say which.
 *   all failed      → COMPLETED_WITH_ERRORS, for exactly the same reason. It
 *                     still asked every account and still got an answer for
 *                     each one.
 *
 * WHY "ALL FAILED" IS NOT A FAILED CRON, which is a correction to what this
 * used to say. It classified a run where nothing succeeded as FAILED, and a
 * failed run blocks the queue and retries for ever. In the field that produced
 * this: three Myntra logins answered "auto-login is turned off in Monitor" —
 * a SETTING — and one Snapdeal login answered "OTP required" — a person. Four
 * answers, none of them a fault in the run. The cron had done everything it
 * could do. But because none had SUCCEEDED it was called a failure, so it
 * blocked the AJIO sync, Refill Data and the claims, and re-ran itself every
 * sixty seconds — driving a real browser at Snapdeal's login once a minute,
 * for ever, to be told the same thing.
 *
 * A run FAILS when the run itself could not complete: it threw, the app was
 * killed under it, or its completion could not be written down. Those are
 * conditions about the run. "Every account said no" is a result, and a result
 * is a completion.
 */
export const classifyOutcome = (outcome: TaskOutcome): CronRunStatus => {
  const failed = Number.isFinite(outcome.failed) ? outcome.failed : 0

  return failed > 0 ? 'completed_with_errors' : 'completed'
}

/**
 * Whether a run that ended this way is owed a retry.
 *
 * FAILED, and RUNNING — the latter being a row with no completion: a run left
 * incomplete when Automations were switched off or the app died. Either way the
 * task is due again, whatever its schedule says.
 *
 * IT HOLDS NOTHING UP. A task owed a retry is passed over in the pass it fails
 * in, and the tasks after it run; the retry comes on the monitor's next check.
 *
 * COMPLETED_WITH_ERRORS is NOT a retry. It is the common outcome on a busy day:
 * the run reached the end of its work, and its failed items wait for its next
 * scheduled run.
 */
export const needsRetry = (status: CronRunStatus): boolean =>
  status === 'failed' || status === 'running'

/** A run that ended, one way or another. */
export const isTerminal = (status: CronRunStatus): boolean => status !== 'running'

/** Did this run count as having done its work? Used for interval arithmetic. */
export const isSuccessful = (status: CronRunStatus): boolean =>
  status === 'completed' || status === 'completed_with_errors'
