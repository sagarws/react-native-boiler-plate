import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronExecution, ScheduledRunArchive, TaskOutcome } from '@shared/types/automationSchedule'

/**
 * What a scheduled run leaves behind.
 *
 * The record IS the feature. Nobody watches these run, so "did last night work?"
 * is answered entirely by the row this writes — and a run that did the work and
 * failed to write it down is, from the operator's side of the screen, a run that
 * did not happen.
 *
 * Three things are pinned: the numbers reach the row unaltered, a failure is
 * recorded rather than swallowed, and a Run now does not close that night's
 * window.
 */

const state = vi.hoisted(() => ({
  archived: [] as ScheduledRunArchive[],
  records: new Map<string, Record<string, unknown>>(),
  outcome: null as TaskOutcome | null,
  throws: null as string | null,
  busy: null as string | null
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  net: { isOnline: () => true },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/automationLock', () => ({
  isAutomationBusy: () => state.busy !== null,
  automationHolder: () => state.busy
}))
vi.mock('@main/services/masterBackup.store', () => ({
  readBackupSettings: () => Promise.resolve({ dailyTime: null })
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  writeScheduledRun: (archive: ScheduledRunArchive) => {
    state.archived.push(archive)

    return Promise.resolve()
  }
}))
vi.mock('@main/services/cronHistory.store', async () => {
  // The scheduler reads every decision from the history and verifies each
  // completion by reading it back, so the store has to exist for a run to
  // count as finished at all. See tests/helpers/cronHistoryMock.
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
vi.mock('@main/services/automationSchedule.store', () => ({
  readTaskRecords: () => Promise.resolve([...state.records.values()]),
  readTaskRecord: (id: string) => Promise.resolve(state.records.get(id) ?? null),
  writeTaskRecord: (id: string, patch: Record<string, unknown>) => {
    state.records.set(id, { ...(state.records.get(id) ?? {}), ...patch, taskId: id })

    return Promise.resolve()
  }
}))

/**
 * A stand-in for the four real adapters.
 *
 * The scheduler is supposed to know nothing about what a task does, so the test
 * gives it a task that does nothing — and everything asserted below still holds.
 * If this needed a real marketplace to pass, the separation would not be real.
 */
vi.mock('@main/services/automationTasks', () => ({
  taskRunner: () => () => {
    if (state.throws) return Promise.reject(new Error(state.throws))

    return Promise.resolve(state.outcome)
  }
}))

const { runTaskNow, saveTaskSchedule, scheduleState } = await import(
  '@main/services/automationScheduler.service'
)

// Run now is carried out by the monitor, so it has to be loaded for one to run.
await import('@main/services/monitor.service')

const outcome = (over: Partial<TaskOutcome> = {}): TaskOutcome => ({
  detail: 'Forward 412 · Return 388',
  total: 1000,
  succeeded: 800,
  failed: 2,
  summary: [{ label: 'Records synced', value: '800' }],
  rows: [{ ref: 'Forward report', ticketId: null, note: '412 saved' }],
  ...over
})

const cronHistory = (await import('@main/services/cronHistory.store')) as unknown as {
  __reset: () => void
  __rows: CronExecution[]
}

beforeEach(() => {
  // The history mock is module-scoped, so last test's rows would read as runs
  // that have already happened today.
  cronHistory.__reset()
  state.archived.length = 0
  state.records.clear()
  state.outcome = outcome()
  state.throws = null
  state.busy = null
})

describe('a scheduled run', () => {
  it('writes one job row carrying exactly what the task reported', async () => {
    const result = await runTaskNow({ taskId: 'ajio-master-data' })

    expect(result.success).toBe(true)
    expect(state.archived).toHaveLength(1)

    const [row] = state.archived

    // Unaltered. The scheduler does no arithmetic on a task's numbers — it does
    // not know what they count, and would only be guessing.
    expect(row?.total).toBe(1000)
    expect(row?.succeeded).toBe(800)
    expect(row?.failed).toBe(2)
    expect(row?.detail).toBe('Forward 412 · Return 388')
    expect(row?.summary).toEqual([{ label: 'Records synced', value: '800' }])
    expect(row?.status).toBe('done')
    expect(row?.error).toBeNull()
    // Named for the Jobs list, and stamped so "how long did it take" is answerable.
    expect(row?.label).toBe('AJIO report sync')
    expect(row?.platform).toBe('Ajio')
    expect(Date.parse(row?.finishedAt ?? '')).toBeGreaterThanOrEqual(
      Date.parse(row?.startedAt ?? '')
    )
  })

  it('records a failure rather than losing it', async () => {
    state.throws = 'AJIO returned 502'

    const result = await runTaskNow({ taskId: 'ajio-master-data' })

    expect(result.success).toBe(false)
    // The row exists. A failed run that wrote nothing is indistinguishable from
    // a schedule that never fired — the exact confusion this page prevents.
    expect(state.archived).toHaveLength(1)
    expect(state.archived[0]?.status).toBe('failed')
    expect(state.archived[0]?.error).toBe('AJIO returned 502')
  })

  it('does not close tonight’s window when it was only a test', async () => {
    await runTaskNow({ taskId: 'ajio-master-data' })

    // `lastRunAt` is what makes a window "already done". A Run now at eleven in
    // the morning must not cancel the 02:30 run.
    expect(state.records.get('ajio-master-data')?.['lastRunAt']).toBeUndefined()
  })

  it('refuses to start while something else has the browser', async () => {
    state.busy = 'bulk-spf'

    const result = await runTaskNow({ taskId: 'refill-data' })

    expect(result.success).toBe(false)
    expect(state.archived).toHaveLength(0)
  })

  it('refuses a task this build does not know', async () => {
    const result = await runTaskNow({ taskId: 'make-tea' })

    expect(result.success).toBe(false)
  })
})

describe('changing a schedule', () => {
  it('will not arm a task with no time', async () => {
    // A task switched on with no schedule is a switch that reads as on and
    // never runs — worse than refusing.
    const result = await saveTaskSchedule({ taskId: 'auto-claim', enabled: true, cron: null })

    expect(result.success).toBe(false)
  })

  it('rejects a time that is not a time', async () => {
    const result = await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'times', times: ['2am'] }
    })

    expect(result.success).toBe(false)
  })

  it('rejects an interval too short to finish in', async () => {
    // Refused in the main process too, not only in the dialog: a schedule the
    // form checks and the scheduler does not is one an IPC call can still set.
    const result = await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'interval', everyMinutes: 1 }
    })

    expect(result.success).toBe(false)
  })

  it('accepts an interval, and several fixed times', async () => {
    const rotate = await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'interval', everyMinutes: 15 }
    })

    expect(rotate.success).toBe(true)
    expect(state.records.get('auto-claim')?.['cron']).toEqual({
      kind: 'interval',
      everyMinutes: 15
    })

    const twice = await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'times', times: ['14:00', '02:00'] }
    })

    expect(twice.success).toBe(true)
    // Sorted on the way in, so two equal schedules compare equal — which is
    // what the re-base check below depends on.
    expect(state.records.get('auto-claim')?.['cron']).toEqual({
      kind: 'times',
      times: ['02:00', '14:00']
    })
  })

  it('sets a baseline when armed, so it does not fire the moment it is switched on', async () => {
    const before = Date.now()

    await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'times', times: ['04:00'] }
    })

    const record = state.records.get('auto-claim')

    expect(record?.['enabled']).toBe(true)
    expect(record?.['baselineAt']).toBeGreaterThanOrEqual(before)
  })

  it('re-bases when the schedule CHANGES, not only when it is switched on', async () => {
    await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'times', times: ['04:00'] }
    })

    const first = state.records.get('auto-claim')?.['baselineAt'] as number

    // Moved from 04:00 to 23:00 at midday: without a re-base the task reads as
    // owed for an 04:00 that already passed, and starts immediately. The same
    // applies to switching to an interval, which would otherwise be overdue
    // from whenever it last ran.
    await new Promise(resolve => setTimeout(resolve, 2))
    await saveTaskSchedule({
      taskId: 'auto-claim',
      enabled: true,
      cron: { kind: 'times', times: ['23:00'] }
    })

    expect(state.records.get('auto-claim')?.['baselineAt'] as number).toBeGreaterThan(first)
  })

  it('reports a task with no schedule as off, never as due', async () => {
    const result = await scheduleState()

    expect(result.success).toBe(true)

    if (!result.success) return

    for (const task of result.data.tasks) {
      expect(task.enabled).toBe(false)
      // A "next run" on a task that is off reads as a run that is going to
      // happen, and it is not.
      expect(task.nextRunAt).toBeNull()
    }
  })
})

describe('the result per platform, in the history row', () => {
  it('files a single-marketplace task under that marketplace', async () => {
    await runTaskNow({ taskId: 'ajio-master-data' })

    const row = cronHistory.__rows.find(entry => entry.taskId === 'ajio-master-data')

    expect(row?.completedAt).not.toBe(null)
    // `beforeEach` runs every test on a fresh `outcome()`.
    const expected = outcome()

    expect(row?.platforms).toEqual([
      {
        platform: 'ajio',
        total: expected.total,
        succeeded: expected.succeeded,
        failed: expected.failed,
        detail: expected.detail
      }
    ])
  })

  it('keeps the breakdown a runner reports itself', async () => {
    const platforms = [
      { platform: 'ajio', total: 3, succeeded: 2, failed: 1, detail: null },
      { platform: 'meesho', total: 1, succeeded: 1, failed: 0, detail: null }
    ]

    state.outcome = { ...outcome(), platforms }
    await runTaskNow({ taskId: 'auto-claim' })

    expect(cronHistory.__rows.find(entry => entry.taskId === 'auto-claim')?.platforms).toEqual(platforms)
  })
})

