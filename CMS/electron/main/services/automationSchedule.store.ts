import type { ScheduledTaskId, TaskSchedule } from '@shared/types/automationSchedule'
import { isScheduledTaskId } from '@shared/constants/automationSchedule'
import { dataDirectory } from '../database'
import { JsonCollection } from '../database/jsonStore'
import { logger } from './logger'

/**
 * What the operator set, and what has happened since — one record per task.
 *
 * `baselineAt` is the reason this is on disk rather than in memory. Without a
 * baseline there is no way to tell "switched on an hour ago" from "has been
 * failing to run for a week": treat that as owed and switching a task on at
 * 09:00 immediately starts the 02:00 run, which on a machine somebody is using
 * means a browser taking over their screen. Recorded the moment a task is first
 * enabled, so the first run lands on the first scheduled moment after that.
 *
 * `failedAttempts` is the other one. The tick is a minute, so a task that cannot
 * succeed would otherwise produce a failure a minute until the window closed at
 * midnight — burying the first and most useful error under nine hundred copies.
 * Counted on disk so a restart does not reset the count and start the loop over.
 */
export interface TaskRecord extends TaskSchedule {
  taskId: ScheduledTaskId
  /** When this machine first armed this task. */
  baselineAt?: number
  /** When it last COMPLETED — success or a final failure. Epoch ms. */
  lastRunAt?: number
  /** Attempts at the current due window. Cleared when the window closes. */
  failedAttempts?: number
  /** The last run's one-line summary, so the card says something before Jobs is opened. */
  lastDetail?: string | null
  lastError?: string | null
}

let collection: JsonCollection<TaskRecord> | null = null

export const initialiseAutomationSchedule = (): void => {
  collection = new JsonCollection<TaskRecord>({
    name: 'automation-schedule',
    directory: dataDirectory()
  })
}

/**
 * Null until the app initialises it.
 *
 * A read treats that as "nothing scheduled" rather than throwing: the scheduler
 * ticks on a timer, and a tick that throws before the store is open would be an
 * unhandled rejection once a minute.
 */
const store = (): JsonCollection<TaskRecord> | null => collection

/** Every task the operator has touched. Tasks never switched on are simply absent. */
export const readTaskRecords = async (): Promise<TaskRecord[]> => {
  const records = await (store()
    ?.read()
    .catch(() => [] as TaskRecord[]) ?? Promise.resolve([] as TaskRecord[]))

  // A record whose id this build no longer knows is dropped rather than
  // surfaced: a renamed task must not reach the registry lookup as undefined.
  return records.filter(record => isScheduledTaskId(record.taskId))
}

export const readTaskRecord = async (taskId: ScheduledTaskId): Promise<TaskRecord | null> =>
  (await readTaskRecords()).find(record => record.taskId === taskId) ?? null

/** Merges a patch into one task's record, creating it if this is the first write. */
export const writeTaskRecord = async (
  taskId: ScheduledTaskId,
  patch: Partial<TaskRecord>
): Promise<void> => {
  const target = store()

  if (!target) {
    logger.warn(`[schedule] ${taskId} was not saved — the store is not open`)

    return
  }

  await target
    .mutate(records => {
      const current = records.find(record => record.taskId === taskId)
      const next: TaskRecord = {
        enabled: false,
        cron: null,
        time: null,
        ...current,
        ...patch,
        taskId
      }

      return {
        records: [...records.filter(record => record.taskId !== taskId), next],
        result: undefined
      }
    })
    .catch(error => logger.warn(`[schedule] could not save ${taskId}`, error))
}
