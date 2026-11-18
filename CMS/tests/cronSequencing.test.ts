import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CronExecution } from '@shared/types/automationSchedule'

/**
 * The scheduler end to end: what actually runs, in what order, and what a
 * failure stops.
 *
 * `cronQueue.test.ts` pins the RULES against plain values. This pins the
 * SERVICE — that it reads the history, honours the block, records a start
 * before the work and a completion after it, and never runs two at once. The
 * two together are the acceptance cases; neither covers the other, because the
 * rules being right does not mean they are wired up.
 */

const HOUR = 60 * 60 * 1000

const calls = vi.hoisted(() => ({
  ran: [] as string[],
  online: true,
  /** Tasks whose runner should fail, and how. */
  failing: new Set<string>(),
  /** Tasks whose runner returns "nothing worked" without throwing. */
  allFailed: new Set<string>(),
  /** Tasks where some of the work succeeded and some did not. */
  partial: new Set<string>()
}))

const state = vi.hoisted(() => ({ records: [] as Record<string, unknown>[] }))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  net: { isOnline: () => calls.online },
  BrowserWindow: { getAllWindows: () => [] }
}))
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
vi.mock('@main/services/masterBackup.store', () => ({
  readBackupSettings: () => Promise.resolve({ dailyTime: null })
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  writeScheduledRun: () => Promise.resolve()
}))
vi.mock('@main/services/schedulerPause.store', () => ({
  isPaused: () => Promise.resolve(false),
  writePaused: () => Promise.resolve(),
  // Never paused in this file, so there is never a reason.
  pauseReason: () => Promise.resolve(null),
  requestScheduleStop: vi.fn(),
  clearScheduleStop: vi.fn(),
  isScheduleStopRequested: () => false,
  automationsHalted: () => Promise.resolve(false),
  onStopRequested: () => () => undefined
}))
vi.mock('@main/services/cronHistory.store', async () => {
  const { cronHistoryMock } = await import('./helpers/cronHistoryMock')

  return cronHistoryMock()
})
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

    if (calls.failing.has(id)) return Promise.reject(new Error(`${id} exploded`))

    // Returned normally, but nothing in it worked — the case the old scheduler
    // called a success.
    if (calls.allFailed.has(id)) {
      return Promise.resolve({
        detail: 'all failed', total: 40, succeeded: 0, failed: 40, summary: [], rows: []
      })
    }

    // Three marketplace logins, two captured, one refused — exactly what
    // `refreshSessions` returns for that night.
    if (calls.partial.has(id)) {
      return Promise.resolve({
        detail: '2 updated, 1 failed', total: 3, succeeded: 2, failed: 1, summary: [], rows: []
      })
    }

    return Promise.resolve({
      detail: 'done', total: 1, succeeded: 1, failed: 0, summary: [], rows: []
    })
  }
}))

const {
  resumeSchedule,
  runTaskNow,
  scheduleState,
  skipBlockedRun,
  stopAutomationScheduler,
  taskHistory
} = await import('@main/services/automationScheduler.service')

// The monitor is what answers the scheduler's requests for a pass, so it has
// to be loaded for a launch, sign-in or switch-on to run anything.
await import('@main/services/monitor.service')

const history = (await import('@main/services/cronHistory.store')) as unknown as {
  __rows: CronExecution[]
  __reset: () => void
}

const { lastSuccessfulCompletion } = await import('@main/services/cronHistory.store')

/** Lets the chain unwind — each task is awaited before the next begins. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 60; turn += 1) await Promise.resolve()
}

const ranAtLeast = async (count: number): Promise<void> => {
  await vi.waitFor(() => expect(calls.ran.length).toBeGreaterThanOrEqual(count))
}

/** Interval schedules by default, so "due" is easy to control with lastRunAt. */
const record = (taskId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  taskId,
  enabled: true,
  cron: { kind: 'interval', everyMinutes: 60 },
  ...overrides
})

/**
 * Waits until the previous test's chain has actually stopped.
 *
 * NOT A FIXED NUMBER OF TURNS. A run is awaited before the next begins, and a
 * failing task now retries immediately — so a chain can still be unwinding
 * several turns after `stopAutomationScheduler`. Clearing the history while one
 * is mid-run leaves the next test looking at a run that started before its own
 * setup: its `recordStart` row wiped, its runner's push kept, and a history
 * that disagrees with what ran.
 */
const drain = async (): Promise<void> => {
  for (let round = 0; round < 20; round += 1) {
    const before = calls.ran.length

    await settle()

    if (calls.ran.length === before) return
  }
}

beforeEach(async () => {
  stopAutomationScheduler()
  await drain()
  history.__reset()
  calls.ran.length = 0
  calls.online = true
  calls.failing.clear()
  calls.allFailed.clear()
  calls.partial.clear()
  state.records = []
})

describe('TEST 1 — a machine with no history', () => {
  it('runs all four, one at a time, in registry order', async () => {
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(5)
    await settle()

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

  it('records a start and a completion for each', async () => {
    state.records = [record('session-refresh')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    const rows = history.__rows.filter(row => row.taskId === 'session-refresh')

    expect(rows).toHaveLength(1)
    expect(rows[0]?.startedAt).toBeTruthy()
    expect(rows[0]?.completedAt).toBeTruthy()
    expect(rows[0]?.status).toBe('completed')
  })
})

describe('TEST 2 — a task that fails is passed over', () => {
  it('passes over it and runs every task after it, in order, in the same pass', async () => {
    calls.failing.add('ajio-master-data')
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(6)
    await settle()

    // THE RULE NOW. The failure holds nothing up — and is tried once in this
    // pass, not looped on.
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

  it('records the failure, so the next check retries it', async () => {
    calls.failing.add('refill-data')
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(6)
    await settle()

    const result = await taskHistory({ taskId: 'refill-data' })

    if (!result.success) throw new Error('history unavailable')

    expect(result.data[0]?.status).toBe('failed')
    expect(calls.ran).toContain('auto-claim')
  })
})

describe('TEST 3 — the app crashed mid-run', () => {
  it('treats a start with no completion as a failure and blocks what follows', async () => {
    /*
     * A row still marked running in a FRESH PROCESS cannot be running: the app
     * holds the single-instance lock. Exact, rather than a timeout guess.
     */
    history.__rows.push({
      id: 'crashed',
      taskId: 'ajio-master-data',
      startedAt: new Date(Date.now() - HOUR).toISOString(),
      completedAt: null,
      status: 'running',
      detail: null,
      error: null,
      total: 0,
      succeeded: 0,
      failed: 0,
      occurrence: null,
      manual: false
    })

    state.records = [record('ajio-master-data'), record('auto-claim')]

    resumeSchedule()
    await settle()

    // Auto claim is after it, so it must not run while that row is unresolved.
    expect(calls.ran).not.toContain('auto-claim')
  })
})

describe('TEST 9 — a run where every item failed', () => {
  it('completes with errors and lets the queue carry on', async () => {
    /*
     * THE RULE, CORRECTED. A cron has COMPLETED when it got an answer for every
     * item — whatever those answers were. "All four logins said no" is four
     * answers, not a broken run.
     *
     * WHAT THE OLD RULE DID, in the field: three Myntra accounts answered
     * "auto-login is turned off in Monitor" (a setting) and one Snapdeal
     * account answered "OTP required" (a person). Nothing succeeded, so the run
     * was called FAILED — which blocked the AJIO sync, Refill Data and the
     * claims, and retried the whole task every sixty seconds, opening a real
     * browser on Snapdeal's login each time, for ever, to be told the same
     * thing. The cron had already done everything it could do.
     */
    calls.allFailed.add('ajio-master-data')
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(5)
    await settle()

    const result = await taskHistory({ taskId: 'ajio-master-data' })

    if (!result.success) throw new Error('history unavailable')

    expect(result.data[0]?.status).toBe('completed_with_errors')
    // The counts still say plainly that none of the work landed.
    expect(result.data[0]?.failed).toBe(40)
    expect(result.data[0]?.succeeded).toBe(0)

    // And the tasks behind it ran, which is the whole point.
    expect(calls.ran).toContain('refill-data')
    expect(calls.ran).toContain('auto-claim')
  })

  it('does not retry a task whose items merely failed', async () => {
    // It completed. Re-running it would ask the same accounts the same question
    // a minute later and get the same answer — which is what it used to do.
    calls.allFailed.add('session-refresh')
    state.records = [record('session-refresh')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran.filter(id => id === 'session-refresh')).toHaveLength(1)
  })

  it('still fails a run that could not complete at all — and the rest still run', async () => {
    // A thrown run never reached the end of its work: it is FAILED, and
    // retried. It no longer holds anything up.
    calls.failing.add('session-refresh')
    state.records = [record('session-refresh'), record('auto-claim')]

    resumeSchedule()
    await ranAtLeast(2)
    await settle()

    const result = await taskHistory({ taskId: 'session-refresh' })

    if (!result.success) throw new Error('history unavailable')

    expect(result.data[0]?.status).toBe('failed')
    expect(calls.ran).toContain('auto-claim')
  })
})

describe('TEST 6 — initialising twice', () => {
  it('starts one run, not two', async () => {
    state.records = [record('session-refresh')]

    resumeSchedule()
    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran.filter(id => id === 'session-refresh')).toHaveLength(1)
  })
})

describe('TEST 7 — Run now while something else is going', () => {
  it('is not refused because an earlier task failed', async () => {
    // Nothing waits on a failure, a Run now included.
    calls.failing.add('session-refresh')
    state.records = [record('session-refresh'), record('auto-claim')]

    resumeSchedule()
    await ranAtLeast(2)
    await settle()
    calls.ran.length = 0

    const result = await runTaskNow({ taskId: 'auto-claim' })

    expect(result.success).toBe(true)
    expect(calls.ran).toEqual(['auto-claim'])
  })
})

describe('TEST 8 — restarting after one task completed', () => {
  it('does not re-run the completed task, and runs the one that never has', async () => {
    /*
     * Asserted on the AJIO sync rather than the Login update, because the Login
     * update is the one deliberate exception — see the test below. Everything
     * else obeys the plain rule: a task that has run recently is not due, and a
     * restart is not a reason to run it again.
     */
    // All four, because a task with NO record is seeded with the shipped
    // schedule and would join the run — see `seedShippedSchedule`.
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() }),
      record('status-change', { lastRunAt: Date.now() }),
      record('auto-claim')
    ]

    // A machine with a record but no history rows: the upgrade case. The old
    // `lastRunAt` is read forward so an update does not fire everything at once.
    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran).not.toContain('ajio-master-data')
    expect(calls.ran).toContain('auto-claim')
  })

  it('re-checks the logins first anyway, which is the one exception', async () => {
    /*
     * THE EXCEPTION, kept from the existing scheduler because it exists for a
     * real failure: Session update ran at 18:54, the app was reopened at 19:35,
     * and the catch-up found the AJIO sync, the refill and the claims stale
     * while the sessions — forty-one minutes old — were not. Three jobs that
     * sign in then ran against sessions nobody had asked the marketplace about.
     *
     * A session is not fresh because a clock says so. So when anything else is
     * owed on a launch, the logins are re-checked first even though they are
     * not due — one probe per account when they are all fine.
     */
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() }),
      record('eligible-claims', { lastRunAt: Date.now() }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() }),
      record('status-change', { lastRunAt: Date.now() }),
      record('auto-claim')
    ]

    resumeSchedule()
    await ranAtLeast(2)
    await settle()

    expect(calls.ran).toEqual(['session-refresh', 'auto-claim'])
  })
})

describe('THE REAL CASE — one marketplace out of three fails to capture', () => {
  it('does NOT block the rest: two logins worked, so the run did its job', async () => {
    /*
     * THE QUESTION THIS ANSWERS, asked directly: three accounts — Myntra, AJIO,
     * Snapdeal — and only Snapdeal's session will not capture. Do the AJIO
     * sync, Refill Data and Auto claim still run?
     *
     * They must. Two of the three logins are live and there is a night of AJIO
     * and Myntra work those sessions can do. Blocking on this would mean one
     * stubborn marketplace stops every other marketplace's claims — which is
     * the failure mode `completed_with_errors` exists to prevent, and is why it
     * is a separate status from `failed` rather than a shade of it.
     *
     * A run where NOTHING captured is different, and is covered by TEST 9.
     */
    calls.partial.add('session-refresh')
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(5)
    await settle()

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

    const row = history.__rows.find(entry => entry.taskId === 'session-refresh')

    expect(row?.status).toBe('completed_with_errors')
    // Recorded, not hidden: the card says so and the history keeps the count.
    expect(row?.failed).toBe(1)
    expect(row?.succeeded).toBe(2)

    /*
     * AND IT COUNTS AS A COMPLETION, which is the half that matters to the
     * schedule rather than to the operator.
     *
     * `completedAt` is written, so an interval is measured from THIS moment and
     * a fixed-time slot is marked answered. The status is not a lesser kind of
     * success — it is a successful run with a note attached, and the note is
     * there so somebody can see that Snapdeal needs looking at without the
     * scheduler treating that as a reason to stop.
     */
    expect(row?.completedAt).toBeTruthy()

    const successAt = await lastSuccessfulCompletion('session-refresh')

    expect(successAt).toBe(Date.parse(row?.completedAt as string))
  })

  it('does not run again straight away — the interval starts from that completion', async () => {
    // The consequence of counting as a completion: it is not still owed.
    calls.partial.add('session-refresh')
    state.records = [record('session-refresh')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran.filter(id => id === 'session-refresh')).toHaveLength(1)
  })
})

describe('skipping a failure the operator cannot fix', () => {
  it('is not what lets the tasks behind it run — they already did', async () => {
    /*
     * Skip used to be the way out of a blocked queue. Nothing blocks now: the
     * tasks after a failure run in the same pass. Skip is still there, to stop
     * the failed task being retried until its next scheduled time.
     */
    calls.failing.add('session-refresh')
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(6)
    await settle()

    expect(calls.ran).toContain('auto-claim')

    const result = await skipBlockedRun({ taskId: 'session-refresh' })

    expect(result.success).toBe(true)
  })

  it('writes the decision into the history rather than hiding it', async () => {
    // "Never silently skip" — it is not silent, it is recorded with a reason.
    calls.failing.add('refill-data')
    state.records = [record('refill-data')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    await skipBlockedRun({ taskId: 'refill-data' })

    const row = history.__rows.find(entry => entry.taskId === 'refill-data')

    expect(row?.status).toBe('skipped')
    expect(row?.detail).toMatch(/operator/i)
  })

  it('refuses a task that has not failed', async () => {
    /*
     * The button only exists beside a failure, and this is the half of that
     * rule the server keeps. Skipping a healthy task would mark work as dealt
     * with that nobody has looked at.
     */
    state.records = [record('auto-claim')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    const result = await skipBlockedRun({ taskId: 'auto-claim' })

    expect(result.success).toBe(false)
  })

  it('does not make the task run again straight away', async () => {
    // Skipping answers this run. Leaving it due would simply start it a minute
    // later, which is the opposite of what was asked.
    calls.failing.add('refill-data')
    state.records = [record('refill-data')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    const before = calls.ran.filter(id => id === 'refill-data').length

    calls.failing.delete('refill-data')
    await skipBlockedRun({ taskId: 'refill-data' })
    await settle()

    expect(calls.ran.filter(id => id === 'refill-data')).toHaveLength(before)
  })
})

describe('the run history the dialog reads', () => {
  it('includes every task that has run', async () => {
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]

    resumeSchedule()
    await ranAtLeast(5)
    await settle()

    const result = await taskHistory({})

    expect(result.success).toBe(true)

    if (!result.success) return

    expect(result.data).toHaveLength(8)
    expect(new Set(result.data.map(row => row.taskId))).toEqual(
      new Set([
        'session-refresh',
        'eligible-claims',
        'ajio-master-data',
        'snapdeal-master-data',
        'flipkart-master-data',
        'refill-data',
        'auto-claim',
        'status-change'
      ])
    )
  })

  it('orders them newest first', async () => {
    /*
     * Seeded with distinct times rather than run, because four mock runs land
     * inside the same millisecond and their order is then genuinely
     * undecidable — a test that asserted one would be pinning the sort's
     * stability, not its rule.
     */
    const at = (minutesAgo: number): string =>
      new Date(Date.now() - minutesAgo * 60_000).toISOString()

    history.__rows.push(
      {
        id: 'old', taskId: 'session-refresh', startedAt: at(30), completedAt: at(29),
        status: 'completed', detail: null, error: null, total: 0, succeeded: 0, failed: 0,
        occurrence: null, manual: false
      },
      {
        id: 'new', taskId: 'auto-claim', startedAt: at(5), completedAt: at(4),
        status: 'completed', detail: null, error: null, total: 0, succeeded: 0, failed: 0,
        occurrence: null, manual: false
      }
    )

    const result = await taskHistory({})

    if (!result.success) throw new Error('history unavailable')

    expect(result.data.map(row => row.id)).toEqual(['new', 'old'])
  })

  it('breaks a tie on the start time with the completion', async () => {
    /*
     * Tasks run back to back and four can START inside one millisecond on an
     * idle machine. They FINISH in the order they ran, so a tie is settled by
     * when each ended — otherwise the order falls back to whatever the arrays
     * were in, which is registry order: the oldest-looking first, exactly
     * backwards.
     */
    const started = new Date(Date.now() - 10 * 60_000).toISOString()
    const ended = (minutesAgo: number): string =>
      new Date(Date.now() - minutesAgo * 60_000).toISOString()

    history.__rows.push(
      {
        id: 'finished-first', taskId: 'session-refresh', startedAt: started,
        completedAt: ended(9), status: 'completed', detail: null, error: null,
        total: 0, succeeded: 0, failed: 0, occurrence: null, manual: false
      },
      {
        id: 'finished-last', taskId: 'auto-claim', startedAt: started,
        completedAt: ended(2), status: 'completed', detail: null, error: null,
        total: 0, succeeded: 0, failed: 0, occurrence: null, manual: false
      }
    )

    const result = await taskHistory({})

    if (!result.success) throw new Error('history unavailable')

    expect(result.data.map(row => row.id)).toEqual(['finished-last', 'finished-first'])
  })

  it('returns one task on its own when it is named', async () => {
    state.records = [record('session-refresh'), record('auto-claim')]

    resumeSchedule()
    await ranAtLeast(2)
    await settle()

    const result = await taskHistory({ taskId: 'auto-claim' })

    expect(result.success).toBe(true)

    if (!result.success) return

    expect(result.data.every(row => row.taskId === 'auto-claim')).toBe(true)
  })

  it('refuses a task it does not know', async () => {
    // A named-but-wrong id is a bug in the caller, not a request for everything.
    expect((await taskHistory({ taskId: 'nope' })).success).toBe(false)
  })

  it('carries what the table shows — times, counts and the reason', async () => {
    calls.partial.add('session-refresh')
    state.records = [record('session-refresh')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    const result = await taskHistory({})

    if (!result.success) throw new Error('history unavailable')

    // By task rather than by position: other tasks are seeded and run too, and
    // which of them is newest is not what this is about.
    const row = result.data.find(entry => entry.taskId === 'session-refresh')

    expect(row?.startedAt).toBeTruthy()
    expect(row?.completedAt).toBeTruthy()
    expect(row?.status).toBe('completed_with_errors')
    expect(row?.succeeded).toBe(2)
    expect(row?.total).toBe(3)
    expect(row?.detail).toBe('2 updated, 1 failed')
  })
})

describe('an app restart is not a marketplace failure', () => {
  const killed = (id: string, minutesAgo: number): CronExecution => ({
    id,
    taskId: 'session-refresh',
    startedAt: new Date(Date.now() - (minutesAgo + 5) * 60_000).toISOString(),
    completedAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    status: 'failed',
    detail: null,
    error: 'The app stopped while this was running, so it never finished.',
    total: 0,
    succeeded: 0,
    failed: 0,
    occurrence: null,
    manual: false,
    interrupted: true
  })

  it('does not count an interrupted run as a failure', async () => {
    /*
     * SEEN IN THE FIELD. Three Login update rows, all "Failed" — but two said
     * "The app stopped while this was running". They were restarts during
     * development, not the marketplace refusing anything, and counting them
     * reported a task that had failed three times when it had failed once.
     *
     * The count is what the card shows to say a task needs a person rather
     * than more patience, so inflating it with quits makes it say the wrong
     * thing.
     */
    history.__rows.push(
      {
        id: 'real',
        taskId: 'session-refresh',
        startedAt: new Date(Date.now() - 4 * 60_000).toISOString(),
        completedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
        status: 'failed',
        detail: '4 failed, 2 timed out',
        error: '4 failed, 2 timed out',
        total: 6,
        succeeded: 0,
        failed: 6,
        occurrence: null,
        manual: false
      },
      killed('killed-1', 10),
      killed('killed-2', 30)
    )

    state.records = [record('session-refresh')]

    const result = await scheduleState()

    if (!result.success) throw new Error('state unavailable')

    const task = result.data.tasks.find(entry => entry.id === 'session-refresh')

    // One real failure, not three.
    expect(task?.consecutiveFailures).toBe(1)
  })

  it('runs the tasks after an incomplete run, as after any failure', async () => {
    // Incomplete is owed a re-run — and holds nothing up while it gets one.
    history.__rows.push(killed('killed', 1))

    calls.failing.add('session-refresh')
    state.records = [record('session-refresh'), record('auto-claim')]

    resumeSchedule()
    await ranAtLeast(2)
    await settle()

    expect(calls.ran).toContain('auto-claim')
  })
})

describe('a failed task keeps trying', () => {
  it('retries on the very next check rather than waiting out a backoff', async () => {
    /*
     * THE CHANGE THIS PINS. A failed task used to wait 1 → 5 → 15 → 60 minutes
     * before trying again — and because a failure BLOCKS, that wait was every
     * task behind it standing still too. Now it is due again at once, and the
     * tick's own minute is the only spacing.
     */
    calls.failing.add('session-refresh')
    state.records = [record('session-refresh')]

    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    // Failed a moment ago, and eligible again right away.
    const result = await taskHistory({ taskId: 'session-refresh' })

    if (!result.success) throw new Error('history unavailable')

    expect(result.data[0]?.status).toBe('failed')

    calls.failing.delete('session-refresh')
    calls.ran.length = 0

    // The next check runs it again — no wait in between.
    resumeSchedule()
    await ranAtLeast(1)
    await settle()

    expect(calls.ran).toContain('session-refresh')
  })
})
