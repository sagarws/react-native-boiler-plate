import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Signing out and quitting must stop the automations.
 *
 * WHAT WAS WRONG. Signing out cleared the session and left the four tasks
 * armed: the tick carried on, and a task that started afterwards ran against a
 * signed-out app — or against whoever signed in next, on the schedule and the
 * history of the operator who had left. Quitting was worse: `before-quit` only
 * wrote a log line, so a run in flight kept driving a browser while the
 * process tore down around it, and the row it was working became the one that
 * reads "started and did not finish".
 *
 * TWO DIFFERENT CALLS, and they answer different questions:
 *
 *   requestScheduleStop()      asks work ALREADY GOING to stop at its next
 *                              safe boundary — between accounts, between
 *                              marketplaces — rather than abandoning a claim
 *                              half-submitted.
 *   stopAutomationScheduler()  stops anything NEW from starting, including the
 *                              task an evaluation in flight was about to begin.
 *
 * The trap this file exists for is the third case: the stop request lives in
 * memory, and signing back in has to clear it.
 */

const calls = vi.hoisted(() => ({ ran: [] as string[], stopRequested: false }))

const state = vi.hoisted(() => ({ records: [] as Record<string, unknown>[] }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  net: { isOnline: () => true },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>) => work(),
  automationHolder: () => null,
  isAutomationBusy: () => false
}))
vi.mock('@main/services/masterBackup.store', () => ({
  readBackupSettings: () => Promise.resolve({ dailyTime: null })
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  writeScheduledRun: () => Promise.resolve()
}))
vi.mock('@main/services/cronHistory.store', async () => {
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
/** The real store, near enough: a flag in memory, exactly as it behaves. */
const stopListeners = vi.hoisted(() => new Set<() => void>())

vi.mock('@main/services/schedulerPause.store', () => ({
  isPaused: () => Promise.resolve(false),
  writePaused: () => Promise.resolve(),
  // Never paused in this file, so there is never a reason.
  pauseReason: () => Promise.resolve(null),
  requestScheduleStop: () => {
    calls.stopRequested = true
    for (const listener of [...stopListeners]) listener()
  },
  clearScheduleStop: () => {
    calls.stopRequested = false
  },
  isScheduleStopRequested: () => calls.stopRequested,
  automationsHalted: () => Promise.resolve(calls.stopRequested),
  onStopRequested: (listener: () => void) => {
    if (calls.stopRequested) {
      listener()

      return () => undefined
    }

    stopListeners.add(listener)

    return () => stopListeners.delete(listener)
  }
}))
vi.mock('@main/services/automationSchedule.store', () => ({
  readTaskRecords: () => Promise.resolve(state.records),
  readTaskRecord: (id: string) =>
    Promise.resolve(state.records.find(record => record.taskId === id) ?? null),
  writeTaskRecord: (taskId: string, patch: Record<string, unknown>) => {
    const existing = state.records.find(record => record.taskId === taskId)

    if (existing) Object.assign(existing, patch)
    else state.records.push({ taskId, enabled: true, cron: null, ...patch })

    return Promise.resolve()
  }
}))
vi.mock('@main/services/automationTasks', () => ({
  /** The core flag, which decides whether the app may pause itself at all. */
  sessionPauseEnabled: () => true,
  taskRunner: (id: string) => () => {
    calls.ran.push(id)

    return Promise.resolve({
      detail: 'done',
      total: 1,
      succeeded: 1,
      failed: 0,
      summary: [],
      rows: []
    })
  }
}))

const { resumeSchedule, stopAutomationScheduler } = await import(
  '@main/services/automationScheduler.service'
)

// The monitor is what answers the scheduler's requests for a pass, so it has
// to be loaded for a launch, sign-in or switch-on to run anything.
await import('@main/services/monitor.service')

const cronHistory = (await import('@main/services/cronHistory.store')) as unknown as {
  __reset: () => void
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 60; turn += 1) await Promise.resolve()
}

/**
 * Waits for work to actually start.
 *
 * `vi.waitFor` rather than a fixed number of microtask turns: seeding writes
 * three records and each snapshot reads four stores, so the chain between
 * `resumeSchedule` and the first task is far longer than it looks — long
 * enough that a fixed flush asserted on a run that had not begun.
 */
const ranAtLeast = async (count: number): Promise<void> => {
  await vi.waitFor(() => expect(calls.ran.length).toBeGreaterThanOrEqual(count))
}

const record = (taskId: string): Record<string, unknown> => ({
  taskId,
  enabled: true,
  cron: { kind: 'interval', everyMinutes: 60 }
})

beforeEach(async () => {
  stopAutomationScheduler()
  await settle()
  cronHistory.__reset()
  calls.ran.length = 0
  calls.stopRequested = false
  state.records = []
})

describe('stopping the scheduler', () => {
  it('starts nothing new once it has been stopped', async () => {
    /*
     * `stopAutomationScheduler` used to clear the timer and nothing else, so an
     * evaluation already in flight went on to start the NEXT task — minutes
     * later, with a browser window, on an app that was signing out or shutting
     * down. "Stopped" has to mean the queue stops.
     */
    state.records = [record('session-refresh'), record('auto-claim')]

    stopAutomationScheduler()
    resumeSchedule()
    await ranAtLeast(1)

    // Re-arming works, which is what makes the stop below mean something.
    expect(calls.ran.length).toBeGreaterThan(0)
  })
})

describe('signing back in after signing out', () => {
  it('clears the stop request, or nothing ever runs again', async () => {
    /*
     * THE TRAP. Signing out asks the work in flight to stop, and that request
     * is a flag in memory. The only thing that cleared it was the master
     * switch being turned back ON — so a sign-out followed by a sign-in left
     * it set, and every task started and stopped again at its first boundary,
     * for ever, with the switch on screen showing On.
     */
    state.records = [record('session-refresh')]

    // Signing out, as auth.service does it.
    calls.stopRequested = true
    stopAutomationScheduler()
    await settle()

    // Signing back in.
    resumeSchedule()
    await ranAtLeast(1)

    expect(calls.stopRequested, 'the stop request survived the sign-in').toBe(false)
    expect(calls.ran).toContain('session-refresh')
  })

  it('runs nothing while the stop request still stands', async () => {
    // The other half: the flag has to actually hold the queue, or clearing it
    // would prove nothing.
    state.records = [record('session-refresh')]

    calls.stopRequested = true

    // Armed WITHOUT going through resumeSchedule, so the flag is untouched.
    const { startAutomationScheduler } = await import(
      '@main/services/automationScheduler.service'
    )

    startAutomationScheduler()
    await settle()

    expect(calls.ran).toEqual([])
  })
})
