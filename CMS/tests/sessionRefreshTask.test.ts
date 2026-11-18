import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The nightly Session update, against the banner that sits above it.
 *
 * The reported bug, exactly: the banner said "These sessions are not updated,
 * please update them: Snapdeal" while the job that exists to fix that reported
 * "Every session was still good". Two rules for one question — the banner
 * flagged `expired` and `none`, the job flagged `expired` and `expiring` — so
 * the account this machine had never signed in was the one account the job
 * would not touch, and the operator believed the side that said nothing was
 * wrong.
 */

const captured = vi.hoisted(() => ({ calls: [] as string[] }))

/**
 * What the screen was told, in order.
 *
 * `'platform:username'` when an account goes in hand, `'-'` when it is
 * released, so the sequence itself proves the spinner cannot outlive its
 * account.
 */
const announced = vi.hoisted(() => ({ calls: [] as string[] }))

/** Makes the next capture fail, for the case where the account is released anyway. */
const captureFails = vi.hoisted(() => ({ value: false }))

/**
 * What the marketplace says about the session the run has just saved.
 *
 * `'reused'` by default — the normal case, where a capture that reported
 * success produced a session the marketplace honours. Set to `'dead'` for the
 * case this exists to catch.
 */
const afterCapture = vi.hoisted(() => ({ reason: 'reused', detail: 'ok' }))

/** The signed-in operator. Taken away mid-run by the sign-out case below. */
const auth = vi.hoisted(() => ({ token: null as string | null, clearOnCapture: false }))

const health = vi.hoisted(() => ({
  data: [] as {
    platform: string
    autoLogin: boolean
    autoLoginBlockedBy?: 'company' | 'machine' | 'no-script'
    credentials: { username: string; credentialId: string; visible?: boolean; session: unknown }[]
  }[]
}))

// The refill pass broadcasts its shape as it runs.
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/platformSession.service', () => ({
  sessionHealth: () => Promise.resolve({ success: true, data: health.data }),
  // The live probe over the sessions the dates call fine. Its own behaviour is
  // covered in sessionRejection.test; here it must simply not interfere, so it
  // finds nothing refused and these cases stay about the date-based rule.
  verifySavedSessions: () => Promise.resolve([]),
  captureSession: (input: { platform: string; username: string }) => {
    captured.calls.push(`${input.platform}:${input.username}`)

    // The operator signs out while this account is in flight — which is exactly
    // when it happened in the field.
    if (auth.clearOnCapture) auth.token = null

    if (captureFails.value) {
      return Promise.resolve({ success: false, error: { message: 'the marketplace refused' } })
    }

    return Promise.resolve({ success: true, data: { message: 'signed in' } })
  },
  announceSessionCapturing: (target: { platform: string; username: string } | null) => {
    announced.calls.push(target ? `${target.platform}:${target.username}` : '-')
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => auth.token }))
vi.mock('@main/services/sessionReuse.service', () => ({
  reusableSession: () =>
    Promise.resolve({ session: null, reason: afterCapture.reason, detail: afterCapture.detail })
}))
vi.mock('@main/services/cmsList.service', () => ({ listCms: () => Promise.resolve({ success: true, data: { rows: [] } }) }))
vi.mock('@main/services/claimProcessor.service', () => ({ processClaims: () => Promise.resolve({ success: true, data: {} }) }))
vi.mock('@main/services/masterBackup.service', () => ({ runDailyBackup: () => Promise.resolve({ success: true, data: {} }) }))
vi.mock('@main/services/refill.service', () => ({ runRefill: () => Promise.resolve({ success: true, data: {} }) }))

const { taskRunner } = await import('@main/services/automationTasks')

/** A session record the health rules read as alive until `expiresAt`. */
const session = (hoursLeft: number) => ({
  savedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + hoursLeft * 3_600_000).toISOString(),
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a']
})

const platform = (
  name: string,
  credentials: { username: string; session: unknown; visible?: boolean }[],
  autoLogin = true
) => ({
  platform: name,
  autoLogin,
  credentials: credentials.map((credential, i) => ({
    credentialId: `cred-${name}-${i}`,
    visible: true,
    ...credential
  }))
})

const run = () => taskRunner('session-refresh')()

beforeEach(() => {
  captured.calls.length = 0
  announced.calls.length = 0
  captureFails.value = false
  afterCapture.reason = 'reused'
  afterCapture.detail = 'ok'
  health.data = []
})

describe('what the run tells the screen while it works', () => {
  /**
   * The Settings card shows every stale account at once, and until this signal
   * existed the one being signed in looked exactly like the ones queued behind
   * it — for up to a minute each, since `changed` only fires once a capture
   * LANDS. A run in progress and a run that had stalled were indistinguishable.
   */
  it('names each account as it starts, and releases it before the next', async () => {
    health.data = [
      platform('Flipkart', [{ username: 'a@x.com', session: null }]),
      platform('Xbees', [{ username: 'b@x.com', session: null }])
    ]

    await run()

    // Strictly alternating: an account is always released before the next is
    // claimed, so two chips can never spin at once.
    expect(announced.calls).toEqual(['flipkart:a@x.com', '-', 'xbees:b@x.com', '-'])
  })

  it('releases the account even when its sign-in fails', async () => {
    // The failure path is the one that matters: a chip left spinning over an
    // account that already failed is worse than no spinner, because it reports
    // work that is not happening.
    health.data = [platform('Flipkart', [{ username: 'a@x.com', session: null }])]
    captureFails.value = true

    await run()

    expect(announced.calls.at(-1)).toBe('-')
  })
})

describe('the Session update task', () => {
  it('captures a session that was NEVER captured — the banner’s own rule', async () => {
    // Snapdeal, in the report: no session at all.
    health.data = [platform('Snapdeal', [{ username: 'a@x.com', session: null }])]

    const outcome = await run()

    expect(captured.calls).toEqual(['snapdeal:a@x.com'])
    expect(outcome.detail).not.toContain('still good')
    expect(outcome.succeeded).toBe(1)
  })

  it('still renews an expired and an expiring one', async () => {
    health.data = [
      platform('Myntra', [{ username: 'm@x.com', session: session(-1) }]),
      platform('Ajio', [{ username: 'a@x.com', session: session(1) }])
    ]

    await run()

    expect(captured.calls.sort()).toEqual(['ajio:a@x.com', 'myntra:m@x.com'])
  })

  it('leaves a healthy session alone, and says so', async () => {
    health.data = [platform('Ajio', [{ username: 'a@x.com', session: session(72) }])]

    const outcome = await run()

    expect(captured.calls).toEqual([])
    expect(outcome.detail).toBe('Every login was still good')
  })

  it('does not queue a platform this app keeps no sessions for', async () => {
    // The credentials endpoint returns a bucket per configured platform, and
    // Amazon / D2C / "Other" have no login this app can capture. They were
    // being queued anyway, to fail one at a time.
    health.data = [
      platform('Amazon', [{ username: 'a@x.com', session: null }]),
      platform('Other', [{ username: 'o@x.com', session: null }]),
      platform('D2C', [{ username: 'd@x.com', session: null }]),
      platform('Meesho', [{ username: 'm@x.com', session: null }])
    ]

    const outcome = await run()

    expect(captured.calls).toEqual(['meesho:m@x.com'])
    expect(outcome.total).toBe(1)
  })

  it('leaves a platform alone when the company switch is off', async () => {
    // `isAutoLoginOnActiveSession.myntra === false` in the company settings:
    // that platform's logins are a person's job, so the Login update must not
    // sign in to them — and must not count them as outstanding work either.
    health.data = [
      {
        ...platform('Myntra', [{ username: 'm@x.com', session: session(-1) }], false),
        autoLoginBlockedBy: 'company'
      },
      platform('Meesho', [{ username: 'e@x.com', session: session(-1) }])
    ]

    const outcome = await run()

    expect(captured.calls).toEqual(['meesho:e@x.com'])
    expect(outcome.total).toBe(1)
  })

  it('still tries an account this machine cannot sign in unattended', async () => {
    // `machine` / `no-script` are this installation's limits, not the
    // company's decision — the run attempts them and reports any failure by name.
    health.data = [
      {
        ...platform('Myntra', [{ username: 'm@x.com', session: session(-1) }], false),
        autoLoginBlockedBy: 'machine'
      }
    ]

    const outcome = await run()

    expect(captured.calls).toEqual(['myntra:m@x.com'])
    expect(outcome.total).toBe(1)
  })

  it('skips a credential hidden from the seller UI', async () => {
    health.data = [platform('Ajio', [{ username: 'a@x.com', session: null, visible: false }])]

    expect((await run()).total).toBe(0)
  })
})

describe('a capture the marketplace then refuses', () => {
  /*
   * THE REPORT. A scheduled run said "1 updated" at 18:54; Check now, pressed
   * at 19:40, listed the same Delhivery account as Rejected. Neither was lying:
   * the run trusted `captureSession` returning success, and Check now had asked
   * Delhivery. A capture's success means a session was signed in for and
   * stored — not that the marketplace honours it, and for the token platforms
   * nothing between the two ever asked.
   */
  it('is not counted as updated', async () => {
    health.data = [platform('Delhivery', [{ username: 'a@x.com', session: null }])]
    afterCapture.reason = 'dead'
    afterCapture.detail = 'Delhivery answered 401'

    const outcome = await run()

    expect(outcome.succeeded).toBe(0)
    expect(outcome.failed).toBe(1)
    // The words matter as much as the count: "updated" over a red card is the
    // bug, and an operator has to be able to tell this from a sign-in that
    // failed outright.
    expect(outcome.detail).toContain('still refused after re-capturing')
  })

  it('names the marketplace’s own reason on the row', async () => {
    health.data = [platform('Delhivery', [{ username: 'a@x.com', session: null }])]
    afterCapture.reason = 'dead'
    afterCapture.detail = 'Delhivery answered 401'

    const outcome = await run()

    expect(outcome.rows[0]?.note).toContain('Delhivery answered 401')
  })

  it('leaves a capture alone when the probe cannot tell', async () => {
    // AJIO's probe needs a live page, and a flat network answers nothing.
    // Marking those red would fail good sessions every night.
    health.data = [platform('Ajio', [{ username: 'a@x.com', session: null }])]
    afterCapture.reason = 'unverifiable'
    afterCapture.detail = 'needs a live page'

    const outcome = await run()

    expect(outcome.succeeded).toBe(1)
    expect(outcome.failed).toBe(0)
  })
})

describe('signing out while the run is working', () => {
  /**
   * WHAT THE LOG SHOWED. A sign-in started at 06:01:16, the operator signed out
   * at 06:01:21, and the browser carried on until 06:01:50 — driving a
   * marketplace for a company the app had already left, toward a result that
   * could not be saved because the token was cleared in between. The account
   * was then recorded as a failure.
   *
   * Two things have to hold afterwards: the loop stops rather than working
   * through the rest, and the abandoned account is NOT blamed — nothing was
   * wrong with it, somebody left.
   */
  beforeEach(() => {
    auth.token = null
    auth.clearOnCapture = false
  })

  it('stops at the account in flight, and does not count it as failed', async () => {
    health.data = [
      platform('flipkart', [{ username: 'a@x.com', session: session(-1) }]),
      platform('myntra', [{ username: 'm@x.com', session: session(-1) }])
    ]
    auth.token = 'signed-in'
    auth.clearOnCapture = true

    const outcome = await run()

    expect(captured.calls).toEqual(['flipkart:a@x.com'])
    expect(outcome.failed).toBe(0)
    expect(outcome.succeeded).toBe(0)
  })

  it('does not abandon a run that never had a token to lose', async () => {
    // A context with no signed-in operator at all — a test, or a path where the
    // token is not the gate — must behave exactly as it did before this existed.
    health.data = [platform('flipkart', [{ username: 'a@x.com', session: session(-1) }])]
    auth.token = null

    await run()

    expect(captured.calls).toEqual(['flipkart:a@x.com'])
  })
})
