import type { JobSucceededRow, JobSummaryLine } from '@shared/types/jobs'
import type { CronSchedule } from '@shared/utils/cronSchedule'
import type { CronRunStatus } from '@shared/utils/cronStatus'
import type { RunTrigger } from '@shared/constants/automationModes'

/**
 * The nightly schedule: which automations run unattended, and when.
 *
 * Everything here is normally started by a person pressing a button — sessions
 * are re-captured from the banner, the AJIO backup from its card, Refill Data
 * and the claims from their pages. That works while somebody is at the machine,
 * and not at all overnight, which is when a marketplace's queues are shortest
 * and an operator is not.
 *
 * WHAT A TASK IS, AND WHAT IT IS NOT. A task is a NAME plus an adapter onto a
 * service that already exists — never a second copy of the work. The scheduled
 * run and the button take the same code path on purpose: a schedule that behaved
 * differently from the button would be a second thing to debug, and the button
 * is the one that gets exercised. So this file describes tasks; it never
 * implements one.
 */

/**
 * The four automations that can be scheduled.
 *
 * A union rather than a string so the registry, the store and the card cannot
 * drift: adding a fifth is a compile error everywhere it has to be handled,
 * which is the point of it being a union at all.
 */
export type ScheduledTaskId =
  | 'eligible-claims'
  | 'session-refresh'
  | 'ajio-master-data'
  | 'snapdeal-master-data'
  | 'flipkart-master-data'
  | 'refill-data'
  | 'auto-claim'
  | 'status-change'

/**
 * What the operator set for one task: whether it runs, and how often.
 *
 * `cron` is the schedule — every N minutes, or at one or more times of day.
 * See shared/utils/cronSchedule for what each means and when it comes round.
 *
 * `time` is the shape this replaced: a single "HH:mm". Kept only so a record
 * written before the dialog existed can be read forward into a one-entry fixed
 * time, which is exactly what it meant. Nothing writes it any more.
 */
export interface TaskSchedule {
  enabled: boolean
  cron: CronSchedule | null
  /** @deprecated read-only, for records written before `cron`. */
  time?: string | null
}

/**
 * One task as the settings card shows it — what it is, when it next runs, and
 * how the last run went.
 *
 * `label` and `description` come from the registry rather than being written
 * into the card, so the card can render a task it has never heard of.
 */
export interface ScheduledTaskState extends TaskSchedule {
  id: ScheduledTaskId
  label: string
  description: string
  /** ISO, or null when this machine has never run it. */
  lastRunAt: string | null
  /** Epoch ms of the next due moment, or null when the task is off. */
  nextRunAt: number | null
  /** The last run's one-line summary — the same words the Jobs row carries. */
  lastDetail: string | null
  lastError: string | null
  running: boolean
  /**
   * Due now and waiting its turn behind another task.
   *
   * The nightly sequence is deliberately one at a time — sessions before the
   * work that signs in with them — so a task can be owed for several minutes
   * before it starts. Without this the modal would call that "scheduled", and
   * an operator watching a run would see nothing at all between tasks.
   */
  queued: boolean
  /** How the last run ended, from the execution history rather than memory. */
  lastStatus: CronRunStatus | null
  /** ISO of the last run's start, including one that never finished. */
  lastStartedAt: string | null
  /** ISO of the last successful completion — what an interval is measured from. */
  lastCompletedAt: string | null
  /**
   * How many times in a row this has failed, ignoring runs the app interrupted.
   *
   * SHOWN BECAUSE THE RETRY IS NOW ENDLESS. A task that fails and retries every
   * minute produces a steady stream of activity and no progress, which from the
   * outside looks like a task that is working. The count is the thing that says
   * otherwise, and it is what tells somebody a login needs re-capturing rather
   * than more patience.
   */
  consecutiveFailures: number
}

/**
 * One execution of one task, as the local database holds it.
 *
 * THE POINT OF WRITING THIS BEFORE THE RUN STARTS. The old archive only ever
 * recorded a finished run, so a run the app died in the middle of left nothing
 * behind at all — on the next launch the task looked like it had simply not run
 * yet, and the work it half-did was invisible. A row with `startedAt` set and
 * `completedAt` null is the only evidence that something was interrupted, and it
 * is what makes crash recovery possible rather than guesswork.
 *
 * `occurrence` is the fixed-time slot this run was for, so the same 10:00 window
 * cannot be run twice by a run that finishes at 10:20.
 */
export interface CronExecution {
  id: string
  taskId: ScheduledTaskId
  /** ISO. Written before the runner is invoked. */
  startedAt: string
  /**
   * ISO, or null while running — and null FOREVER when the run never ended:
   * the Automations switch went off under it, or the app died. A latest row
   * with no completion is an INCOMPLETE run, and the monitor runs that task
   * again, ahead of everything after it.
   */
  completedAt: string | null
  status: CronRunStatus
  /** The run's one-line summary, when it produced one. */
  detail: string | null
  error: string | null
  total: number
  succeeded: number
  failed: number
  /** Epoch ms of the fixed-time slot this run answered, or null for an interval. */
  occurrence: number | null
  /** Was this a Run now rather than the schedule? */
  manual: boolean
  /**
   * Which kind of automation started it — see `shared/constants/automationModes`.
   * Absent on a row written before this existed; `manual` still answers for
   * those.
   */
  trigger?: RunTrigger
  /**
   * The app stopped while this was running — it did not fail, it was killed.
   *
   * IT STILL BLOCKS, because nothing knows how far it got. But it must NOT
   * count towards the retry backoff: quitting the app is not the marketplace
   * misbehaving, and three ordinary restarts would otherwise push the next
   * attempt an hour away for no reason at all.
   */
  interrupted?: boolean
  /**
   * The result per marketplace — what each platform got through. Absent on a
   * row written before this existed, and on a task that has no platforms.
   */
  platforms?: PlatformResult[]
}

/** One marketplace's share of a run. */
export interface PlatformResult {
  /** The platform id as the app names it — "ajio", "meesho". */
  platform: string
  total: number
  succeeded: number
  failed: number
  /** One line about this platform, when there is something to say. */
  detail: string | null
}

/**
 * The jobs the monitor runs besides the six tasks. They have no entry in the
 * schedule — their times come from TrackVid — but they get a history table each,
 * kept exactly like a task's.
 */
export type MonitorJobId = 'master-import' | 'master-import-queue'

/** A run of one of those jobs. The same row as a task's, under its own id. */
export type MonitorJobExecution = Omit<CronExecution, 'taskId'> & { taskId: MonitorJobId }

export interface AutomationScheduleState {
  tasks: ScheduledTaskState[]
  /**
   * The master switch: has the operator stopped the whole schedule?
   *
   * SEPARATE FROM EVERY TASK BEING OFF, which is what makes it worth its own
   * flag. Task switches are a configuration — which automations this machine
   * does at all. This is "not now": a marketplace is misbehaving, or somebody
   * needs the machine, and everything should stop without losing which four
   * switches were on.
   */
  paused: boolean
  /**
   * Switched off while something was still going.
   *
   * The queue stops the instant the switch moves, but the task already in
   * flight finishes the step it is on — abandoning a claim half-submitted is
   * how one gets filed on the marketplace with nothing here recording it. This
   * is the window between the two, and the modal says so rather than showing a
   * paused schedule that is somehow still running.
   */
  stopping: boolean
  /**
   * WHO stopped it, when it is stopped.
   *
   *   operator  somebody moved the switch; it stays off until they move it back
   *   sessions  the app stopped it, because the Login update could not
   *             re-capture every login and nothing below it can work on one the
   *             marketplace refuses
   *
   * The second is shown differently and clears itself: the sidebar says what is
   * wrong and offers the re-capture, and the schedule starts again on its own
   * once the logins are good. Null when the schedule is running.
   */
  pausedBy: 'operator' | 'sessions' | null
  /** Which logins, for the sidebar's alert. Empty unless `pausedBy` is sessions. */
  pausedDetail: string
  /**
   * What is driving the browser right now, when anything is.
   *
   * Shown because it explains the one surprise this card can produce: a task
   * that was due at 02:00 and started at 02:18 because a bulk claim still had
   * the browser.
   */
  busy: string | null
}

/**
 * What a task hands back when it finishes.
 *
 * Shaped to land on the Jobs page WITHOUT translation — `detail` is the list
 * line, `summary` the stated facts when the row is opened, `rows` the
 * per-platform or per-report breakdown. A task that invented its own shape here
 * would need a matching case in the Jobs page, and then adding a task would mean
 * editing the Jobs page, which is exactly the coupling this avoids.
 */
export interface TaskOutcome {
  /** One line for the Jobs list — "Forward 412 · Return 388". */
  detail: string
  /** What the run set out to do, and how it went. Rows, accounts, claims — the task decides. */
  total: number
  succeeded: number
  failed: number
  summary: JobSummaryLine[]
  /** The breakdown, one row per platform / report / account. */
  rows: JobSucceededRow[]
  /** The result per marketplace, written into the run's history row. */
  platforms?: PlatformResult[]
}

/**
 * A finished scheduled run, kept on this machine.
 *
 * THIS IS THE RECORD OF THE SCHEDULE ITSELF, which is not the same thing as the
 * record of the work. A scheduled Refill Data run still writes its own detailed
 * `refill-data` job with every AWB it touched; this row says the 02:00 window
 * opened, what it started, and how it ended. Keeping them separate is what makes
 * "did last night's cron run?" answerable without reading four other job types
 * and inferring it from timestamps.
 */
export interface ScheduledRunArchive extends TaskOutcome {
  jobId: string
  taskId: ScheduledTaskId
  /** The task's name at the time it ran, so an old row survives a rename. */
  label: string
  platform: string
  startedAt: string
  finishedAt: string
  status: 'done' | 'failed'
  error: string | null
}

/**
 * A marketplace Auto claim is about to work on, and how much of it is ready.
 *
 * WHY THIS EXISTS. The Auto claim row says a run happened and gives a count. It
 * cannot say which marketplaces the run is FOR, and that is the thing worth
 * knowing before 04:00: a night where Myntra has forty claims waiting and
 * Snapdeal has none is a different night from one where both have twenty, and
 * the totals read the same either way.
 *
 * COUNTED THROUGH `selectionBlockReason`, the same gate the task files on and
 * the same one the Claims page ticks with — so `ready` is genuinely what will
 * be attempted, not an optimistic count of everything Pending. `blocked` is the
 * rest: rows waiting on a POB ID, an account, a sub-order number.
 */
/**
 * What Refill Data would ask about, per marketplace.
 *
 * SEPARATE FROM AutoClaimTarget because the two runs disagree about a row on
 * purpose: a claim with no account is exactly what the refill is FOR, while the
 * claim run refuses it. Reusing one shape would make the Refill row on the card
 * report the claim run's opinion of the work.
 */
export interface RefillTarget {
  /** As the CMS row spells it — "Delhivery", "Tata CliQ". */
  platform: string
  /** Rows this run would ask the marketplace about. */
  pending: number
  /** Rows left alone: already asked MAX_REFILL_ATTEMPTS times. */
  exhausted: number
}

/**
 * What Status change would ask about, per marketplace: every claim with a
 * ticket, split by whether its AWB is due (`CLAIM_STATUS_SYNC_DAYS` have passed
 * since `status-record` last stamped it, or it never was) or still up to date.
 */
export interface StatusTarget {
  /** Platform key — "ajio", "tatacliq". */
  platform: string
  /** AWBs the next run will ask about. */
  due: number
  /** AWBs processed inside the window, left alone. */
  upToDate: number
}

export interface AutoClaimTarget {
  /** As the CMS row spells it — "Myntra", "Tata CliQ". */
  platform: string
  /** Claims this run would file. */
  ready: number
  /** Pending claims the gate refuses, with their reasons on the Claims page. */
  blocked: number
}
