import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Opening the app runs what the machine missed while it was shut.
 *
 * THE APP IS NOT A SERVER. It is closed overnight, over a weekend, for a
 * fortnight while somebody is away — and every window that passes while it is
 * shut is a night of claims nobody filed. The tick catches a task whose cron is
 * due; it cannot catch a machine opened at 11:00 that has already missed 02:00.
 *
 * What is pinned here is the ORDER and the restraint: sessions before the
 * things that sign in with them, the refill before the claims it unblocks, one
 * at a time — and nothing at all for a task an operator has switched off, or
 * one that ran within the hour.
 */

const calls = vi.hoisted(() => ({ ran: [] as string[], online: true }))

interface Record_ {
  taskId: string
  enabled: boolean
  cron: { kind: 'interval'; everyMinutes: number } | null
  lastRunAt?: number
}

const state = vi.hoisted(() => ({ records: [] as Record_[] }))

vi.mock('electron', () => ({ net: { isOnline: () => calls.online } }))
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
  // The scheduler reads every decision from the history and verifies each
  // completion by reading it back, so the store has to exist for a run to
  // count as finished at all. See tests/helpers/cronHistoryMock.
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
vi.mock('@main/services/automationSchedule.store', () => ({
  readTaskRecords: () => Promise.resolve(state.records),
  readTaskRecord: (id: string) =>
    Promise.resolve(state.records.find(record => record.taskId === id) ?? null),
  // Kept rather than discarded: the sign-in case below turns on what the SEED
  // writes being there for the catch-up to read a moment later.
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
  /** The core flag, and what the Login update left behind: no hold here. */
  sessionPauseEnabled: () => true,
  outstandingSessions: () => Promise.resolve({ count: 0, detail: '' }),
  taskRunner: (id: string) => () => {
    calls.ran.push(id)

    return Promise.resolve({
      detail: 'done',
      total: 0,
      succeeded: 0,
      failed: 0,
      summary: [],
      rows: []
    })
  }
}))

const { resumeSchedule, startAutomationScheduler, stopAutomationScheduler } = await import(
  '@main/services/automationScheduler.service'
)

// The monitor is what answers the scheduler's requests for a pass, so it has
// to be loaded for a launch, sign-in or switch-on to run anything.
await import('@main/services/monitor.service')

const HOUR = 60 * 60 * 1000

const record = (taskId: string, overrides: Partial<Record_> = {}): Record_ => ({
  taskId,
  enabled: true,
  cron: { kind: 'interval', everyMinutes: 60 },
  lastRunAt: Date.now(),
  ...overrides
})

/**
 * Waits for the catch-up to reach a count and stay there.
 *
 * `vi.waitFor` rather than a fixed number of microtask flushes: each task is
 * awaited before the next begins, so the chain is as long as the work — and a
 * flush count that happened to be enough today would fail the day a task gained
 * one more await.
 */
const ranAtLeast = async (count: number): Promise<void> => {
  await vi.waitFor(() => expect(calls.ran.length).toBeGreaterThanOrEqual(count))
}

/** Nothing should run: give the chain a chance to prove it does not. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 40; i += 1) await Promise.resolve()
}

const cronHistory = (await import('@main/services/cronHistory.store')) as unknown as {
  __reset: () => void
}

beforeEach(async () => {
  // The history mock is module-scoped, so last test's rows would read as runs
  // that have already happened today.
  cronHistory.__reset()
  stopAutomationScheduler()
  // The catch-up guard is module-level, so a chain still unwinding from the
  // last test would turn the next one's run into a silent no-op.
  await settle()
  calls.ran.length = 0
  calls.online = true
  state.records = []
})

describe('opening the app', () => {
  it('runs the stale tasks in the order the schedule runs them', async () => {
    // Nothing has run for two hours — the machine was shut.
    state.records = [
      record('auto-claim', { lastRunAt: Date.now() - 2 * HOUR }),
      record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 2 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 2 * HOUR }),
      record('ajio-master-data', { lastRunAt: Date.now() - 2 * HOUR }),
      record('snapdeal-master-data', { lastRunAt: Date.now() - 2 * HOUR }),
      record('flipkart-master-data', { lastRunAt: Date.now() - 2 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(5)

    // Sessions first — everything below signs in with them. The claims last,
    // on rows the refill has just made fileable.
    expect(calls.ran).toEqual([
      'session-refresh',
      'eligible-claims',
      'ajio-master-data',
      'snapdeal-master-data',
      'flipkart-master-data',
      'refill-data',
      'auto-claim',
      'status-change'
    ])
  })

  it('leaves alone anything that ran within the hour', async () => {
    /*
     * Every task is named: one left out would be SEEDED as never-run and would
     * then, correctly, catch up — which is a later test's subject, not this one.
     *
     * The stale one is the SESSION update, deliberately. Any other stale task
     * pulls the sessions in behind it (see "the sessions everything else signs
     * in with", below), so this is the only shape that isolates the hour rule
     * from that one.
     */
    state.records = [
      record('eligible-claims', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR }),
      record('ajio-master-data', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('snapdeal-master-data', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('flipkart-master-data', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('refill-data', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('status-change', { lastRunAt: Date.now() - 5 * 60 * 1000 }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * 60 * 1000 })
    ]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran).toEqual(['session-refresh'])
  })

  it('does not overrule a task the operator switched off', async () => {
    // Off is a decision. Catching up is not a reason to undo it.
    state.records = [
      record('eligible-claims', { lastRunAt: Date.now() }),
      record('session-refresh', { enabled: false, lastRunAt: Date.now() - 5 * HOUR }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('auto-claim', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 5 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(1)

    expect(calls.ran).toEqual(['refill-data', 'status-change'])
  })

  it('waits rather than starting four automations offline', async () => {
    calls.online = false
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR })]

    startAutomationScheduler()
    await settle()

    expect(calls.ran).toEqual([])
  })
})

describe('signing in after somebody signed out', () => {
  it('rebuilds the schedule and runs all five, with no history to go on', async () => {
    /*
     * THE BUG. Signing out wipes this machine's local data, the schedule
     * records with it — and the scheduler is armed ONCE, at launch. The next
     * operator signed in to an app whose tick found no task enabled: nothing
     * ran, and the empty Jobs history made it look as though nothing was due.
     *
     * Note what is NOT here: no records, so no `lastRunAt` to be an hour old.
     * A machine with no history is the strongest case for running, not a
     * machine that is up to date.
     */
    state.records = []

    resumeSchedule()
    await ranAtLeast(5)

    expect(calls.ran).toEqual([
      'session-refresh',
      'eligible-claims',
      'ajio-master-data',
      'snapdeal-master-data',
      'flipkart-master-data',
      'refill-data',
      'auto-claim',
      'status-change'
    ])
  })

  it('does not start a second catch-up on top of the one already going', async () => {
    state.records = []

    resumeSchedule()
    resumeSchedule()
    await ranAtLeast(6)
    await settle()

    // Six automations, once each — not two of everything racing the browser.
    expect(calls.ran).toHaveLength(8)
  })
})

describe('the sessions everything else signs in with', () => {
  it('re-checks them first, even when only the other tasks are stale', async () => {
    /*
     * THE BUG. The hour rule is per task, so this shape slipped through: the
     * Session update ran at 18:54, the app was reopened at 19:35, and the
     * catch-up found the AJIO sync, the refill and the claims stale while the
     * sessions — forty-one minutes old — were not. Three jobs that sign in ran
     * against sessions nobody had asked the marketplace about, and Check now
     * afterwards named an account the run had never looked at.
     */
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 41 * 60 * 1000 }),
      record('ajio-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('snapdeal-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('flipkart-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 5 * HOUR }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(5)

    expect(calls.ran).toEqual([
      'session-refresh',
      'eligible-claims',
      'ajio-master-data',
      'snapdeal-master-data',
      'flipkart-master-data',
      'refill-data',
      'auto-claim',
      'status-change'
    ])
  })

  it('does not run them when nothing else is catching up either', async () => {
    // A quiet reopen is not a reason to sign in to eight marketplaces.
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 41 * 60 * 1000 }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() }),
      record('status-change', { lastRunAt: Date.now() }),
      record('auto-claim', { lastRunAt: Date.now() })
    ]

    startAutomationScheduler()
    await settle()

    expect(calls.ran).toEqual([])
  })

  it('respects the operator switching the Session update off', async () => {
    state.records = [
      record('eligible-claims', { lastRunAt: Date.now() }),
      record('session-refresh', { enabled: false, lastRunAt: Date.now() }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() }),
      record('status-change', { lastRunAt: Date.now() }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran).toEqual(['auto-claim'])
  })
})
