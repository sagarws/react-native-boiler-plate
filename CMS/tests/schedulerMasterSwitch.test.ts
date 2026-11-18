import type { CronExecution } from '@shared/types/automationSchedule'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The master switch: stop every scheduled automation, or start them again.
 *
 * WHAT IT IS FOR. The four task switches are a configuration — which
 * automations this machine does at all. This is "not now": a marketplace is
 * throwing errors, or somebody needs the machine, and everything should stop
 * without losing which four switches were on.
 *
 * THE THREE THINGS PINNED HERE, because each is a way the switch could lie:
 *   - off stops the queue IMMEDIATELY, part-way through a sequential run;
 *   - off survives a restart, so a machine switched off at midnight is still
 *     off at nine;
 *   - on runs only what is OVERDUE, so flipping the switch does not open a
 *     browser and re-file claims that were filed twenty minutes ago.
 */

/** How many logins the Login update is leaving unfixed. */
const sessions = vi.hoisted(() => ({ outstanding: 0, pauseEnabled: true }))

const calls = vi.hoisted(() => ({
  ran: [] as string[],
  /** What `shouldStop` answered inside a task the test held open. */
  stopAsked: [] as boolean[],
  /** What the scheduler passed the adapter — the stop predicate. */
  args: [] as unknown[],
  online: true
}))
/**
 * The pause flag, plus a switch the fake task runner reads.
 *
 * `pauseDuringFirstTask` is how the "switched off mid-run" case is staged:
 * the first task flips the flag while it is running, which is exactly what an
 * operator pressing the switch at 02:14 does.
 */
const paused = vi.hoisted(() => {
  /** A task the test holds open, so a Skip can reach it while it runs. */
  let release: () => void = () => undefined
  const held = new Promise<void>(resolve => {
    release = resolve
  })

  return {
    value: false,
    /** Who stopped it — null while it is running. */
    reason: null as string | null,
    detail: '',
    /** The live "stop as soon as you safely can" signal, as the real store keeps it. */
    stopRequested: false,
    pauseDuringFirstTask: false,
    holdTask: null as string | null,
    held,
    release: (): void => release(),
    /**
     * A gate that can be armed again for every test — `held` above resolves
     * once and stays resolved. The task named here waits on it.
     */
    gateTask: null as string | null,
    gate: null as Promise<void> | null,
    openGate: (): void => undefined
  }
})

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
  writeTaskRecord: (taskId: string, patch: Partial<Record_>) => {
    const existing = state.records.find(record => record.taskId === taskId)

    if (existing) Object.assign(existing, patch)
    else state.records.push({ taskId, enabled: true, cron: null, ...patch })

    return Promise.resolve()
  }
}))
/** The flag the switch writes, standing in for the file on disk. */
const stopListeners = vi.hoisted(() => new Set<() => void>())

vi.mock('@main/services/schedulerPause.store', () => ({
  isPaused: () => Promise.resolve(paused.value),
  writePaused: (next: boolean, reason = 'operator', detail = '') => {
    paused.value = next
    paused.reason = next ? reason : null
    paused.detail = next ? detail : ''

    return Promise.resolve()
  },
  // Who stopped it: the operator's own switch stays off, the app's own pause
  // lifts itself. The scheduler reads this to tell them apart.
  pauseReason: () =>
    Promise.resolve(paused.value ? { reason: paused.reason ?? 'operator', detail: paused.detail } : null),
  // The live signal, which is what a task already running reads.
  requestScheduleStop: () => {
    paused.stopRequested = true
    for (const listener of [...stopListeners]) listener()
  },
  clearScheduleStop: () => {
    paused.stopRequested = false
  },
  isScheduleStopRequested: () => paused.stopRequested,
  automationsHalted: () => Promise.resolve(paused.stopRequested || paused.value),
  onStopRequested: (listener: () => void) => {
    if (paused.stopRequested) {
      listener()

      return () => undefined
    }

    stopListeners.add(listener)

    return () => stopListeners.delete(listener)
  }
}))
vi.mock('@main/services/scheduledRunArchive.store', () => ({
  writeScheduledRun: () => Promise.resolve()
}))
vi.mock('@main/services/masterBackup.service', () => ({
  readBackupSettings: () => Promise.resolve({ dailyTime: null })
}))
vi.mock('@main/services/automationTasks', () => ({
  /** The core flag, which decides whether the app may pause itself at all. */
  sessionPauseEnabled: () => sessions.pauseEnabled,
  /*
   * What the Login update leaves behind, which is what decides the hold.
   * Deliberately NOT derived from the fake run above: the real one is read
   * from session health after the run, and a capture can succeed while the
   * marketplace still refuses the session it produced.
   */
  outstandingSessions: () =>
    Promise.resolve(
      sessions.outstanding === 0
        ? { count: 0, detail: '' }
        : { count: sessions.outstanding, detail: `${sessions.outstanding} logins still need re-capturing (ajio)` }
    ),
  taskRunner: (id: string) => async (shouldStop?: () => boolean) => {
    calls.ran.push(id)
    calls.args = [shouldStop]

    /*
     * HELD OPEN, for the skip case. A task that returns immediately can never
     * be skipped — the operator's press lands after it has finished — so this
     * one waits on a promise the test resolves, and reports what `shouldStop`
     * said while it was waiting. That answer IS the behaviour: a skip reaches
     * the task in flight.
     */
    if (paused.holdTask === id) {
      await paused.held
      calls.stopAsked.push(shouldStop?.() === true)
    }

    if (paused.gateTask === id && paused.gate) {
      await paused.gate
      calls.stopAsked.push(shouldStop?.() === true)
    }

    // Switching off DURING the first task is the case that matters: the queue
    // must stop, and the task in flight must be allowed to finish.
    if (id === 'session-refresh' && paused.pauseDuringFirstTask) paused.value = true

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

const {
  resumeSchedule,
  runTaskNow,
  setSchedulePaused,
  skipRunningTask,
  startAutomationScheduler,
  stopAutomationScheduler,
  scheduleState,
  releaseSessionPause: resumeOnSessions
} = await import('@main/services/automationScheduler.service')

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

const settle = async (): Promise<void> => {
  for (let i = 0; i < 60; i += 1) await Promise.resolve()
}

const ranAtLeast = async (count: number): Promise<void> => {
  await vi.waitFor(() => expect(calls.ran.length).toBeGreaterThanOrEqual(count))
}

const cronHistory = (await import('@main/services/cronHistory.store')) as unknown as {
  __reset: () => void
  __rows: CronExecution[]
}

beforeEach(async () => {
  // The history mock is module-scoped, so last test's rows would read as runs
  // that have already happened today.
  cronHistory.__reset()
  stopAutomationScheduler()
  await settle()
  calls.ran.length = 0
  calls.args.length = 0
  calls.online = true
  paused.value = false
  paused.reason = null
  paused.detail = ''
  sessions.outstanding = 0
  sessions.pauseEnabled = true
  paused.pauseDuringFirstTask = false
  paused.stopRequested = false
  paused.gateTask = null
  paused.gate = null
  calls.stopAsked.length = 0
  state.records = []
})

/** Holds `taskId` open until `paused.openGate()`. */
const gateOn = (taskId: string): void => {
  // The single-use hold above is spent by an earlier test; clear it so it
  // cannot answer for this one.
  paused.holdTask = null
  paused.gateTask = taskId
  paused.gate = new Promise<void>(resolve => {
    paused.openGate = resolve
  })
}

describe('switching the schedule off', () => {
  it('records the decision so a restart does not undo it', async () => {
    const result = await setSchedulePaused({ paused: true })

    expect(result.success).toBe(true)
    expect(paused.value).toBe(true)
  })

  it('stops a sign-in from catching anything up', async () => {
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * HOUR })
    ]
    await setSchedulePaused({ paused: true })

    resumeSchedule()
    await settle()

    // Signing in is not a decision to start everything again — the operator
    // who switched it off has to switch it back on.
    expect(calls.ran).toEqual([])
  })

  it('does not arm the tick on launch', async () => {
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR })]
    await setSchedulePaused({ paused: true })

    startAutomationScheduler()
    await settle()

    expect(calls.ran).toEqual([])
  })

  it('stops the queue part-way, leaving the task in flight to finish', async () => {
    state.records = [
      record('eligible-claims', { lastRunAt: Date.now() }),
      record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR }),
      record('ajio-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('snapdeal-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('flipkart-master-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 5 * HOUR }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * HOUR })
    ]
    paused.pauseDuringFirstTask = true

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    // The first task ran to completion; nothing after it started.
    expect(calls.ran).toEqual(['session-refresh'])
  })

  it('reports the switch as off in the state the rail reads', async () => {
    await setSchedulePaused({ paused: true })

    const result = await scheduleState()

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.paused).toBe(true)
      // Nothing is running, so it is stopped rather than stopping.
      expect(result.data.stopping).toBe(false)
    }
  })

  it('refuses a payload that does not say which way', async () => {
    const result = await setSchedulePaused({})

    expect(result.success).toBe(false)
  })
})

describe('switching it back on', () => {
  it('runs the night\'s work from the top, in dependency order, one at a time', async () => {
    /*
     * ON MEANS "DO IT NOW".
     *
     * This used to run only what was OVERDUE, which on a machine where
     * everything ran an hour ago means nothing happens: the log said
     * `switched ON — re-arming and catching up` and then went quiet, and the
     * operator who had just decided the machine should be working had no
     * reason to believe it had. So every enabled task runs, including the one
     * that ran twenty minutes ago.
     *
     * The ORDER is the thing that must not change: the Login update first,
     * because everything behind it signs in with what it captures.
     */
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 5 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 5 * HOUR }),
      record('auto-claim', { lastRunAt: Date.now() - 5 * HOUR }),
      // Not overdue — and now run anyway, because the switch asked for it.
      record('ajio-master-data', { lastRunAt: Date.now() - 20 * 60 * 1000 }),
      record('snapdeal-master-data', { lastRunAt: Date.now() - 20 * 60 * 1000 }),
      record('flipkart-master-data', { lastRunAt: Date.now() - 20 * 60 * 1000 })
    ]
    paused.value = true

    await setSchedulePaused({ paused: false })
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

  it('runs each forced task once, not every tick', async () => {
    // `forced` makes a task due. Left set, it would make it due for ever — a
    // task running every minute until somebody noticed.
    state.records = [record('session-refresh', { lastRunAt: Date.now() })]
    paused.value = true

    await setSchedulePaused({ paused: false })
    await ranAtLeast(1)
    await settle()
    await settle()

    expect(calls.ran.filter(id => id === 'session-refresh')).toHaveLength(1)
  })

  it('leaves a task the operator switched off alone', async () => {
    // Every task needs a record: one with none gets the shipped default, which
    // has never run here and is therefore the most overdue thing on the machine.
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR }),
      record('ajio-master-data', { lastRunAt: Date.now() }),
      record('snapdeal-master-data', { lastRunAt: Date.now() }),
      record('flipkart-master-data', { lastRunAt: Date.now() }),
      record('refill-data', { lastRunAt: Date.now() }),
      record('status-change', { lastRunAt: Date.now() }),
      record('auto-claim', { enabled: false, lastRunAt: Date.now() - 5 * HOUR })
    ]
    paused.value = true

    await setSchedulePaused({ paused: false })
    await ranAtLeast(1)
    await settle()

    /*
     * THE HALF THAT MUST NOT CHANGE. Switching the schedule on runs every
     * ENABLED task now — but a task the operator turned off in Settings is a
     * different decision, and the master switch must never quietly overrule
     * it. `auto-claim` is off here and stays off.
     */
    expect(calls.ran).toEqual([
      'session-refresh',
      'eligible-claims',
      'ajio-master-data',
      'snapdeal-master-data',
      'flipkart-master-data',
      'refill-data',
      'status-change'
    ])
    expect(calls.ran).not.toContain('auto-claim')
  })
})

describe('stopping a task that is already running', () => {
  /**
   * THE BUG THIS PINS. "Session update" is ONE task that signs in to every
   * stale account in a loop. The first version of the switch only checked
   * between TASKS, so switching off during that loop stopped nothing for
   * minutes: the rail said "Stopping…" while the run carried on through all
   * seven logins. The signal has to be readable from INSIDE a task, at its own
   * safe boundary.
   */
  it('raises the live signal the moment the switch goes off', async () => {
    // This is the one that was missing. The persisted flag is read between
    // tasks; THIS is what a task already part-way through its own loop reads,
    // and without it "Stopping…" was a label over a run that kept going.
    expect(paused.stopRequested).toBe(false)

    await setSchedulePaused({ paused: true })

    expect(paused.stopRequested).toBe(true)
  })

  it('clears it again when the switch goes back on', async () => {
    await setSchedulePaused({ paused: true })
    await setSchedulePaused({ paused: false })

    // Otherwise the next run would stop before its first item, on a flag left
    // over from the night before.
    expect(paused.stopRequested).toBe(false)
  })

  it('hands a scheduled run a predicate that follows the switch', async () => {
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR })]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    // The adapter is called WITH a predicate, and for a scheduled run that
    // predicate is the live signal — not a constant. A manual Run now gets
    // `() => false` instead; see sessionUpdateStop for that half.
    const [predicate] = calls.args
    expect(typeof predicate).toBe('function')

    paused.stopRequested = true
    expect((predicate as () => boolean)()).toBe(true)
  })
})

describe('skipping the task that is running', () => {
  /**
   * A DIFFERENT QUESTION FROM THE MASTER SWITCH, and the reason it exists: a
   * task grinding through a marketplace that is refusing everything holds up
   * the three behind it, and the only ways out were to wait or to switch the
   * whole schedule off — which also stops the tasks that were fine.
   *
   * It is a REQUEST, not a kill: the flag is read between the units a task
   * loops over, so the step in hand finishes and the queue then moves on.
   */
  it('reaches the task in flight', async () => {
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR })]
    paused.holdTask = 'session-refresh'

    startAutomationScheduler()
    await ranAtLeast(1)

    const result = await skipRunningTask({ taskId: 'session-refresh' })

    expect(result.success).toBe(true)

    paused.release()
    await settle()

    // What the task was told when it next asked.
    expect(calls.stopAsked).toEqual([true])
  })

  it('refuses a task that is not running', async () => {
    // Nothing to cut short. Saying so beats setting a flag that would silently
    // cut the NEXT run short instead.
    const result = await skipRunningTask({ taskId: 'auto-claim' })

    expect(result.success).toBe(false)
  })

  it('refuses a task it does not know', async () => {
    expect((await skipRunningTask({ taskId: 'not-a-task' })).success).toBe(false)
    expect((await skipRunningTask({})).success).toBe(false)
  })
})


/**
 * THE APP'S OWN PAUSE: a Login update that cannot fix the logins stops
 * everything below it.
 *
 * WHY IT EXISTS. Every task after the Login update signs in with what it
 * re-captures. Running them against logins the marketplace refuses does not
 * fail cheaply — it is a night of opening browsers, each claim burning an
 * attempt on a dead session, every row ending Failed for a reason that has
 * nothing to do with the claim.
 *
 * THE FOUR THINGS PINNED HERE, because each is a way this could go wrong in
 * the dark:
 *   - a run that leaves logins outstanding stops the schedule AND says why;
 *   - once paused, NOTHING runs — the Login update and Run now included;
 *   - a capture on the Login page lifts the pause with nobody touching the
 *     switch;
 *   - an OPERATOR'S off is never undone by logins coming good.
 */
describe('pausing because the logins could not be re-captured', () => {
  it('stops the schedule, and records what is wrong', async () => {
    sessions.outstanding = 2
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR })]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    const state_ = await scheduleState()

    expect(state_.success).toBe(true)
    if (!state_.success) return

    expect(state_.data.paused).toBe(true)
    expect(state_.data.pausedBy).toBe('sessions')
    // The sidebar shows this verbatim, so it has to name the problem rather
    // than say "an error occurred".
    expect(state_.data.pausedDetail).toContain('still need re-capturing')
  })

  it('runs nothing after the Login update that paused it', async () => {
    sessions.outstanding = 1
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 2 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 2 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()
    await settle()

    // The Login update ran and found the logins refused; nothing that would
    // sign in with them ran after it.
    expect(calls.ran).toContain('session-refresh')
    expect(calls.ran).not.toContain('refill-data')
  })

  it('stays off — Run now of the Login update included — until a capture lifts it', async () => {
    sessions.outstanding = 1
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR })]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()
    expect(paused.value).toBe(true)

    // Off means nothing runs: the Login update is not exempt any more, not even
    // pressed by hand.
    const before = calls.ran.length
    const refused = await runTaskNow({ taskId: 'session-refresh' })

    expect(refused.success).toBe(false)
    expect(calls.ran.length).toBe(before)

    // The way out: the logins are captured on the Login page, and that capture
    // lifts the app's own pause.
    sessions.outstanding = 0
    await resumeOnSessions(0)

    expect(paused.value).toBe(false)
    expect(paused.reason).toBe(null)
  })

  it('leaves an operator\'s own switch alone when the logins come good', async () => {
    // Somebody switched it off deliberately. Logins being fine is not a reason
    // to undo that — this is the half of the feature that makes an automatic
    // pause safe to have at all.
    await setSchedulePaused({ paused: true })
    expect(paused.reason).toBe('operator')

    sessions.outstanding = 0
    await resumeOnSessions(0)

    expect(paused.value).toBe(true)
    expect(paused.reason).toBe('operator')
  })
})

/**
 * THE FLAG THAT TURNS THE WHOLE THING OFF:
 * `AUTOMATION_PAUSE_ON_SESSION_FAIL` in the core's constants.
 *
 * Some machines would rather the other marketplaces kept working than have
 * the schedule held for the one that is permanently unhappy. Off means off:
 * no pause, and no hold left behind from when it was on.
 */
describe('when the core flag says not to pause on a failed re-capture', () => {
  it('leaves the automations running, however many logins are refused', async () => {
    sessions.pauseEnabled = false
    sessions.outstanding = 4
    state.records = [
      record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 2 * HOUR }),
      record('status-change', { lastRunAt: Date.now() - 2 * HOUR })
    ]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()
    await settle()

    expect(paused.value).toBe(false)
    // And the work below the Login update goes ahead, which is the point of
    // switching the flag off.
    expect(calls.ran).toContain('refill-data')
  })

  it('lifts a hold that was set while the flag was on', async () => {
    // Paused last night, flag switched off this morning. Without this the
    // schedule would stay off for a rule that no longer applies.
    sessions.pauseEnabled = true
    sessions.outstanding = 2
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR })]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()
    expect(paused.value).toBe(true)

    sessions.pauseEnabled = false
    stopAutomationScheduler()
    await settle()
    startAutomationScheduler()
    await settle()

    expect(paused.value).toBe(false)
  })
})

describe('switching off while a task is running', () => {
  it('abandons it at once, leaving its history row with no completion time', async () => {
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR })]
    gateOn('session-refresh')

    startAutomationScheduler()
    await ranAtLeast(1)

    await setSchedulePaused({ paused: true })
    await settle()

    // Off straight away — not "stopping" while the task finishes.
    const state_ = await scheduleState()

    expect(state_.success && state_.data.stopping).toBe(false)
    expect(state_.success && state_.data.tasks.find(task => task.id === 'session-refresh')?.running).toBe(false)

    const row = cronHistory.__rows.find(entry => entry.taskId === 'session-refresh')

    expect(row?.completedAt).toBe(null)
    expect(row?.interrupted).toBe(true)

    // The runner was told to stop at its next step, and when it does finish
    // nothing writes a completion for the abandoned run.
    paused.openGate()
    await settle()

    expect(calls.stopAsked).toEqual([true])
    expect(cronHistory.__rows.find(entry => entry.taskId === 'session-refresh')?.completedAt).toBe(null)
  })

  it('runs the incomplete task again, first, when switched back on', async () => {
    state.records = [
      record('eligible-claims', { lastRunAt: Date.now() }),
      record('session-refresh', { lastRunAt: Date.now() - 5 * HOUR }),
      record('refill-data', { lastRunAt: Date.now() - 5 * HOUR })
    ]
    gateOn('session-refresh')

    startAutomationScheduler()
    await ranAtLeast(1)
    await setSchedulePaused({ paused: true })
    paused.openGate()
    await settle()

    paused.gateTask = null
    calls.ran.length = 0

    await setSchedulePaused({ paused: false })
    await ranAtLeast(2)
    await settle()

    // The abandoned Login update before everything after it. Only Proceed
    // eligible claims, which is ahead of it in the order, may run first.
    expect(calls.ran.filter(id => id !== 'eligible-claims')[0]).toBe('session-refresh')
    expect(calls.ran).toContain('refill-data')

    // Its own row stays incomplete; the re-run wrote a new, completed one.
    const rows = cronHistory.__rows.filter(entry => entry.taskId === 'session-refresh')

    expect(rows.some(entry => entry.completedAt === null && entry.interrupted === true)).toBe(true)
    expect(rows[0]?.completedAt).not.toBe(null)
  })
})

describe('the two kinds of automation, as the history records them', () => {
  it('marks the runs the toggle started as toggle-on, and scheduled runs as schedule', async () => {
    // Switched off, then on: every enabled task runs because of the toggle.
    state.records = [record('session-refresh'), record('refill-data')]
    await setSchedulePaused({ paused: true })
    await setSchedulePaused({ paused: false })
    await ranAtLeast(2)
    await settle()

    const triggers = cronHistory.__rows
      .filter(entry => entry.taskId === 'session-refresh' || entry.taskId === 'refill-data')
      .map(entry => entry.trigger)

    expect(triggers).toEqual(['toggle-on', 'toggle-on'])

    // Later, the Login update comes due on its own schedule.
    cronHistory.__reset()
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR })]
    stopAutomationScheduler()
    await settle()
    calls.ran.length = 0
    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    expect(cronHistory.__rows[0]?.trigger).toBe('schedule')
  })
})

describe('switching on by hand runs every task, whatever the logins say', () => {
  it('does not stop after the Login update when logins are still refused', async () => {
    // YOUR MORNING: two logins refused, the app had paused itself, and the
    // operator switches Automations on. Every task must run.
    sessions.outstanding = 2
    state.records = [
      record('session-refresh'),
      record('ajio-master-data'),
      record('snapdeal-master-data'),
      record('flipkart-master-data'),
      record('refill-data'),
      record('auto-claim'),
      record('status-change')
    ]
    await setSchedulePaused({ paused: true })
    await setSchedulePaused({ paused: false })
    await ranAtLeast(6)
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
    expect(paused.value).toBe(false)
  })

  it('still pauses on a SCHEDULED Login update that leaves logins refused', async () => {
    sessions.outstanding = 2
    state.records = [record('session-refresh', { lastRunAt: Date.now() - 2 * HOUR })]

    startAutomationScheduler()
    await ranAtLeast(1)
    await settle()

    expect(paused.value).toBe(true)
    expect(paused.reason).toBe('sessions')
  })
})

