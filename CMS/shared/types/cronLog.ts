import type { ScheduledTaskId } from '@shared/types/automationSchedule'

/**
 * One line in the scheduler's activity log.
 *
 * WHAT THIS IS FOR, and why the run history does not already answer it. The
 * history says how each RUN ended — four rows a night, one per task. It cannot
 * say why a task that never started did not start: blocked behind a failure,
 * waiting out a retry, deferred because the machine was offline or because a
 * bulk claim had the browser. Those are the hours in which nothing appears to
 * happen, and they are exactly what somebody opening this at nine in the
 * morning is trying to account for.
 *
 * So this is the narration, and the history is the record. They overlap on
 * "started" and "finished" deliberately: a log nobody can read end to end is no
 * better than no log.
 */

export type CronLogLevel =
  /** A run began. */
  | 'start'
  /** A run finished with everything done. */
  | 'success'
  /** Finished, but some of the work failed — the run still counts. */
  | 'partial'
  /** The run failed, or nothing in it worked. */
  | 'failure'
  /** Held up by an earlier task that has not recovered. */
  | 'blocked'
  /** Deliberately passed over — by the operator, or because it is switched off. */
  | 'skip'
  /** Waiting: a retry backoff, no network, or another automation on the browser. */
  | 'waiting'
  /** Anything else worth a line — armed, caught up, recovered after a crash. */
  | 'info'

export interface CronLogEntry {
  id: string
  /** ISO. */
  at: string
  /** The task this is about, or null for something about the scheduler itself. */
  taskId: ScheduledTaskId | null
  /** The task's name at the time, so an old line survives a rename. */
  label: string
  level: CronLogLevel
  /** One line, written for the operator rather than for a developer. */
  message: string
  /**
   * The detail behind it — a marketplace's own words, an error, the counts.
   *
   * Separate from `message` so the list can stay scannable and still carry the
   * thing somebody actually needs. Never truncated here; the UI decides.
   */
  detail: string | null
}
