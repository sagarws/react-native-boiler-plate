import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Switching automations off stops the Session update BETWEEN ACCOUNTS.
 *
 * THE BUG THIS EXISTS FOR, reported from a real run. Session update is ONE
 * scheduled task that signs in to every stale account in a loop — seven of
 * them on the machine it was seen on. The master switch only checked between
 * TASKS, so switching off at 05:41:27, eight seconds into the first login,
 * stopped nothing: the log carried on through the Snapdeal sign-in and the rail
 * sat on "Stopping…" for two minutes with work still going.
 *
 * The signal has to be readable from INSIDE the loop, and read at a boundary
 * where stopping is safe — after the account in flight, never mid-sign-in.
 */

const captured = vi.hoisted(() => ({ calls: [] as string[] }))
const stop = vi.hoisted(() => ({ requested: false, afterCaptures: -1 }))

const health = vi.hoisted(() => ({
  data: [] as {
    platform: string
    autoLogin: boolean
    credentials: { username: string; credentialId: string; visible?: boolean; session: unknown }[]
  }[]
}))

// The refill pass broadcasts its shape as it runs.
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
const stopListeners = vi.hoisted(() => new Set<() => void>())

vi.mock('@main/services/schedulerPause.store', () => ({
  isPaused: () => Promise.resolve(stop.requested),
  writePaused: () => Promise.resolve(),
  // Never paused in this file, so there is never a reason.
  pauseReason: () => Promise.resolve(null),
  requestScheduleStop: () => {
    stop.requested = true
    for (const listener of [...stopListeners]) listener()
  },
  clearScheduleStop: () => {
    stop.requested = false
  },
  isScheduleStopRequested: () => stop.requested,
  automationsHalted: () => Promise.resolve(stop.requested),
  onStopRequested: (listener: () => void) => {
    if (stop.requested) {
      listener()

      return () => undefined
    }

    stopListeners.add(listener)

    return () => stopListeners.delete(listener)
  }
}))
vi.mock('@main/services/platformSession.service', () => ({
  sessionHealth: () => Promise.resolve({ success: true, data: health.data }),
  verifySavedSessions: () => Promise.resolve([]),
  captureSession: (input: { platform: string; username: string }) => {
    captured.calls.push(`${input.platform}:${input.username}`)

    // The operator reaches for the switch part-way through the run — which is
    // the only moment this bug was ever visible.
    if (captured.calls.length === stop.afterCaptures) stop.requested = true

    return Promise.resolve({ success: true, data: { message: 'signed in' } })
  },
  announceSessionCapturing: () => undefined
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  reusableSession: () => Promise.resolve({ session: { ok: true }, reason: 'reused', detail: 'ok' })
}))
vi.mock('@main/services/cmsList.service', () => ({
  listCms: () => Promise.resolve({ success: true, data: { rows: [] } })
}))
vi.mock('@main/services/claimProcessor.service', () => ({
  processClaims: () => Promise.resolve({ success: true, data: {} })
}))
vi.mock('@main/services/masterBackup.service', () => ({
  runDailyBackup: () => Promise.resolve({ success: true, data: {} })
}))
vi.mock('@main/services/refill.service', () => ({
  runRefill: () => Promise.resolve({ success: true, data: {} })
}))

const { taskRunner } = await import('@main/services/automationTasks')

/** An account with no session at all — the strongest reason to sign it in. */
const account = (platform: string, username: string) => ({
  platform,
  autoLogin: true,
  credentials: [{ credentialId: `cred-${username}`, username, visible: true, session: null }]
})

beforeEach(() => {
  captured.calls.length = 0
  stop.requested = false
  stop.afterCaptures = -1
  health.data = [
    account('snapdeal', '1'),
    account('meesho', '2'),
    account('flipkart', '3'),
    account('nykaa', '4'),
    account('delhivery', '5')
  ]
})

describe('the nightly Session update', () => {
  it('signs in to every stale account when nothing stops it', async () => {
    const outcome = await taskRunner('session-refresh')(() => stop.requested)

    expect(captured.calls).toHaveLength(5)
    expect(outcome.detail).not.toContain('stopped')
  })

  it('stops after the account in flight when the switch goes off', async () => {
    // The switch is pressed while the second account is signing in.
    stop.afterCaptures = 2

    const outcome = await taskRunner('session-refresh')(() => stop.requested)

    // Two attempted — the one in flight was allowed to finish — and the
    // remaining three never started. This is the whole fix: before it, all
    // five ran.
    expect(captured.calls).toHaveLength(2)
    expect(outcome.detail).toContain('stopped after 2 of 5')
  })

  it('counts only what it attempted, so the rest are not reported as failures', async () => {
    stop.afterCaptures = 1

    const outcome = await taskRunner('session-refresh')(() => stop.requested)

    // `total` used to be the size of the whole list, which turned four accounts
    // nobody got to into four failures on the job row.
    expect(outcome.total).toBe(5)
    expect(outcome.failed).toBe(0)
    expect(outcome.succeeded).toBe(1)
  })

  it('does not stop a manual Run now, whatever the switch says', async () => {
    stop.requested = true

    // What `runTask` passes for a manual run. Per run rather than a module
    // flag, so a manual run of one task cannot disable stopping for a
    // scheduled task going alongside it.
    const outcome = await taskRunner('session-refresh')(() => false)

    expect(captured.calls).toHaveLength(5)
    expect(outcome.detail).not.toContain('stopped')
  })
})
