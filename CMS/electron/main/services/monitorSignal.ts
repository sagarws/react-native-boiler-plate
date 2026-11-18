/**
 * "The monitor should look now" — inside the main process, for the main process.
 *
 * WHY A MODULE OF ITS OWN, for the same reason as `sessionChangeSignal`. The
 * monitor runs the scheduler's tasks, so it imports the scheduler; the
 * scheduler is where a sign-in, the master switch or a skip lands, and those
 * want a pass now rather than in thirty minutes. Importing the monitor back
 * would close a cycle, and in a bundled main process a cycle is how a function
 * arrives `undefined` at the moment it is called.
 *
 * So the scheduler ASKS and the monitor DECIDES. Nothing on this side starts a
 * task — it only asks the one service that may.
 */
import type { TaskOutcome, ScheduledTaskId } from '@shared/types/automationSchedule'
import { fail, type Result } from '@shared/types/result'
import type { AutomationMode } from '@shared/constants/automationModes'
import { logger } from './logger'

export interface MonitorCheckRequest {
  /** Why the pass was asked for, for the log. */
  reason: string
  /**
   * The app has been closed, or the schedule wiped, so whatever is owed may be
   * owed because nothing ran. Such a pass re-checks the logins first even when
   * the Login update is not due itself.
   */
  catchUp?: boolean
  /**
   * Only work out the next trigger time again — run nothing. For a schedule
   * that was edited: its next run moved, but editing it is not a reason to
   * start anything.
   */
  planOnly?: boolean
}

type Listener = (request: MonitorCheckRequest) => void

const listeners = new Set<Listener>()

/** Register interest. Returns the unsubscribe, for tests and for teardown. */
export const onMonitorCheckRequested = (listener: Listener): (() => void) => {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/*
 * RUN NOW, HANDED TO THE MONITOR.
 *
 * Unlike a check request this needs an answer — the button shows what the run
 * did — so it is one handler the monitor registers rather than a broadcast.
 */
type ManualRunner = (taskId: ScheduledTaskId) => Promise<Result<TaskOutcome>>

let manualRunner: ManualRunner | null = null

/** The monitor registers itself here. Returns the unregister, for tests. */
export const registerManualRunner = (runner: ManualRunner): (() => void) => {
  manualRunner = runner

  return () => {
    if (manualRunner === runner) manualRunner = null
  }
}

/**
 * Ask the monitor to run one task now, on the operator's say-so.
 *
 * Refused rather than run some other way when no monitor is listening: the
 * monitor is the only thing that starts a task, and a Run now that quietly
 * went round it would be the one exception.
 */
export const requestManualRun = (taskId: ScheduledTaskId): Promise<Result<TaskOutcome>> =>
  manualRunner
    ? manualRunner(taskId)
    : Promise.resolve(fail('INTERNAL_ERROR', 'The automation monitor is not running'))

/*
 * THE AUTOMATIONS SWITCH, which turns the monitor itself on and off — and with
 * it every background process. Raised by the scheduler, which owns the stored
 * flag; acted on by the monitor, which owns the processes.
 */
/**
 * `mode` is set only when the OPERATOR switched Automations on — that is the
 * TOGGLE_ON automation, which runs everything once. Automations also come back
 * on by themselves when a capture lifts the app's own login pause; that is not
 * a toggle, and nothing is forced.
 */
type SwitchListener = (on: boolean, mode?: AutomationMode) => void

const switchListeners = new Set<SwitchListener>()

export const onAutomationsSwitched = (listener: SwitchListener): (() => void) => {
  switchListeners.add(listener)

  return () => switchListeners.delete(listener)
}

export const automationsSwitched = (on: boolean, mode?: AutomationMode): void => {
  for (const listener of switchListeners) {
    try {
      listener(on, mode)
    } catch (error) {
      logger.warn('[monitor] a listener failed on the Automations switch', error)
    }
  }
}

/** Ask the monitor for a pass now, instead of waiting for its interval. */
export const requestMonitorCheck = (request: MonitorCheckRequest): void => {
  for (const listener of listeners) {
    try {
      listener(request)
    } catch (error) {
      logger.warn('[monitor] a listener failed on a check request', error)
    }
  }
}
