import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as SignInPolicy from '@main/services/signInPolicy'

/**
 * What a claim does when its session has expired.
 *
 * `settings.isAutoLoginOnActiveSession.<platform>` is the whole decision:
 * true means sign in by script, false means a person signs in. Nothing on the
 * claim path read it, and the result was a dead end — with auto-login OFF the
 * backend withholds the password (`/cms/credential-secret` gates on the same
 * flag), so a claim with an expired session walked into a scripted sign-in it
 * had no credentials for and failed with "Missing username or password".
 * Correct in that it did not sign in; useless in that it never asked the person
 * sitting in front of the machine.
 *
 * These tests pin that the flag is honoured, in one place, for every platform —
 * and that the routing is DELEGATED rather than reimplemented: captureSession
 * already chooses between the automation server, a scripted sign-in here, and a
 * manual window, using this same setting.
 */

interface Credential {
  username: string
  password: string
  credentialId: string
}

interface TestState {
  autoLogin: boolean
  local: unknown
  stored: unknown
  credential: Credential | null
  captures: Record<string, unknown>[]
  captureResult: { success: boolean; data?: unknown; error?: { code: string; message: string } }
  /** What the marketplace says about the stored jar. */
  liveness: { reason: string; detail: string }
  /**
   * May this work sign in? The app refuses by default (signInPolicy); these
   * tests are about the sign-in machinery, so most run with it allowed.
   */
  allowSignIn: boolean
}

const state = vi.hoisted(
  (): TestState => ({
    autoLogin: true,
    local: null,
    stored: null,
    credential: { username: 'seller@example.com', password: 'secret', credentialId: 'cred-1' },
    captures: [],
    captureResult: { success: true, data: {} },
    liveness: { reason: 'reused', detail: 'the saved session works' },
    allowSignIn: true
  })
)

vi.mock('@main/services/signInPolicy', async importOriginal => ({
  ...(await importOriginal<typeof SignInPolicy>()),
  signInAllowed: () => state.allowSignIn
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/localSession.store', () => ({
  recallSession: () => Promise.resolve(state.local)
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  storedSession: () => Promise.resolve(state.stored),
  reusableSession: () => Promise.resolve({ session: null, ...state.liveness })
}))
vi.mock('@main/services/company.service', () => ({
  credentialFor: () => Promise.resolve(state.credential)
}))
vi.mock('@main/services/automationRouting.service', () => ({
  autoLoginEnabled: () => Promise.resolve(state.autoLogin)
}))
vi.mock('@main/services/platformSession.service', () => ({
  captureSession: (input: Record<string, unknown>) => {
    state.captures.push(input)
    // A successful capture is what puts a session where the app can read it.
    if (state.captureResult.success) state.local = { sid: 'fresh' }

    return Promise.resolve(state.captureResult)
  }
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    // Nykaa's shape: a context needs portalId, so a bare jar cannot stand in.
    claimContextFromSession: (_platform: string, record: { portalId?: string }) =>
      record?.portalId ? { portalId: record.portalId } : null,
    missingContextFields: () => ['portalId'],
    // Nykaa in these tests: a platform whose session IS judged here, from the
    // stored record. AJIO's and Tata CliQ's are judged inside the browser page
    // instead, which changes what the run reports and nothing else.
    isPageProbed: () => false
  })
}))

const { requireClaimSession, claimCredentials } = await import('@main/services/claimSession.service')

beforeEach(() => {
  state.autoLogin = true
  state.local = null
  state.stored = null
  state.credential = { username: 'seller@example.com', password: 'secret', credentialId: 'cred-1' }
  state.captures = []
  state.captureResult = { success: true, data: {} }
  state.liveness = { reason: 'reused', detail: 'the saved session works' }
  state.allowSignIn = true
})

describe('with the default policy — no automation signs in', () => {
  it('refuses rather than signing in when nothing is saved', async () => {
    state.allowSignIn = false

    await expect(requireClaimSession('nykaa', 'seller@example.com', 'cred-1')).rejects.toThrow(
      /does not sign in/
    )
    expect(state.captures).toEqual([])
  })

  it('refuses to hand back a password for a login when the session cannot stand in', async () => {
    state.allowSignIn = false
    state.local = { sid: 'jar-only' }
    state.stored = { jar: { sid: 'jar-only' } }

    await expect(claimCredentials('nykaa', 'seller@example.com')).rejects.toThrow(/does not sign in/)
    expect(state.captures).toEqual([])
  })

  it('still reuses a session that can stand in — refusing to sign in never blocks a working login', async () => {
    state.allowSignIn = false
    state.local = { sid: 'good' }
    state.stored = { jar: { sid: 'good' }, portalId: 'edbsn123' }

    await expect(claimCredentials('nykaa', 'seller@example.com')).resolves.toMatchObject({
      context: { portalId: 'edbsn123' }
    })
    expect(state.captures).toEqual([])
  })
})

describe('requireClaimSession', () => {
  it('signs in rather than telling the operator to go to another page', async () => {
    await expect(requireClaimSession('nykaa', 'seller@example.com', 'cred-1')).resolves.toEqual({
      sid: 'fresh'
    })

    expect(state.captures).toHaveLength(1)
    expect(state.captures[0]).toMatchObject({ platform: 'nykaa', username: 'seller@example.com' })
  })

  it('bounds the wait, because a claim holds the automation lock while it waits', async () => {
    // Unattended, an unbounded manual window would block every other claim and
    // the bulk run behind a login page nobody is going to complete.
    await requireClaimSession('nykaa', 'seller@example.com', 'cred-1')

    expect(state.captures[0]?.waitMs).toBeGreaterThan(0)
  })

  it('still fails clearly when signing in produced nothing', async () => {
    state.captureResult = { success: false, error: { code: 'X', message: 'window closed' } }

    await expect(requireClaimSession('nykaa', 'seller@example.com')).rejects.toThrow(
      /signing in again did not produce one/
    )
  })
})

describe('claimCredentials — liveness', () => {
  it('renews when the marketplace says the saved session is expired', async () => {
    // The Myntra case: a jar that looks complete, and nine claims that failed
    // with "fetchNewClaim: session expired" before anything checked.
    state.local = { sid: 'looks-fine' }
    state.stored = { jar: { sid: 'looks-fine' }, portalId: 'edbsn123' }
    state.liveness = { reason: 'dead', detail: 'the marketplace rejected the saved session' }

    await claimCredentials('myntra', 'seller@example.com')

    expect(state.captures).toHaveLength(1)
  })

  it('renews on a dead session whichever way the company signs in', async () => {
    // captureSession routes auto vs manual on the same flag; this decides only
    // WHETHER to renew, never how.
    state.autoLogin = true
    state.local = { sid: 'looks-fine' }
    state.stored = { jar: { sid: 'looks-fine' }, portalId: 'edbsn123' }
    state.liveness = { reason: 'dead', detail: 'rejected' }

    await claimCredentials('myntra', 'seller@example.com')

    expect(state.captures).toHaveLength(1)
  })

  it('does NOT renew when liveness cannot be determined', async () => {
    // AJIO has no jar-only probe by design — its check needs a live page, which
    // its runner has and this does not. Renewing on "cannot tell" would sign in
    // before every AJIO claim and throw away a session that works.
    state.local = { sid: 'unknown' }
    state.stored = { jar: { sid: 'unknown' }, portalId: 'edbsn123' }
    state.liveness = { reason: 'unverifiable', detail: 'no probe for this platform' }

    await claimCredentials('ajio', 'seller@example.com')

    expect(state.captures).toHaveLength(0)
  })

  it('does not renew a session the marketplace accepts', async () => {
    state.local = { sid: 'live' }
    state.stored = { jar: { sid: 'live' }, portalId: 'edbsn123' }
    state.liveness = { reason: 'reused', detail: 'works' }

    await claimCredentials('myntra', 'seller@example.com')

    expect(state.captures).toHaveLength(0)
  })
})

describe('claimCredentials', () => {
  it('renews when the stored session cannot stand in and auto-login is OFF', async () => {
    state.autoLogin = false
    state.local = { sid: 'stale' }
    // No portalId — so no context, so the runner is about to attempt a sign-in
    // it has no password for.
    state.stored = { jar: { sid: 'stale' } }

    await claimCredentials('nykaa', 'seller@example.com')

    expect(state.captures).toHaveLength(1)
  })

  it('leaves the scripted path alone when auto-login is ON', async () => {
    state.autoLogin = true
    state.local = { sid: 'stale' }
    state.stored = { jar: { sid: 'stale' } }

    await claimCredentials('nykaa', 'seller@example.com')

    // The runner signs in by script, exactly as before — nothing to ask anyone.
    expect(state.captures).toHaveLength(0)
  })

  it('does not renew a session that can already stand in for a login', async () => {
    state.autoLogin = false
    state.local = { sid: 'live' }
    state.stored = { jar: { sid: 'live' }, portalId: 'edbsn123' }

    const credentials = await claimCredentials('nykaa', 'seller@example.com')

    expect(state.captures).toHaveLength(0)
    expect(credentials.context).toEqual({ portalId: 'edbsn123' })
  })
})
