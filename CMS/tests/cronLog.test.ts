import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The scheduler's activity log, and the one decision in it.
 *
 * THE RULE: in memory always, on disk only in developer mode. The log has to
 * work on an ordinary machine, because the question it answers — "what is it
 * doing right now" — is asked while the app is open. Writing every decision to
 * disk for every user, on something that ticks once a minute, would produce a
 * file nobody reads.
 *
 * Both halves are worth pinning because getting either backwards is silent: a
 * log that persists when it should not costs disk for ever, and one that does
 * not persist when it should loses exactly the night somebody wanted to read.
 */

const state = vi.hoisted(() => ({
  devMode: false,
  /** Whatever the collection has been asked to hold. */
  stored: [] as Record<string, unknown>[],
  broadcasts: [] as { channel: string; payload: unknown }[]
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/trackvid-test' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => state.broadcasts.push({ channel, payload })
}))
vi.mock('@main/services/preferences.service', () => ({
  getPreferences: () => ({ devMode: state.devMode })
}))
vi.mock('@main/database', () => ({ dataDirectory: () => '/tmp/trackvid-test/data' }))
vi.mock('@main/database/jsonStore', () => ({
  JsonCollection: class {
    read(): Promise<Record<string, unknown>[]> {
      return Promise.resolve(state.stored)
    }

    mutate(
      fn: (records: Record<string, unknown>[]) => { records: Record<string, unknown>[] }
    ): Promise<void> {
      state.stored = fn(state.stored).records

      return Promise.resolve()
    }

    clear(): Promise<void> {
      state.stored = []

      return Promise.resolve()
    }
  }
}))

const { cronLog, initialiseCronLog, readCronLog, clearCronLog } = await import(
  '@main/services/cronLog.store'
)

/** The store writes to disk without awaiting, so let the microtasks drain. */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve()
}

beforeEach(async () => {
  state.devMode = false
  state.stored = []
  state.broadcasts.length = 0
  initialiseCronLog()
  await clearCronLog()
})

describe('what the log keeps', () => {
  it('holds lines in memory even with developer mode off', async () => {
    // The common case: nothing switched on, and the modal still has to show
    // what is happening right now.
    cronLog('start', 'Login update', 'Started')

    expect(await readCronLog()).toHaveLength(1)
  })

  it('does NOT write them to disk with developer mode off', async () => {
    cronLog('start', 'Login update', 'Started')
    await settle()

    expect(state.stored).toHaveLength(0)
  })

  it('writes them to disk in developer mode', async () => {
    // So yesterday's run can be read back after a restart, which is the case
    // developer mode is turned on for.
    state.devMode = true
    cronLog('failure', 'Refill Data', 'Failed', { detail: 'the portal refused' })
    await settle()

    expect(state.stored).toHaveLength(1)
    expect(state.stored[0]).toMatchObject({
      label: 'Refill Data',
      level: 'failure',
      detail: 'the portal refused'
    })
  })
})

describe('reading it back', () => {
  it('returns newest first', async () => {
    cronLog('info', 'Schedule', 'first')
    cronLog('info', 'Schedule', 'second')

    const entries = await readCronLog()

    expect(entries[0]?.message).toBe('second')
    expect(entries[1]?.message).toBe('first')
  })

  it('does not show a line twice when it is both on disk and in memory', async () => {
    /*
     * In developer mode a line is written to both, and the read merges them.
     * Without de-duplication by id every line of the current session would
     * appear twice — which reads as the scheduler having done everything twice.
     */
    state.devMode = true
    cronLog('info', 'Schedule', 'armed')
    await settle()

    expect(await readCronLog()).toHaveLength(1)
  })

  it('pushes each line as it is written', () => {
    // The log exists to be watched: a run starts with nobody looking, and a
    // list that only filled in on reopen would miss what it was opened for.
    cronLog('start', 'Auto claim', 'Started')

    expect(state.broadcasts).toHaveLength(1)
    expect(state.broadcasts[0]?.channel).toBe('automation-schedule:log-entry')
  })
})

describe('what a line carries', () => {
  it('keeps the reason separate from the headline', async () => {
    // So the list stays scannable and still carries the thing somebody needs.
    cronLog('blocked', 'Auto claim', 'Blocked', {
      taskId: 'auto-claim',
      detail: 'Refill Data must complete before this can run'
    })

    const [entry] = await readCronLog()

    expect(entry?.message).toBe('Blocked')
    expect(entry?.detail).toBe('Refill Data must complete before this can run')
    expect(entry?.taskId).toBe('auto-claim')
  })

  it('allows a line about the scheduler itself, with no task', async () => {
    cronLog('info', 'Schedule', 'Armed — checking every minute')

    expect((await readCronLog())[0]?.taskId).toBeNull()
  })
})
