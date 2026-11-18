import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * "Who am I?" — the question the Sessions screen's Check now asks.
 *
 * Every portal has one endpoint whose whole job is to name the account behind a
 * session. The per-platform probes ask a BUSINESS question instead — list
 * product types, search returns — and a business endpoint fails for business
 * reasons: no returns this week, or a header it wanted and did not get. Every
 * one of those reads as "signed out", and that has been expensive: Flipkart's
 * probe was refused 403 EBADCSRFTOKEN over a missing header and a perfectly
 * good session was reported dead, every time, for a day.
 *
 * WHAT IS PINNED HERE IS THE TRI-STATE, because that is the part that hurts
 * when it is wrong. `false` marks a session dead and sends an operator to
 * re-capture; `null` means "cannot tell" and must leave the session alone.
 * Collapsing null into false is how a working account gets quarantined by its
 * own health check.
 */

interface Identity {
  ok: true | false | null
  who: string | null
  detail: string
  status: number | null
}

interface SessionIdentity {
  checkSessionIdentity: (
    platform: string,
    record: unknown,
    options?: { logger?: unknown }
  ) => Promise<Identity>
  hasIdentityCheck: (platform: string) => boolean
  renewsOnCheck: (platform: string) => boolean
  IDENTITY_PLATFORMS: string[]
  RENEW_ON_CHECK: string[]
}

/** The next canned response, and the request that asked for it. */
const next: { status: number; data: unknown; headers?: Record<string, string> } = {
  status: 200,
  data: {}
}
let sent: { url?: string; method?: string; headers?: Record<string, string>; data?: unknown } | null =
  null

/** Node's require cache, not vi.mock — the core is CJS behind createRequire. */
const axiosPath = require_.resolve('axios')

require_.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: (config: typeof sent) => {
    sent = config

    if (next.status === 0) return Promise.reject(new Error('socket hang up'))

    return Promise.resolve({ status: next.status, data: next.data, headers: next.headers ?? {} })
  }
} as unknown as NodeJS.Module

const {
  checkSessionIdentity,
  hasIdentityCheck,
  renewsOnCheck,
  IDENTITY_PLATFORMS,
  RENEW_ON_CHECK
} = require_('@trackvid/automation-core/common/sessionIdentity') as SessionIdentity

beforeEach(() => {
  sent = null
  next.status = 200
  next.data = {}
  next.headers = {}
})

describe('which platforms can be asked', () => {
  it('covers the seven with a captured identity endpoint', () => {
    expect([...IDENTITY_PLATFORMS].sort()).toEqual([
      'ajio',
      'delhivery',
      'flipkart',
      'meesho',
      'myntra',
      'nykaa',
      'snapdeal'
    ])
  })

  it('says nothing about the ones it cannot ask, rather than guessing', async () => {
    // Tata CliQ can only be judged inside a live page; Xbees is renewed rather
    // than checked. Absent means null, which means "let the old probe answer"
    // — never "dead".
    for (const platform of ['tatacliq', 'xbees']) {
      expect(hasIdentityCheck(platform)).toBe(false)
      expect((await checkSessionIdentity(platform, { jar: { a: '1' } })).ok).toBeNull()
    }
  })

  it('marks Xbees as renewed rather than checked, and nothing else', () => {
    // Its session is a bearer token from one API call, so signing in again
    // settles the question AND leaves a fresh token. Delhivery is the same
    // shape deliberately left out: it has an identity endpoint, and a check
    // that quietly triggers logins is one nobody can run casually.
    expect(renewsOnCheck('xbees')).toBe(true)
    expect(RENEW_ON_CHECK).toEqual(['xbees'])

    for (const platform of ['delhivery', 'ajio', 'myntra', 'flipkart']) {
      expect(renewsOnCheck(platform)).toBe(false)
    }
  })
})

describe('AJIO, which could not be checked at all before', () => {
  it('reads the explicit flag', async () => {
    next.data = { authenticated: true, data: { username: 'info@example.com' } }

    const result = await checkSessionIdentity('ajio', { jar: { bff_session: 'x' } })

    expect(result.ok).toBe(true)
    expect(result.who).toBe('info@example.com')
  })

  it('takes authenticated:false at its word', async () => {
    next.data = { authenticated: false }

    expect((await checkSessionIdentity('ajio', { jar: { bff_session: 'x' } })).ok).toBe(false)
  })

  it('sends the jar as cookies even though AJIO stores an ARRAY', async () => {
    // AJIO is the one platform whose jar is an array of whole cookies. The
    // shared cookieHeader helper only understands the map form and would send
    // "0=[object Object]".
    next.data = { authenticated: true, data: { username: 'a@b.c' } }

    await checkSessionIdentity('ajio', { jar: [{ name: 'bff_session', value: 'abc' }] })

    expect(sent?.headers?.['cookie']).toBe('bff_session=abc')
  })
})

describe('Flipkart, where a wrong verdict has already cost a day', () => {
  it('names the seller when the portal answers', async () => {
    next.data = { data: [{ profileInfo: { sellerId: 'abc', emailId: 'ops@example.com' } }] }

    const result = await checkSessionIdentity('flipkart', {
      jar: { sellerId: 'abc' },
      csrfToken: 'tok-1234'
    })

    expect(result.ok).toBe(true)
    expect(result.who).toBe('ops@example.com')
    expect(sent?.headers?.['fk-csrf-token']).toBe('tok-1234')
  })

  it('treats a CSRF refusal as OUR problem, not a dead session', async () => {
    // The exact bug this whole file is a reaction to. A 403 about the token is
    // a statement about the request we sent.
    next.status = 403
    next.data = { error: { code: 'EBADCSRFTOKEN' } }

    const result = await checkSessionIdentity('flipkart', {
      jar: { sellerId: 'abc' },
      csrfToken: 'stale'
    })

    expect(result.ok).toBeNull()
    expect(result.ok).not.toBe(false)
  })

  it('falls back to the sellerId cookie when the record has none', async () => {
    next.data = { data: [{ profileInfo: { sellerId: 'from-cookie' } }] }

    const result = await checkSessionIdentity('flipkart', {
      jar: { sellerId: 'from-cookie' },
      csrfToken: 'tok'
    })

    expect(result.ok).toBe(true)
    expect(sent?.url).toContain('sellerId=from-cookie')
  })

  it('will not ask at all without a token, and says so instead of guessing', async () => {
    const result = await checkSessionIdentity('flipkart', { jar: { sellerId: 'abc' } })

    expect(result.ok).toBeNull()
    expect(sent).toBeNull()
  })
})

describe('the other four', () => {
  it('Snapdeal: the login PAGE arrives as a 200, and is a refusal', async () => {
    next.data = '<!doctype html><html>sign in</html>'

    expect((await checkSessionIdentity('snapdeal', { jar: { JSESSIONID: 'x' } })).ok).toBe(false)
  })

  it('Snapdeal: a profile is a yes', async () => {
    next.data = { companyName: 'ACME', primaryEmail: 'seller@example.com', active: true }

    const result = await checkSessionIdentity('snapdeal', { jar: { JSESSIONID: 'x' } })

    expect(result.ok).toBe(true)
    expect(result.who).toBe('seller@example.com')
  })

  it('Nykaa: needs the portal id it is addressed by', async () => {
    expect((await checkSessionIdentity('nykaa', { jar: { stk: 'x' } })).ok).toBeNull()
    expect(sent).toBeNull()

    next.data = { emailId: 'ops@example.com', displayName: 'ops' }

    expect((await checkSessionIdentity('nykaa', { jar: { stk: 'x' }, portalId: 'p1' })).ok).toBe(
      true
    )
  })

  it('Meesho: sends the ids and the forwarded browser-id', async () => {
    next.data = { enable_new_theme: { enabled: true } }

    const result = await checkSessionIdentity('meesho', {
      jar: { browser_id: 'QUJD%3D%3D', 'connect.sid': 'x' },
      supplierId: 605138,
      supplierIdentifier: 'fktsk'
    })

    expect(result.ok).toBe(true)
    expect(sent?.headers?.['identifier']).toBe('fktsk')
    expect(sent?.headers?.['supplier-id']).toBe('605138')
    // Percent-decoded, like every other Meesho call.
    expect(sent?.headers?.['browser-id']).toBe('QUJD==')
  })

  it('Myntra: reads the BODY, because 200 is answered to anyone', async () => {
    // Signed out, the same boot endpoint returns 200 with the anonymous
    // payload. Status alone has never been evidence here.
    next.data = { someFlag: true }

    expect((await checkSessionIdentity('myntra', { jar: { 'erp.at': 'x' } })).ok).toBe(false)
  })

  it('Myntra: wants a NAMED USER and a partner behind them', async () => {
    /*
     * This asked for an id and a non-empty `sellerType`, on the reasoning that
     * an id alone was the anonymous payload wearing half a costume. Recorded
     * traffic disproved it and named the cost: a VENDOR account
     * (partnerType VENDOR, partnerCode DYVY, partnerId 14880, sellerId 0) has
     * an EMPTY sellerType, because sellerType classifies SELLERS — PPMP, FBM,
     * SJIT — and a vendor is not one. Every vendor account on the platform was
     * refused while the payload named the signed-in user on the same line.
     *
     * So: does the marketplace name somebody, and is there a partner behind
     * them. That is the question this whole file exists to ask.
     */
    next.data = { partnerId: 23026 }

    // A partner with nobody behind it is not a session.
    expect((await checkSessionIdentity('myntra', { jar: { 'erp.at': 'x' } })).ok).toBe(false)

    next.data = { user: { loginId: 'ops@example.com' } }

    // And a name with no partner is not one either.
    expect((await checkSessionIdentity('myntra', { jar: { 'erp.at': 'x' } })).ok).toBe(false)

    // The vendor shape, which used to be refused.
    next.data = {
      partnerId: '14880',
      partnerCode: 'DYVY',
      sellerId: 0,
      sellerType: [],
      user: { loginId: 'listing@mozafia.com' }
    }

    const result = await checkSessionIdentity('myntra', { jar: { 'erp.at': 'x' } })

    expect(result.ok).toBe(true)
    // The ACCOUNT, not an internal id: this is read out loud in a log line and
    // to whoever is being asked what their screen says.
    expect(result.who).toBe('listing@mozafia.com')
    expect(sent?.url).toContain('/api/boot/partners')
  })

  it('Delhivery: the token IS the session, and there is no jar', async () => {
    next.data = { email: 'ops@example.com', ucp_roles: ['company_user'] }

    const result = await checkSessionIdentity('delhivery', { jar: {}, accessToken: 'jwt-here' })

    expect(result.ok).toBe(true)
    expect(sent?.headers?.['authorization']).toBe('Bearer jwt-here')
  })
})

describe('everything that is not an answer', () => {
  it('a 5xx is the portal having a bad day, not a dead session', async () => {
    next.status = 503
    next.data = ''

    expect((await checkSessionIdentity('snapdeal', { jar: { a: '1' } })).ok).toBeNull()
  })

  it('a network failure says nothing at all', async () => {
    next.status = 0

    expect((await checkSessionIdentity('snapdeal', { jar: { a: '1' } })).ok).toBeNull()
  })

  it('a redirect to a login page is the clearest refusal there is', async () => {
    next.status = 302
    next.headers = { location: 'https://seller.snapdeal.com/login' }

    expect((await checkSessionIdentity('snapdeal', { jar: { a: '1' } })).ok).toBe(false)
  })

  it('a redirect somewhere else is not', async () => {
    next.status = 302
    next.headers = { location: 'https://seller.snapdeal.com/dashboard' }

    expect((await checkSessionIdentity('snapdeal', { jar: { a: '1' } })).ok).toBeNull()
  })

  it('no stored session is not a verdict on one', async () => {
    expect((await checkSessionIdentity('ajio', null)).ok).toBeNull()
  })
})
