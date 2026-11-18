import type { CronExecution, ScheduledTaskId } from '@shared/types/automationSchedule'

/**
 * An in-memory stand-in for the per-task history collections.
 *
 * WHY THE SCHEDULER TESTS NEED ONE. The scheduler now takes every decision from
 * the history on disk, and it verifies a completion by reading it back — so
 * without a working store every run is correctly judged unverifiable and fails.
 * That is the production behaviour working as intended; in a test it just means
 * the store has to be present.
 *
 * Fresh state per call, so one test file cannot see another's rows.
 */
export const cronHistoryMock = (): Record<string, unknown> => {
  const rows: CronExecution[] = []

  const forTask = (taskId: ScheduledTaskId): CronExecution[] =>
    rows.filter(row => row.taskId === taskId)

  const successful = (taskId: ScheduledTaskId): CronExecution | undefined =>
    forTask(taskId).find(
      row =>
        row.completedAt !== null &&
        (row.status === 'completed' || row.status === 'completed_with_errors')
    )

  return {
    /** Exposed so a test can seed or inspect history. */
    __rows: rows,

    /**
     * Empties the history between tests.
     *
     * The mock factory runs ONCE per test file, so without this the rows a
     * test leaves behind are still there for the next one — which reads as a
     * task that has already run today and is therefore not due. Every symptom
     * of that is a test failing for the previous test's reasons.
     */
    __reset: () => {
      rows.length = 0
    },

    readHistory: (taskId: ScheduledTaskId) => Promise.resolve(forTask(taskId)),

    latestExecution: (taskId: ScheduledTaskId) => Promise.resolve(forTask(taskId)[0] ?? null),

    lastSuccessfulCompletion: (taskId: ScheduledTaskId) => {
      const row = successful(taskId)

      return Promise.resolve(row?.completedAt ? Date.parse(row.completedAt) : null)
    },

    handledOccurrences: (taskId: ScheduledTaskId) =>
      Promise.resolve(
        new Set(
          forTask(taskId)
            .filter(
              row =>
                row.occurrence !== null &&
                (row.status === 'completed' || row.status === 'completed_with_errors')
            )
            .map(row => row.occurrence as number)
        )
      ),

    recordStart: (
      taskId: ScheduledTaskId,
      options: { occurrence?: number | null; manual?: boolean; trigger?: CronExecution['trigger'] } = {}
    ) => {
      const execution: CronExecution = {
        id: `${taskId}-${rows.length}`,
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
        ...(options.trigger ? { trigger: options.trigger } : {})
      }

      rows.unshift(execution)

      return Promise.resolve(execution)
    },

    recordCompletion: (
      execution: CronExecution,
      status: CronExecution['status'],
      details: Record<string, unknown> = {}
    ) => {
      const index = rows.findIndex(row => row.id === execution.id)

      if (index >= 0) {
        rows[index] = {
          ...execution,
          completedAt: new Date().toISOString(),
          status,
          detail: (details.detail as string | null) ?? null,
          error: (details.error as string | null) ?? null,
          total: (details.total as number) ?? 0,
          succeeded: (details.succeeded as number) ?? 0,
          failed: (details.failed as number) ?? 0,
          ...(details.platforms ? { platforms: details.platforms as NonNullable<CronExecution['platforms']> } : {})
        }
      }

      // The real one reads the row back; this one is trivially consistent.
      return Promise.resolve(true)
    },

    recordSkip: (taskId: ScheduledTaskId, occurrence: number | null, reason: string) => {
      const now = new Date().toISOString()

      // Unshifted, so it is the LATEST row — which is what clears the block.
      rows.unshift({
        id: `${taskId}-skip-${rows.length}`,
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
      })

      return Promise.resolve()
    },

    /** Switched off under it: flagged, and never given a completion. */
    recordAbandoned: (execution: CronExecution) => {
      const row = rows.find(entry => entry.id === execution.id)

      if (row && row.completedAt === null) row.interrupted = true

      return Promise.resolve()
    },

    /** As the real one: flags every row with no completion, closes none. */
    recoverInterruptedExecutions: () => {
      const tasks = new Set<ScheduledTaskId>()

      for (const row of rows) {
        if (row.completedAt === null && row.interrupted !== true) {
          row.interrupted = true
          tasks.add(row.taskId)
        }
      }

      return Promise.resolve([...tasks])
    },

    // The master-import jobs' histories — empty in the scheduler tests.
    readJobHistory: () => Promise.resolve([]),
    incompleteJobPlatforms: () => Promise.resolve([]),
    jobIncomplete: () => Promise.resolve(false)
  }
}
