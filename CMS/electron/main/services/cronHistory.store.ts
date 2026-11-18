import { randomUUID } from 'node:crypto'
import type {
  CronExecution,
  MonitorJobExecution,
  MonitorJobId,
  PlatformResult,
  ScheduledTaskId
} from '@shared/types/automationSchedule'
import { SCHEDULED_TASK_IDS } from '@shared/constants/automationSchedule'
import { AUTOMATION_MODES, type RunTrigger } from '@shared/constants/automationModes'
import type { CronRunStatus } from '@shared/utils/cronStatus'
import { isSuccessful } from '@shared/utils/cronStatus'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * Every execution of every job the monitor runs, on this machine.
 *
 * ONE COLLECTION PER JOB — `cron-history-<id>.json` — for the six scheduled
 * tasks and for the two master-import jobs (`master-import`,
 * `master-import-queue`), rather than one file with an id column. The monitor
 * asks "how did THIS job last end" on every pass, and a per-job file makes that
 * a short read of the only rows that can answer.
 *
 * EVERY ROW: when it started, when it completed, the result, and the result per
 * platform. The start is written BEFORE the work; the completion after it.
 *
 * NO COMPLETION MEANS INCOMPLETE, and that is the rule the monitor runs on. A
 * row is left without one when the Automations switch goes off under it, or the
 * app dies — nothing here ever writes a completion for a run that did not end.
 * The monitor reads the latest row of each job and runs an incomplete one again.
 *
 * THIS IS THE SOURCE OF TRUTH for whether a job may run. In-memory state is an
 * optimisation and a crash erases it; the file is what survives.
 *
 * SEPARATE FROM `scheduledRunArchive`, deliberately. That archive feeds the
 * Background Process page with per-row breakdowns; this carries the small set
 * of facts the MONITOR reasons about.
 *
 * Never throws. History is a record OF work, never part of it.
 */

const MAX_EXECUTIONS = 200

/** Every history the monitor keeps. */
export const MONITOR_JOB_IDS: readonly MonitorJobId[] = ['master-import', 'master-import-queue']

type HistoryKey = ScheduledTaskId | MonitorJobId
type Row = CronExecution | MonitorJobExecution

const collections = new Map<HistoryKey, JsonCollection<Row>>()

const collectionName = (key: HistoryKey): string => `cron-history-${key}`

const ALL_KEYS = (): HistoryKey[] => [...SCHEDULED_TASK_IDS, ...MONITOR_JOB_IDS]

export const initialiseCronHistory = (): void => {
  collections.clear()

  for (const key of ALL_KEYS()) {
    const collection = new JsonCollection<Row>({
      name: collectionName(key),
      directory: dataDirectory()
    })

    collections.set(key, collection)

    /*
     * EVERY JOB'S TABLE EXISTS FROM THE FIRST LAUNCH, empty until it runs. The
     * monitor reads all of them on every pass, and a table that appears only
     * once its job first runs reads, on the Local Database page, as a job that
     * has no history table at all.
     */
    void collection
      .ensureFile()
      .catch(error => logger.warn(`[SCHEDULER] could not create the history table for ${key}`, error))
  }
}

const store = (key: HistoryKey): JsonCollection<Row> | null => collections.get(key) ?? null

const readRows = async (key: HistoryKey): Promise<Row[]> => {
  const target = store(key)

  if (!target) return []

  const records = await target.read().catch(() => [] as Row[])

  return [...records].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
}

const write = async (key: HistoryKey, mutate: (records: Row[]) => Row[]): Promise<void> => {
  const target = store(key)

  if (!target) {
    logger.warn(`[SCHEDULER] history for ${key} was not written — the store is not open`)

    return
  }

  await target
    .mutate(records => ({ records: mutate(records), result: undefined }))
    .catch(error => logger.warn(`[SCHEDULER] could not write history for ${key}`, error))
}

const startRow = async <R extends Row>(key: HistoryKey, row: R): Promise<R> => {
  await write(key, records =>
    [row, ...records]
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, MAX_EXECUTIONS)
  )

  return row
}

interface CompletionDetails {
  detail?: string | null
  error?: string | null
  total?: number
  succeeded?: number
  failed?: number
  platforms?: PlatformResult[] | undefined
}

/** Closes a row and reads it back, so a completion is never assumed. */
const completeRow = async (
  key: HistoryKey,
  execution: Row,
  status: CronRunStatus,
  details: CompletionDetails
): Promise<boolean> => {
  const completed: Row = {
    ...execution,
    completedAt: new Date().toISOString(),
    status,
    detail: details.detail ?? null,
    error: details.error ?? null,
    total: details.total ?? 0,
    succeeded: details.succeeded ?? 0,
    failed: details.failed ?? 0,
    ...(details.platforms ? { platforms: details.platforms } : {})
  }

  await write(key, records => [completed, ...records.filter(record => record.id !== execution.id)])

  const stored = (await readRows(key)).find(record => record.id === execution.id)

  return stored?.completedAt !== null && stored?.completedAt !== undefined
}

/**
 * Marks a row as cut short — WITHOUT a completion time.
 *
 * The Automations switch went off while it was running. `interrupted` says so
 * for the history table; the missing completion is what makes the monitor run
 * it again.
 */
const abandonRow = async (key: HistoryKey, execution: Row): Promise<void> => {
  await write(key, records =>
    records.map(record =>
      record.id === execution.id && record.completedAt === null
        ? {
            ...record,
            interrupted: true,
            error:
              'Stopped when Automations were switched off, before it finished. It will be run again.'
          }
        : record
    )
  )
}

/* -------------------------------------------------------------------------- *
 * The six scheduled tasks
 * -------------------------------------------------------------------------- */

/** Every execution of one task, newest first. Empty when it has never run here. */
export const readHistory = async (taskId: ScheduledTaskId): Promise<CronExecution[]> =>
  (await readRows(taskId)) as CronExecution[]

/** The most recent execution, running or finished, or null. */
export const latestExecution = async (taskId: ScheduledTaskId): Promise<CronExecution | null> =>
  (await readHistory(taskId))[0] ?? null

/**
 * When this task last finished work it actually did.
 *
 * AN INTERVAL IS MEASURED FROM THIS, not from app start and not from the last
 * attempt. `completed_with_errors` counts: the run happened and did most of its
 * job.
 */
export const lastSuccessfulCompletion = async (
  taskId: ScheduledTaskId
): Promise<number | null> => {
  const success = (await readHistory(taskId)).find(
    record => record.completedAt !== null && isSuccessful(record.status)
  )

  return success?.completedAt ? Date.parse(success.completedAt) : null
}

/**
 * The fixed-time slots this task has already answered. A SKIPPED SLOT COUNTS
 * AS ANSWERED — the operator decided this run does not have to happen.
 */
export const handledOccurrences = async (taskId: ScheduledTaskId): Promise<Set<number>> => {
  const history = await readHistory(taskId)

  return new Set(
    history
      .filter(
        record =>
          record.occurrence !== null &&
          (isSuccessful(record.status) || record.status === 'skipped')
      )
      .map(record => record.occurrence as number)
  )
}

/**
 * Records that a run has STARTED, before the runner is invoked — so a run that
 * never ends leaves a row with no completion, which is what marks it
 * incomplete.
 */
export const recordStart = async (
  taskId: ScheduledTaskId,
  options: { occurrence?: number | null; manual?: boolean; trigger?: RunTrigger } = {}
): Promise<CronExecution> =>
  startRow<CronExecution>(taskId, {
    id: randomUUID(),
    taskId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    detail: null,
    error: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    occurrence: options.occurrence ?? null,
    manual: options.manual === true,
    trigger: options.trigger ?? (options.manual === true ? 'manual' : AUTOMATION_MODES.SCHEDULE)
  })

/**
 * Closes one execution, and reads it back to prove the close landed. Returns
 * false when the completion could not be confirmed; the caller treats that as
 * a failure.
 */
export const recordCompletion = async (
  execution: CronExecution,
  status: CronRunStatus,
  details: CompletionDetails = {}
): Promise<boolean> => completeRow(execution.taskId, execution, status, details)

/** Leaves a run incomplete because the switch went off under it. */
export const recordAbandoned = async (execution: CronExecution): Promise<void> =>
  abandonRow(execution.taskId, execution)

/**
 * Notes the runs the app died in the middle of, once, at startup.
 *
 * A row still without a completion in a FRESH PROCESS cannot be running: the
 * app holds a single-instance lock, so no other copy is working it.
 *
 * THEY ARE NOT CLOSED. No completion time is written for a run that did not
 * end — the row stays incomplete, and the monitor runs that job again. Only
 * `interrupted` is set, so the history table can say "incomplete" rather than
 * "running". Returns the jobs that had one, for the log.
 */
export const recoverInterruptedExecutions = async (): Promise<HistoryKey[]> => {
  const recovered: HistoryKey[] = []

  for (const key of ALL_KEYS()) {
    const history = await readRows(key)
    const unfinished = history.filter(record => record.completedAt === null && record.interrupted !== true)

    if (unfinished.length === 0) continue

    recovered.push(key)

    await write(key, records =>
      records.map(record =>
        record.completedAt === null
          ? {
              ...record,
              interrupted: true,
              error:
                record.error ??
                'The app stopped while this was running, so it never finished. It will be run again.'
            }
          : record
      )
    )

    logger.warn(`[SCHEDULER] ${key}: ${unfinished.length} incomplete run(s) — they will be run again`)
  }

  return recovered
}

/** Records a run the operator deliberately skipped. Never silent — see the UI. */
export const recordSkip = async (
  taskId: ScheduledTaskId,
  occurrence: number | null,
  reason: string
): Promise<void> => {
  const now = new Date().toISOString()
  const skipped: CronExecution = {
    id: randomUUID(),
    taskId,
    startedAt: now,
    completedAt: now,
    status: 'skipped',
    detail: reason,
    error: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    occurrence,
    manual: true
  }

  /*
   * THE INCOMPLETE ROW IT SKIPS PAST STAYS INCOMPLETE. A skip is newer, so it
   * is now the latest row — which is what the monitor reads — and the task is
   * no longer owed a re-run. The older row keeps saying what really happened.
   */
  await write(taskId, records => [skipped as Row, ...records].slice(0, MAX_EXECUTIONS))
}

/* -------------------------------------------------------------------------- *
 * The master-import jobs
 * -------------------------------------------------------------------------- */

/** Every run of one master-import job, newest first. */
export const readJobHistory = async (job: MonitorJobId): Promise<MonitorJobExecution[]> =>
  (await readRows(job)) as MonitorJobExecution[]

/**
 * Records a master-import job starting, with the platforms it is about to work
 * on — so an incomplete row still says WHICH platforms it never finished.
 */
export const recordJobStart = async (
  job: MonitorJobId,
  platforms: string[],
  trigger: RunTrigger = AUTOMATION_MODES.SCHEDULE
): Promise<MonitorJobExecution> =>
  startRow<MonitorJobExecution>(job, {
    id: randomUUID(),
    taskId: job,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'running',
    detail: null,
    error: null,
    total: 0,
    succeeded: 0,
    failed: 0,
    occurrence: null,
    manual: false,
    // The schedule, or TOGGLE_ON for a master import forced by the switch.
    trigger,
    platforms: platforms.map(platform => ({
      platform,
      total: 0,
      succeeded: 0,
      failed: 0,
      detail: null
    }))
  })

export const recordJobCompletion = async (
  execution: MonitorJobExecution,
  status: CronRunStatus,
  details: CompletionDetails = {}
): Promise<boolean> => completeRow(execution.taskId, execution, status, details)

export const recordJobAbandoned = async (execution: MonitorJobExecution): Promise<void> =>
  abandonRow(execution.taskId, execution)

/**
 * The platforms whose latest master-import row has no completion — the ones
 * the monitor owes a re-run, whatever their scheduled time says.
 */
export const incompleteJobPlatforms = async (job: MonitorJobId): Promise<string[]> => {
  const latest = new Map<string, MonitorJobExecution>()

  for (const row of await readJobHistory(job)) {
    for (const entry of row.platforms ?? []) {
      // Newest first, so the first row seen for a platform is its latest.
      if (!latest.has(entry.platform)) latest.set(entry.platform, row)
    }
  }

  return [...latest.entries()]
    .filter(([, row]) => row.completedAt === null)
    .map(([platform]) => platform)
}

/** Whether a job's latest row has no completion. */
export const jobIncomplete = async (job: MonitorJobId): Promise<boolean> =>
  (await readJobHistory(job))[0]?.completedAt === null
