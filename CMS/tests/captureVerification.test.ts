import { describe, expect, it, vi } from 'vitest'

/**
 * A scripted sign-in is not finished when the form submits.
 *
 * THE BUG. `captureSession` has two routes to a session: a window the operator
 * signs in through, and the platform's own scripted login run by this app.
 * The window route has always asked the marketplace whether the jar it
 * harvested is actually a session — a public landing page sets plenty of
 * cookies, and counting them proves nothing. The scripted route did not ask at
 * all. It drove the form, took whatever cookies were there, stored them and
 * reported success.
 *
 * What that looked like: Session update reports "1 updated" at 06:16:14, the
 * Sessions page turns green, and Auto claim probes the very same jar at
 * 06:17:01 and is told it is anonymous — so the account's claims are skipped
 * forty-five seconds after an operator watched the sign-in succeed. Re-capture
 * and it happens again, identically, because nothing in that loop ever checks
 * the thing that is wrong.
 *
 * Both halves matter here: a refused jar must not be stored ANYWHERE — not at
 * the backend, not in the local company document — because the session it would
 * replace may still be working.
 */

interface Harness {
  /** What the marketplace says about the captured jar. Null = could not tell. */
  recognised: boolean | null
  /** Paths POSTed to the backend, so a refused capture can be shown to send none. */
  ingested: string[]
  rememberedLocally: string[]
}

const state = vi.hoisted(
  (): Harness => ({ recognised: true, ingested: [], rememberedLocally: [] })
)

/**
 * What the IDENTITY endpoint says, which is now asked before the old probe.
 *
 * `null` by default — "no clear answer" — so every case already written here
 * still reaches the probe it was written against, and `state.recognised` goes
 * on meaning what it meant.
 */
const identity = vi.hoisted(
  (): { ok: true | false | null; detail: string } => ({ ok: null, detail: 'no clear answer' })
)

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test', getVersion: () => '0.0.0' },
  BrowserWindow: Object.assign(
    function () {
      return {}
    },
    { getAllWindows: () => [] }
  ),
  session: { fromPartition: () => ({ cookies: { get: () => Promise.resolve([]) } }) },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/config/env', () => ({
  env: {
    // Route 2: this machine may drive a browser unattended, and the company has
    // auto-login on. That is the path the nightly Session update takes.
    useBackendForSessionUpdate: false,
    sessionUpdateAutomatically: true
  }
}))
vi.mock('@main/services/automationRouting.service', () => ({
  autoLoginEnabled: () => Promise.resolve(true),
  clearRoutingCache: vi.fn()
}))
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => 'token',
  getSession: () => ({ user: { companyId: 'c1' } })
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string) => {
    // The read-back `confirmStored` does after every capture. It must find the
    // account with a session, or it reports the capture as lost — a different
    // failure from the one under test.
    if (path.includes('my-company-credentials')) {
      return Promise.resolve({
        success: true,
        data: {
          platforms: [
            {
              platform: 'myntra',
              credentials: [
                {
                  credentialId: 'c1',
                  username: 'listing@mozafia.com',
                  visible: true,
                  session: { savedAt: '2026-09-19T06:16:14.000Z', jar: { 'erp.at': 'x' } }
                }
              ]
            }
          ]
        }
      })
    }

    state.ingested.push(path)

    return Promise.resolve({ success: true, data: { message: 'stored' } })
  }
}))
vi.mock('@main/services/localLogin.service', () => ({
  // The sign-in itself succeeds — eight cookies, exactly as the field report.
  loginLocally: () =>
    Promise.resolve({
      success: true,
      data: {
        jar: { 'erp.at': 'x', 'erp.rt': 'y' },
        cookieNames: ['erp.at', 'erp.rt'],
        durationMs: 40233,
        extra: {},
        tokens: {}
      }
    }),
  operatorLoginLocally: vi.fn(),
  needsRealBrowserForManualSignIn: () => false
}))
vi.mock('@trackvid/automation-core/common/probeSession', () => ({
  probePlatformSession: () => Promise.resolve(state.recognised)
}))
vi.mock('@main/services/company.service', () => ({
  credentialsFor: () => Promise.resolve([]),
  refusedLogins: () => Promise.resolve(new Set<string>()),
  credentialFor: () => Promise.resolve(null),
  rememberCompanySession: (platform: string, username: string) => {
    state.rememberedLocally.push(`${platform}:${username}`)

    return Promise.resolve()
  },
  rememberOtpMode: vi.fn()
}))
vi.mock('@main/services/localSession.store', () => ({ rememberSession: vi.fn() }))
vi.mock('@main/services/pendingSession.store', () => ({
  queuePending: () => Promise.resolve(true),
  listPending: () => Promise.resolve([]),
  readPending: () => Promise.resolve(null),
  discardPending: vi.fn()
}))
vi.mock('@main/services/sessionRejection.store', () => ({
  sessionRejections: () => Promise.resolve(new Map()),
  sessionRejectionKey: (platform: string, username: string) => `${platform}:${username}`,
  rememberSessionRejected: vi.fn(),
  forgetSessionRejected: vi.fn()
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  reusableSession: () => Promise.resolve({ session: null, reason: 'reused', detail: '' })
}))
vi.mock('@main/services/offlineCache', () => ({
  withOfflineCache: <T>(_key: string, run: () => Promise<T>): Promise<T> => run()
}))
vi.mock('@main/services/preferences.service', () => ({ getPreferences: () => ({}) }))
vi.mock('@main/services/credentialSecret.service', () => ({ credentialSecret: vi.fn() }))
vi.mock('@main/services/loginDriver.service', () => ({ driveLogin: vi.fn() }))
vi.mock('@main/services/serverRenew.service', () => ({ renewSessionOnServer: vi.fn() }))
vi.mock('@main/services/browserIdentity', () => ({
  applyPageIdentity: vi.fn(),
  reportPageEnvironment: vi.fn(),
  useBrowserIdentity: vi.fn()
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (module: string) =>
    module === 'common/sessionIdentity'
      ? {
          checkSessionIdentity: () =>
            Promise.resolve({ ok: identity.ok, who: null, detail: identity.detail })
        }
      : undefined
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'myntra session capture',
  withProcessLogResult: <T>(_name: string, run: () => Promise<T>): Promise<T> => run()
}))

const { captureSession } = await import('@main/services/platformSession.service')

const reset = (): void => {
  state.ingested = []
  state.rememberedLocally = []
  identity.ok = null
  identity.detail = 'no clear answer'
}

describe('a scripted sign-in the marketplace does not recognise', () => {
  it('is refused, and nothing is stored anywhere', async () => {
    reset()
    state.recognised = false

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.message).toMatch(/does not recognise the login/i)
    }

    // Not sent to the backend, and — just as important — not written over the
    // local company document. The session this would have replaced may still
    // be working, and a capture that fails must leave it alone.
    expect(state.ingested).toEqual([])
    expect(state.rememberedLocally).toEqual([])
  })

  it('is stored as normal when the marketplace does recognise it', async () => {
    reset()
    state.recognised = true

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(true)
    expect(state.ingested.length).toBe(1)
    expect(state.rememberedLocally).toEqual(['myntra:listing@mozafia.com'])
  })

  /**
   * `null` is "could not tell", not "no". AJIO has no jar-only probe by design,
   * and a flat network answers the same way for everybody — refusing a real
   * session over either would be its own bug.
   */
  it('is stored when the check could not be run at all', async () => {
    reset()
    state.recognised = null

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(true)
    expect(state.ingested.length).toBe(1)
  })
})

describe('why a capture was refused', () => {
  /*
   * ONE ACCOUNT FAILED THIS CHECK EVERY TIME FOR A FORTNIGHT — sign in, refuse,
   * discard, sign in again an hour later — and every record of it said the same
   * eleven words: "Myntra does not recognise the session that was captured".
   * The reason lived in a `console.log` inside the core, which this app does not
   * capture, so it reached neither the log file nor the screen. 401, a
   * rate-limited burst, a timeout, and a 200 answering with a payload that names
   * nobody are four different problems with four different fixes, and none of
   * them could be told apart.
   */
  it('carries the marketplace’s own answer into the message', async () => {
    reset()
    identity.ok = false
    identity.detail = 'HTTP 200 — the portal does not recognise this session'

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(false)
    if (result.success) return

    expect(result.error.message).toContain('HTTP 200')
    // And the account is named as the thing to look at, because a sign-in that
    // works and a session the portal will not name is not a capture bug.
    expect(result.error.message).toContain('active seller')
  })

  it('does not reach the old probe once the identity endpoint has answered', async () => {
    // A definite answer is the answer. Asking a second, weaker question after it
    // is how a 401 turns back into "cannot tell".
    reset()
    identity.ok = false
    identity.detail = 'HTTP 401 — the portal does not recognise this session'
    state.recognised = true

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(false)
    expect(state.ingested).toEqual([])
  })

  it('stores the session when the identity endpoint names the seller', async () => {
    reset()
    identity.ok = true
    identity.detail = 'signed in as 23026'
    state.recognised = false

    const result = await captureSession({ platform: 'myntra', username: 'listing@mozafia.com' })

    expect(result.success).toBe(true)
    expect(state.ingested).toHaveLength(1)
  })
})
