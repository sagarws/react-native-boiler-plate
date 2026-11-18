import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Nykaa's dispute portal guards WRITES with a double-submit CSRF token and
 * leaves READS unguarded. That asymmetry is what made this so hard to see: a
 * jar with no CSRF cookie passes every probe, indexes hundreds of tickets, and
 * is refused on the first ticket it tries to raise — with a 401 that reads
 * exactly like a dead session.
 *
 * Two things are pinned here.
 *
 * ONE: the cookie is `zd_hccsr` — Zoho Desk's HELP CENTER csrf cookie. This is
 * not a guess: in a captured working POST /portal/api/tickets the
 * X-ZCSRF-TOKEN value is byte-for-byte that cookie. It is emphatically NOT
 * `crmcsr` (Zoho CRM's, which this code assumed for months) and not `iamcsr`
 * (the account cookie the sign-in uses, which is present in every jar and would
 * sign a write with a confidently wrong token).
 *
 * TWO: the header's parameter name is independent of whichever cookie supplied
 * the value. Tying them together would send `iamcsrcoo=` on a ticket write,
 * which the portal does not accept.
 */

const require_ = createRequire(import.meta.url)

const store = require_('@trackvid/automation-core/platforms/nykaa/common/sessionStore') as {
  resolveCsrfCookie: (jar: unknown) => { name: string; value: string } | null
  canWrite: (jar: unknown) => boolean
  CSRF_COOKIE_CANDIDATES: string[]
}

const flow = require_(
  '@trackvid/automation-core/platforms/nykaa/claim-management/api-based-flow/claimApiFlow'
) as { csrfToken: (jar: unknown, param?: string) => string | null }

/** The cookie names from a real, working ticket-creation request. */
const REAL_JAR = {
  zalb_4c83295851: 'adbaafb8cd04a7c06d8b7c9be3dab91b',
  JSESSIONID: 'F79E9AE4F05B5E8DDF917C04EEE1A261',
  iamcsr: '61b84bb0-eeed-4b3a-8988-f59dd2047cf8',
  stk: 'b78d411c2034577fb53ab078cca3c945',
  _z_identity: 'true',
  zd_hccsr: 'e20471908c0be01395aa6e2017647958'
}

describe('resolveCsrfCookie', () => {
  it('picks zd_hccsr out of a real jar', () => {
    expect(store.resolveCsrfCookie(REAL_JAR)).toEqual({
      name: 'zd_hccsr',
      value: REAL_JAR.zd_hccsr
    })
  })

  it('never prefers the IAM cookie, which is in every jar and signs the wrong thing', () => {
    expect(store.resolveCsrfCookie({ iamcsr: 'iam', zd_hccsr: 'desk' })?.name).toBe('zd_hccsr')
    expect(store.resolveCsrfCookie({ iamcsr: 'iam', crmcsr: 'crm' })?.name).toBe('crmcsr')
  })

  it('falls back on shape when Zoho renames it, so it costs a log line not a batch', () => {
    // Longest value wins: the Desk token is 128 hex characters, IAM's is a UUID.
    const renamed = { iamcsr: 'x'.repeat(36), zd_somethingcsr_new: 'y'.repeat(128) }

    expect(store.resolveCsrfCookie(renamed)?.name).toBe('zd_somethingcsr_new')
  })

  it('uses the IAM cookie only as a last resort', () => {
    expect(store.resolveCsrfCookie({ iamcsr: 'only-this' })?.name).toBe('iamcsr')
  })

  it('reports a jar that cannot write, rather than letting it 401 later', () => {
    // This is the jar the API flow had been reusing for weeks: it authenticates
    // every read and cannot raise a single ticket.
    expect(store.canWrite({ JSESSIONID: 'live', _z_identity: 'true' })).toBe(false)
    expect(store.canWrite({})).toBe(false)
    expect(store.canWrite(null)).toBe(false)
    expect(store.canWrite(REAL_JAR)).toBe(true)
  })
})

describe('csrfToken', () => {
  it('reproduces the header of the known-good request exactly', () => {
    expect(flow.csrfToken(REAL_JAR)).toBe(`crmcsrfparam=${REAL_JAR.zd_hccsr}`)
  })

  it('always sends the ticket endpoint parameter name, whichever cookie supplied the value', () => {
    // The parameter does NOT follow the cookie. Tying them together would send
    // `zd_hccsr=` on a write, which the portal does not accept.
    expect(flow.csrfToken({ crmcsr: 'VAL' })).toBe('crmcsrfparam=VAL')
    expect(flow.csrfToken({ zd_hccsr: 'VAL' })).toBe('crmcsrfparam=VAL')
  })

  it('honours an explicit parameter override, for the retry with the alternate spelling', () => {
    expect(flow.csrfToken({ crmcsr: 'VAL' }, 'deskcsrfparam')).toBe('deskcsrfparam=VAL')
  })

  it('sends no header at all when there is nothing to sign with', () => {
    expect(flow.csrfToken({ JSESSIONID: 'live' })).toBeNull()
  })
})
