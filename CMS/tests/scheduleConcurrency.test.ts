import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Exactly one cron runs at a time — including a Run now.
 *
 * THIS REVERSES WHAT THIS FILE USED TO PIN, deliberately and on instruction.
 * The old rule let a manual run start beside a scheduled one, on the reasoning
 * that `withAutomationLock` queues browser work anyway so nothing was being
 * protected. The scheduler now has to guarantee mutual exclusion itself: every
 * execution is recorded, a failure blocks the tasks after it, and both of those
 * mean something reading the history has to be able to say which single task
 * was running at any moment.
 *
 * SO A RUN NOW WAITS RATHER THAN BEING REFUSED. Refusing it was the original
 * complaint — claims for platforms whose sessions were already good sat behind
 * a login they did not need — and queueing answers that without giving up the
 * rule: the work still happens, next, instead of never.
 *
 * A second press on the SAME task is still refused outright, because queueing
 * that would file the same claims twice, just one after the other.
 */

const calls = vi.hoisted(() => ({ ran: [] as string[] }))

const state = vi.hoisted(() => ({
  /** Resolves a task's work, so a run can be held open while another starts. */
  hold: null as null | (() => void)
}))

vi.mock('electron', () => ({ net: { isOnline: () => true } }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>) => work(),
  automationHolder: () => null,
  // Nothing holds the browser in these tests: what is being pinned is the
  // scheduler's own guard, which is a different question from the lock's.
  isAutomationBusy: () => false
}))
vi.mock('@main/services/cronHistory.store', async () => {
  // The scheduler reads every decision from the history and verifies each
  // completion by reading it back, so the store has to exist for a run to
  // count as finished at all. See tests/helpers/cronHistoryMock.
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
vi.mock('@main/services/automationSchedule.store', () => ({
  readTaskRecords: () => Promise.resolve([]),
  readTaskRecord: () => Promise.resolve(null),
  writeTaskRecord: () => Promise.resolve()
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({ writeScheduledRun: () => Promise.resolve() }))
vi.mock('@main/services/automationTasks', () => ({
  taskRunner: (id: string) => async () => {
    calls.ran.push(id)

    if (id === 'session-refresh') {
      // Held open, so the Auto claim below starts while this one is going.
      await new Promise<void>(resolve => {
        state.hold = resolve
      })
    }

    return { detail: 'done', total: 0, succeeded: 0, failed: 0, summary: [], rows: [] }
  }
}))

const { runTaskNow } = await import('@main/services/automationScheduler.service')

// Run now is carried out by the monitor, so it has to be loaded for one to run.
await import('@main/services/monitor.service')

const cronHistory = (await import('@main/services/cronHistory.store')) as unknown as {
  __reset: () => void
}

beforeEach(() => {
  // The history mock is module-scoped, so last test's rows would read as runs
  // that have already happened today.
  cronHistory.__reset()
  calls.ran.length = 0
  state.hold = null
})

describe('running a task while another is going', () => {
  it('makes a Run now WAIT for the task already going, rather than joining it', async () => {
    /*
     * The rule in one case. Auto claim must not begin while the Session update
     * is still signing in — but it must not be thrown away either, which is
     * what refusing it amounted to.
     */
    const sessions = runTaskNow({ taskId: 'session-refresh' })

    await vi.waitFor(() => expect(state.hold).not.toBeNull())

    const claims = runTaskNow({ taskId: 'auto-claim' })

    // Several turns of the microtask queue: enough for a run that was going to
    // start in parallel to have started.
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()

    expect(calls.ran, 'auto claim started while the session update was going').not.toContain(
      'auto-claim'
    )

    // Let the session update finish; the claims run should then take its turn.
    state.hold?.()
    await sessions

    const result = await claims

    expect(result.success).toBe(true)
    // One after the other, in the order they were asked for.
    expect(calls.ran).toEqual(['session-refresh', 'auto-claim'])
  })

  it('still refuses a second run of the SAME task', async () => {
    const first = runTaskNow({ taskId: 'session-refresh' })

    await vi.waitFor(() => expect(state.hold).not.toBeNull())

    const second = await runTaskNow({ taskId: 'session-refresh' })

    expect(second.success).toBe(false)
    /*
     * REFUSED, NOT QUEUED, and this is the one place the two differ. Queueing a
     * second press of the same task would file the same work twice — a second
     * later rather than at the same moment, which is no better. A double-click
     * is not a request for two runs.
     */
    expect(calls.ran.filter(id => id === 'session-refresh')).toHaveLength(1)

    state.hold?.()
    await first
  })
})
