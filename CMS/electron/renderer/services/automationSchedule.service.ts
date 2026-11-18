import {
  AUTOMATION_SCHEDULE_CHANNELS,
  AUTOMATION_SCHEDULE_EVENTS
} from '@shared/constants/channels'
import type {
  AutoClaimTarget,
  AutomationScheduleState,
  CronExecution,
  ScheduledTaskId,
  TaskOutcome,
  RefillTarget,
  StatusTarget
} from '@shared/types/automationSchedule'
import type { CronLogEntry } from '@shared/types/cronLog'
import type { Result } from '@shared/types/result'
import type { CronSchedule } from '@shared/utils/cronSchedule'
import { invoke, subscribe } from './ipcClient'

export const automationScheduleState = (): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.state)

export const saveTaskSchedule = (input: {
  taskId: ScheduledTaskId
  enabled: boolean
  cron: CronSchedule | null
}): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.save, input)

export const runTaskNow = (taskId: ScheduledTaskId): Promise<Result<TaskOutcome>> =>
  invoke<TaskOutcome>(AUTOMATION_SCHEDULE_CHANNELS.runNow, { taskId })

/** Which marketplaces Auto claim would file for, and how many each has ready. */
/**
 * The master switch: stop every scheduled task, or start them again.
 *
 * Off stops the tick and drops the queue at once; a task already running
 * finishes the step it is on, and the state reports `stopping` until it does.
 * On re-arms the tick and catches up on whatever was missed, in order.
 */
export const setSchedulePaused = (paused: boolean): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.setPaused, { paused })

/** Back to the schedule a fresh machine gets: every task on, at its default. */
export const resetSchedule = (): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.reset)

/** Per marketplace: what Refill Data would ask about, and what it has given up on. */
/**
 * Let one marketplace's retired rows back into the nightly refill.
 *
 * Resolves to how many rows were actually let back in — which is the number
 * worth telling the operator, not the number of rows on the platform.
 */
export const resetRefillAttempts = (platform: string): Promise<Result<number>> =>
  invoke<number>(AUTOMATION_SCHEDULE_CHANNELS.resetRefillAttempts, { platform })

export const refillTargets = (): Promise<Result<RefillTarget[]>> =>
  invoke<RefillTarget[]>(AUTOMATION_SCHEDULE_CHANNELS.refillTargets)

/** Per marketplace: how many filed tickets Status change would ask about, and how many are up to date. */
export const statusTargets = (): Promise<Result<StatusTarget[]>> =>
  invoke<StatusTarget[]>(AUTOMATION_SCHEDULE_CHANNELS.statusTargets)

export const autoClaimTargets = (): Promise<Result<AutoClaimTarget[]>> =>
  invoke<AutoClaimTarget[]>(AUTOMATION_SCHEDULE_CHANNELS.autoClaimTargets)

/**
 * One task's execution history, newest first.
 *
 * From the local database, not from the pushed state: the state carries only
 * the latest run, and the question this answers — "has this been failing all
 * week?" — needs the rows.
 */
export const taskHistory = (taskId?: ScheduledTaskId): Promise<Result<CronExecution[]>> =>
  invoke<CronExecution[]>(AUTOMATION_SCHEDULE_CHANNELS.history, taskId ? { taskId } : {})

/**
 * The whole schedule, whenever any of it changes.
 *
 * Pushed rather than polled because a scheduled run starts with nobody
 * watching: the card has to be able to show "running" for something the
 * operator did not press.
 */
/**
 * Passes over one failed run so the tasks behind it can continue.
 *
 * Refused unless that task has actually failed — the button exists beside a
 * failure and nowhere else, and this is the half of that rule the server keeps.
 */
export const skipBlockedRun = (taskId: ScheduledTaskId): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.skip, { taskId })

/**
 * Cuts the RUNNING task short so the next one can start.
 *
 * Not `skipBlockedRun`, which is about a run that already failed. This is the
 * one the modal offers beside "Running": the task stops at its next safe
 * boundary — between accounts, between marketplaces — and the queue moves on.
 * This run only; the next scheduled one is unaffected.
 */
export const skipRunningTask = (taskId: ScheduledTaskId): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.skipRunning, { taskId })

/**
 * Pass over ONE marketplace on the task that is running.
 *
 * `platform` is the KEY, not the label — "tatacliq", not "Tata CliQ". A skip
 * that does not match is a skip that silently does nothing, which the operator
 * only discovers by watching the marketplace they just skipped carry on.
 */
export const skipRunningPlatform = (
  taskId: ScheduledTaskId,
  platform: string
): Promise<Result<AutomationScheduleState>> =>
  invoke<AutomationScheduleState>(AUTOMATION_SCHEDULE_CHANNELS.skipPlatform, {
    taskId,
    platform
  })

/** The scheduler's activity log, newest first. */
export const cronActivityLog = (): Promise<Result<CronLogEntry[]>> =>
  invoke<CronLogEntry[]>(AUTOMATION_SCHEDULE_CHANNELS.log)

export const clearCronActivityLog = (): Promise<Result<boolean>> =>
  invoke<boolean>(AUTOMATION_SCHEDULE_CHANNELS.clearLog)

/**
 * Each log line as it is written.
 *
 * Pushed, because the log exists to be WATCHED — a run starts with nobody
 * looking, and a list that only filled in on reopen would miss the part
 * somebody opened it for.
 */
export const onCronLog = (listener: (entry: CronLogEntry) => void): (() => void) =>
  subscribe(AUTOMATION_SCHEDULE_EVENTS.log, payload => listener(payload as CronLogEntry))

export const onScheduleChanged = (
  listener: (state: AutomationScheduleState) => void
): (() => void) =>
  subscribe(AUTOMATION_SCHEDULE_EVENTS.state, payload =>
    listener(payload as AutomationScheduleState)
  )
