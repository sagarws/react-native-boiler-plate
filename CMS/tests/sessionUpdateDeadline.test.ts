import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskOutcome } from '@shared/types/automationSchedule'

/**
 * One slow sign-in must not become the whole run.
 *
 * Observed 2026-09-19 at 11:42: a scheduled Session update with three expired
 * logins to fix spent seventy-two seconds on Xbees, which ended
 * "LOGIN_TIMEOUT: token endpoint never fired" — and for all seventy-two
 * seconds the other two accounts, which were fine, were waiting behind it.
 *
 * So each account gets a minute and the run moves on. What is pinned here is
 * that moving on actually happens, that the account which timed out is
 * REPORTED rather than silently dropped, and that the accounts behind it are
 * still attempted.
 */

const state = vi.hoisted(() => ({
  /** How long each username's capture takes, in ms. */
  duration: new Map<string, number>(),
  attempted: [] as string[],
  /** What the screen was told: a username when claimed, '-' when released. */
  announced: [] as string[],
  now: 0
}))

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test', getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
  session: { fromPartition: () => ({}) },
  dialog: {},
  net: { isOnline: () => true },
  safeStorage: { isEncryptionAvailable: () => false }
}))
// The refill pass broadcasts its shape as it runs.
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({ platformKey: (value: string) => String(value).toLowerCase() })
}))
vi.mock('@main/services/cmsList.service', () => ({ listCms: vi.fn() }))
vi.mock('@main/services/pendingClaims.service', () => ({
  claimsAwaitingStatus: () => Promise.resolve({ rows: [], upToDate: new Map() }),
  pendingClaims: vi.fn(),
  splitFileable: vi.fn()
}))
vi.mock('@main/services/claimProcessor.service', () => ({ processClaims: vi.fn() }))
vi.mock('@main/services/masterBackup.service', () => ({ runDailyBackup: vi.fn() }))
vi.mock('@main/services/refill.service', () => ({ runRefill: vi.fn() }))

/** Three accounts, all stale, all signable unattended. */
const TARGETS = ['ok-before', 'hangs', 'ok-after'].map(username => ({
  platform: 'xbees',
  label: 'Xbees',
  username,
  credentialId: `id-${username}`,
  state: 'expired',
  unattended: true
}))

vi.mock('@shared/utils/sessionTargets', () => ({ sessionUpdateTargets: () => TARGETS }))

vi.mock('@main/services/platformSession.service', () => ({
  sessionHealth: () => Promise.resolve({ success: true, data: [] }),
  verifySavedSessions: () => Promise.resolve([]),
  captureSession: ({ username }: { username: string }) => {
    state.attempted.push(username)

    const wait = state.duration.get(username) ?? 0

    return new Promise(resolve => {
      setTimeout(
        () => resolve({ success: true, data: { message: `${username} updated` } }),
        wait
      )
    })
  },
  announceSessionCapturing: (target: { platform: string; username: string } | null) => {
    state.announced.push(target ? target.username : '-')
  }
}))

// A one-second deadline instead of the real minute, so the test exercises the
// rule rather than waiting for it. Set before the import, because the module
// reads it once at load.
process.env['SESSION_UPDATE_ACCOUNT_MS'] = '1000'

const { TASK_RUNNERS } = await import('@main/services/automationTasks')

const run = (): Promise<TaskOutcome> => TASK_RUNNERS['session-refresh']()

beforeEach(() => {
  state.attempted.length = 0
  state.announced.length = 0
  state.duration.clear()
  vi.useRealTimers()
})

describe('a session update with one account that hangs', () => {
  it('gives up on it and still tries the rest', async () => {
    // The middle one takes longer than the deadline the env var sets for this
    // test run (see vitest env below); the others are instant.
    state.duration.set('hangs', 5_000)

    const outcome = await run()

    // All three attempted. Before this, the run would have sat on the second.
    expect(state.attempted).toEqual(['ok-before', 'hangs', 'ok-after'])
    expect(outcome.succeeded).toBe(2)
  }, 30_000)

  it('stops the account’s spinner when it gives up, and starts the next one', async () => {
    state.duration.set('hangs', 5_000)

    await run()

    // THE CASE THE SPINNER EXISTS FOR, and the one that would betray it: the
    // capture is still hanging when the deadline fires, so releasing the chip
    // has to be tied to the DEADLINE rather than to the capture returning.
    // Otherwise the one account nobody should be waiting on is the only one
    // still shown as in progress — a stalled run wearing the face of a live one.
    expect(state.announced).toEqual(['ok-before', '-', 'hangs', '-', 'ok-after', '-'])
  }, 30_000)

  it('reports the one it gave up on rather than dropping it', async () => {
    state.duration.set('hangs', 5_000)

    const outcome = await run()

    // Named, with a row of its own: an account that silently vanishes from the
    // report is one nobody knows to go and fix by hand.
    const row = outcome.rows.find(entry => entry.ref.includes('hangs'))

    expect(row).toBeDefined()
    expect(row?.note).toMatch(/gave up/i)

    // And counted — in its own bucket, because "the marketplace said no" and
    // "the sign-in never came back" lead to different places.
    expect(outcome.detail).toMatch(/timed out/i)
    expect(outcome.summary.some(line => /timed out/i.test(line.label))).toBe(true)
  }, 30_000)

  it('counts every account that was not updated as a failure', async () => {
    state.duration.set('hangs', 5_000)

    const outcome = await run()

    // A green run beside a red banner is the bug this whole area exists to
    // avoid: the timed-out account is still stale in the morning.
    expect(outcome.total).toBe(3)
    expect(outcome.succeeded).toBe(2)
    expect(outcome.failed).toBe(1)
  }, 30_000)

  it('does not penalise a run where nothing hangs', async () => {
    const outcome = await run()

    expect(outcome.succeeded).toBe(3)
    expect(outcome.failed).toBe(0)
    expect(outcome.detail).not.toMatch(/timed out/i)
  }, 30_000)
})
