import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The nightly Refill Data run, and the platforms it must not bother asking.
 *
 * WHAT WENT WRONG. The sweep ran every platform that had rows waiting,
 * regardless of whether anything could sign in to it. `mappingAccounts` only
 * drops accounts needing a one-time code, so a password-only login with a dead
 * jar was kept — and the run tried to sign it in: a real browser against a real
 * marketplace, minutes of it per account, before the first row was even asked
 * about. At 23:00 that time comes straight out of the platforms that CAN
 * answer, and the screen showed "Snapdeal 5 to refill" grinding away under a
 * Session update card that already said Snapdeal had no session.
 *
 * THE RULE PINNED HERE: a platform is asked only when at least one of its
 * accounts holds a session usable right now — with two exceptions that matter
 * as much as the rule, because each is a way of turning one bug into a worse
 * one:
 *
 *   an OFFLINE platform is always asked. AJIO's refill reads the local report
 *     backup and never signs in, so "no session" is not a reason to skip the
 *     one platform that needs none.
 *
 *   an UNREADABLE health endpoint gates nothing. "Everything is dead" and "I
 *     could not ask" arrive identically, and only one is safe to act on — so a
 *     transient failure must not turn into a silent night of no work.
 */

interface Credential {
  username: string
  session: unknown
  visible?: boolean
}

interface HealthState {
  ok: boolean
  data: { platform: string; autoLogin: boolean; credentials: Credential[] }[]
}

const health = vi.hoisted<HealthState>(() => ({ ok: true, data: [] }))
const refills = vi.hoisted(() => ({ platforms: [] as string[] }))
const pending = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }))

// The refill pass broadcasts its shape as it runs.
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/platformSession.service', () => ({
  sessionHealth: () =>
    Promise.resolve(
      health.ok
        ? { success: true, data: health.data }
        : { success: false, error: { message: 'offline' } }
    ),
  verifySavedSessions: () => Promise.resolve([]),
  captureSession: () => Promise.resolve({ success: true, data: {} }),
  announceSessionCapturing: () => undefined
}))
vi.mock('@main/services/pendingClaims.service', () => ({
  pendingClaims: () => Promise.resolve(pending.rows),
  // The status pass runs after the blanks pass; these tests are about the
  // blanks pass's session gate, so it has nothing to look at.
  claimsAwaitingStatus: () => Promise.resolve({ rows: [], upToDate: new Map() }),
  splitFileable: () => ({ fileable: [], blocked: [] })
}))
vi.mock('@main/services/refill.service', () => ({
  runRefill: (input: { platform: string }) => {
    refills.platforms.push(input.platform)

    return Promise.resolve({
      success: true,
      data: { filled: 1, untouched: 0, notFound: 0, failed: 0 }
    })
  }
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

const { taskRunner } = await import('@main/services/automationTasks')

/** A stored session the date rules read as alive for `hoursLeft` more hours. */
const session = (hoursLeft: number) => ({
  savedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + hoursLeft * 3_600_000).toISOString(),
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a']
})

const platform = (name: string, credentials: Credential[]) => ({
  platform: name,
  autoLogin: true,
  credentials: credentials.map((credential, i) => ({
    credentialId: `cred-${name}-${i}`,
    visible: true,
    ...credential
  }))
})

/** A Pending claim on `name` with a return AWB, so it is refillable. */
const claim = (name: string, id: string) => ({
  id,
  platform: name,
  returnAwb: `AWB-${id}`,
  refillAttempts: 0
})

const run = () => taskRunner('refill-data')()

beforeEach(() => {
  refills.platforms.length = 0
  health.ok = true
  health.data = []
  pending.rows = []
})

describe('a platform with nothing that can sign in', () => {
  beforeEach(() => {
    pending.rows = [claim('snapdeal', '1'), claim('meesho', '2')]
  })

  it('is not asked at all when its only session has expired', async () => {
    health.data = [
      platform('snapdeal', [{ username: 'a@example.invalid', session: session(-1) }]),
      platform('meesho', [{ username: 'b@example.invalid', session: session(48) }])
    ]

    await run()

    // The whole point: no browser, no sign-in, no minutes spent.
    expect(refills.platforms).toEqual(['meesho'])
  })

  it('is not asked when it has never had a session', async () => {
    health.data = [
      platform('snapdeal', [{ username: 'a@example.invalid', session: null }]),
      platform('meesho', [{ username: 'b@example.invalid', session: session(48) }])
    ]

    await run()

    expect(refills.platforms).toEqual(['meesho'])
  })

  it('is not kept alive by a credential hidden in Monitor', async () => {
    // Hidden means this machine may not use it, so it cannot vouch for the
    // platform — otherwise the gate passes and the sign-in is attempted anyway.
    health.data = [
      platform('snapdeal', [
        { username: 'hidden@example.invalid', session: session(48), visible: false }
      ]),
      platform('meesho', [{ username: 'b@example.invalid', session: session(48) }])
    ]

    await run()

    expect(refills.platforms).toEqual(['meesho'])
  })

  it('says so on its own row, rather than reporting a failure', async () => {
    // These rows were never asked about. Calling that "failed" sends somebody
    // looking for a marketplace fault; the fix is a re-capture.
    // One platform only, so the count below is unambiguous.
    pending.rows = [claim('snapdeal', '1')]
    health.data = [platform('snapdeal', [{ username: 'a@example.invalid', session: null }])]

    const outcome = await run()

    expect(outcome.failed).toBe(0)
    expect(outcome.rows?.[0]?.note).toMatch(/no account on this platform has a usable login/i)
    expect(outcome.summary).toContainEqual({ label: 'Waiting on a login', value: '1' })
  })
})

describe('a platform that can still answer', () => {
  it('is asked when a session is merely expiring', async () => {
    // "Expiring" still authenticates. Refusing it would skip work that would
    // have succeeded, which is the opposite mistake and just as costly.
    pending.rows = [claim('snapdeal', '1')]
    health.data = [platform('snapdeal', [{ username: 'a@example.invalid', session: session(1) }])]

    await run()

    expect(refills.platforms).toEqual(['snapdeal'])
  })

  it('is asked when only one of several accounts is live', async () => {
    pending.rows = [claim('snapdeal', '1')]
    health.data = [
      platform('snapdeal', [
        { username: 'dead@example.invalid', session: session(-5) },
        { username: 'live@example.invalid', session: session(48) }
      ])
    ]

    await run()

    expect(refills.platforms).toEqual(['snapdeal'])
  })
})

describe('the two exceptions', () => {
  it('still sweeps AJIO, which needs no session at all', async () => {
    // Its answers come from the local report backup. Gating it on a login it
    // never makes would disable the one platform that always works offline.
    pending.rows = [claim('ajio', '1')]
    health.data = [platform('ajio', [{ username: 'a@example.invalid', session: null }])]

    await run()

    expect(refills.platforms).toEqual(['ajio'])
  })

  it('gates nothing when session health cannot be read', async () => {
    // Indistinguishable from "all dead" in the answer, but not in consequence:
    // skipping everything on a transient fault is a silent night of no work.
    pending.rows = [claim('snapdeal', '1'), claim('meesho', '2')]
    health.ok = false

    await run()

    expect(refills.platforms.sort()).toEqual(['meesho', 'snapdeal'])
  })
})
