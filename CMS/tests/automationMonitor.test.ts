import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  AUTOMATION_MONITOR_INTERVAL_MINUTES,
  AUTOMATION_MONITOR_INTERVAL_MS
} from '@shared/constants/automationMonitor'

/**
 * The monitor is the only thing that starts a scheduled task.
 *
 * Pinned here: the scheduler on its own starts nothing — a sign-in only ASKS
 * for a pass — and once the monitor is loaded it wakes on the constant's
 * interval, not before, and runs what the schedule and the history tables say
 * is owed, in dependency order.
 *
 * ORDER MATTERS IN THIS FILE. The first test runs before the monitor module is
 * imported, which is the only way to show the scheduler has no clock of its own.
 */

const calls = vi.hoisted(() => ({ ran: [] as string[] }))

interface Record_ {
  taskId: string
  enabled: boolean
  cron: { kind: 'interval'; everyMinutes: number } | null
  lastRunAt?: number
}

const state = vi.hoisted(() => ({ records: [] as Record_[] }))

vi.mock('electron', () => ({ net: { isOnline: () => true } }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>) => work(),
  automationHolder: () => null,
  isAutomationBusy: () => false
}))
vi.mock('@main/services/cronHistory.store', async () => {
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
vi.mock('@main/services/automationSchedule.store', () => ({
  readTaskRecords: () => Promise.resolve(state.records),
  readTaskRecord: (id: string) =>
    Promise.resolve(state.records.find(record => record.taskId === id) ?? null),
  writeTaskRecord: (taskId: string, patch: Partial<Record_>) => {
    const existing = state.records.find(record => record.taskId === taskId)

    if (existing) Object.assign(existing, patch)
    else state.records.push({ taskId, enabled: true, cron: null, ...patch })

    return Promise.resolve()
  }
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  writeScheduledRun: () => Promise.resolve()
}))
vi.mock('@main/services/masterBackup.service', () => ({
  readBackupSettings: () => Promise.resolve({ dailyTime: null })
}))
vi.mock('@main/services/automationTasks', () => ({
  sessionPauseEnabled: () => true,
  outstandingSessions: () => Promise.resolve({ count: 0, detail: '' }),
  taskRunner: (id: string) => () => {
    calls.ran.push(id)

    return Promise.resolve({ detail: 'done', total: 0, succeeded: 0, failed: 0, summary: [], rows: [] })
  }
}))

// The background processes the Automations switch starts and stops. Not what
// this file tests, and loading the real ones (the core, a browser runtime)
// inside a test is slow enough to time out under a full parallel run.
const imports = vi.hoisted(() => ({
  nextAt: null as number | null,
  runs: 0,
  queueChecks: 0,
  forced: 0,
  signedIn: false
}))

vi.mock('@main/services/importScheduler.service', () => ({
  startImportScheduler: vi.fn(),
  stopImportScheduler: vi.fn(),
  forceImportsOnce: () => {
    imports.forced += 1
  },
  // The master import's own clock, which the monitor wakes for.
  nextImportAt: () => imports.nextAt,
  runDueImports: () => {
    imports.runs += 1

    return Promise.resolve()
  }
}))
vi.mock('@main/services/masterImportQueue.service', () => ({
  startMasterImportQueue: vi.fn(),
  stopMasterImportQueue: vi.fn(),
  nextQueueCheckAt: () => null,
  drainQueueIfDue: () => {
    imports.queueChecks += 1

    return Promise.resolve()
  }
}))
vi.mock('@main/services/claimAutoRunner.service', () => ({ startDraining: vi.fn() }))
vi.mock('@main/services/reClaim.service', () => ({ stopReClaim: vi.fn() }))
vi.mock('@main/services/session.store', () => ({
  getSession: () => (imports.signedIn ? { token: 't' } : null)
}))

const { resumeSchedule, runTaskNow } = await import('@main/services/automationScheduler.service')

const HOUR = 60 * 60 * 1000

/** Every task, last run two hours ago: all of them owed. */
const allOwed = (): Record_[] =>
  [
    'auto-claim',
    'session-refresh',
    'refill-data',
    'status-change',
    'ajio-master-data',
    'snapdeal-master-data',
    'flipkart-master-data'
  ].map(taskId => ({
    taskId,
    enabled: true,
    cron: { kind: 'interval', everyMinutes: 60 },
    lastRunAt: Date.now() - 2 * HOUR
  }))

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 80; turn += 1) await Promise.resolve()
}

afterAll(() => {
  vi.useRealTimers()
})

describe('the automation monitor', () => {
  it('checks every 30 minutes', () => {
    expect(AUTOMATION_MONITOR_INTERVAL_MINUTES).toBe(30)
    expect(AUTOMATION_MONITOR_INTERVAL_MS).toBe(30 * 60 * 1000)
  })

  it('is the only thing that starts a task — the scheduler alone runs nothing', async () => {
    state.records = allOwed()

    // A sign-in asks for a pass. With no monitor loaded, nobody answers.
    resumeSchedule()
    await settle()

    expect(calls.ran).toEqual([])
  })

  it('refuses a Run now with no monitor to carry it out, rather than running it some other way', async () => {
    const result = await runTaskNow({ taskId: 'auto-claim' })

    expect(result.success).toBe(false)
    expect(calls.ran).toEqual([])
  })

  it('carries out a Run now once it is loaded', async () => {
    await import('@main/services/monitor.service')
    calls.ran.length = 0

    const result = await runTaskNow({ taskId: 'auto-claim' })

    expect(result.success).toBe(true)
    expect(calls.ran).toEqual(['auto-claim'])
  })

  it('wakes at the task trigger time, ahead of the routine check', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    const { startMonitor, stopMonitor } = await import('@main/services/monitor.service')

    // Login update hourly, last run 50 minutes ago → due in 10 minutes. The
    // rest ran just now on two hours, so nothing else comes round before it.
    state.records = allOwed().map(record => ({
      ...record,
      cron: { kind: 'interval' as const, everyMinutes: record.taskId === 'session-refresh' ? 60 : 120 },
      lastRunAt: record.taskId === 'session-refresh' ? Date.now() - 50 * 60_000 : Date.now()
    }))
    calls.ran.length = 0

    startMonitor()
    // Let it read the tables and plan its first wake-up.
    for (let round = 0; round < 10; round += 1) await settle()

    vi.advanceTimersByTime(10 * 60_000 - 1)
    await settle()
    expect(calls.ran).toEqual([])

    vi.advanceTimersByTime(1)
    // Waited on WITHOUT calling the monitor, which would start a pass of its
    // own and pass this test whether or not the timer had fired.
    for (let round = 0; round < 50 && calls.ran.length < 1; round += 1) await settle()

    // Ten minutes, not thirty — and only the task that came round.
    expect(calls.ran).toEqual(['session-refresh'])

    stopMonitor()
  })

  it('is switched on and off by the Automations toggle, and the background processes with it', async () => {
    const { automationsSwitched } = await import('@main/services/monitorSignal')
    const importScheduler = await import('@main/services/importScheduler.service')
    const queue = await import('@main/services/masterImportQueue.service')
    const reClaim = await import('@main/services/reClaim.service')

    automationsSwitched(false)

    expect(importScheduler.stopImportScheduler).toHaveBeenCalled()
    expect(queue.stopMasterImportQueue).toHaveBeenCalled()
    expect(reClaim.stopReClaim).toHaveBeenCalled()

    // Signed out (no session in this file), so switching on starts the monitor
    // alone — the import schedule and queue wait for a sign-in.
    automationsSwitched(true)

    expect(importScheduler.startImportScheduler).not.toHaveBeenCalled()

    automationsSwitched(false)
  })

  it('wakes at the master-import time too, and runs the import on that pass', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })

    const { startMonitor, stopMonitor } = await import('@main/services/monitor.service')
    const { automationsSwitched } = await import('@main/services/monitorSignal')

    // Every task ran just now on two hours, so only the import comes round.
    state.records = allOwed().map(record => ({
      ...record,
      cron: { kind: 'interval' as const, everyMinutes: 120 },
      lastRunAt: Date.now()
    }))
    imports.nextAt = Date.now() + 5 * 60_000
    imports.runs = 0
    calls.ran.length = 0

    // The previous test left it switched off.
    automationsSwitched(true)
    stopMonitor()
    startMonitor()
    for (let round = 0; round < 10; round += 1) await settle()

    imports.runs = 0
    vi.advanceTimersByTime(5 * 60_000 - 1)
    await settle()
    expect(imports.runs).toBe(0)

    imports.nextAt = null
    vi.advanceTimersByTime(1)
    for (let round = 0; round < 50 && imports.runs < 1; round += 1) await settle()

    // Five minutes, not thirty — and no task ran with it.
    expect(imports.runs).toBe(1)
    expect(calls.ran).toEqual([])

    stopMonitor()
  })

  it('imports every platform once when the operator switches Automations on — not when the app does', async () => {
    const { automationsSwitched } = await import('@main/services/monitorSignal')
    const { stopMonitor } = await import('@main/services/monitor.service')

    imports.signedIn = true
    imports.forced = 0

    // The app switching itself back on, after a capture lifted its login pause.
    automationsSwitched(false)
    automationsSwitched(true)
    expect(imports.forced).toBe(0)

    // The operator's toggle: the TOGGLE_ON automation.
    automationsSwitched(false)
    automationsSwitched(true, 'toggle-on')
    expect(imports.forced).toBe(1)

    automationsSwitched(false)
    stopMonitor()
    imports.signedIn = false
  })
})

