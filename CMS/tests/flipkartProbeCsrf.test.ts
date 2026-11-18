import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * The token a Flipkart session probe cannot ask without.
 *
 * Flipkart signs every API call with `fk-csrf-token`, double-submit against a
 * cookie: the header and the cookie must agree, and it answers 403
 * EBADCSRFTOKEN the moment the header is absent. The token lives BESIDE the jar,
 * not in it — so a probe handed only cookies sends no header and is refused by
 * its own malformed request.
 *
 * Observed 2026-09-19: a capture that signed in cleanly — OTP accepted,
 * dashboard reached, nineteen cookies harvested — was reported as
 * "Flipkart does not recognise the session that was captured", every time,
 * because the probe at capture time was passed `body.jar` and nothing else.
 *
 * What is pinned here is that the token is recoverable from the jar alone, so
 * the probe can always be given one.
 */

interface FlipkartExtras {
  platform: string
  required: string[]
  fromJar: (jar: { name: string; value: string }[]) => {
    csrfToken?: string
    warning?: string
    error?: string
  }
  CSRF_COOKIE_NAME: string
}

const extras = require_(
  '@trackvid/automation-core/platforms/flipkart/common/sessionExtras'
) as FlipkartExtras

/** A token of the documented shape. Not a real one. */
const TOKEN = 'JzRq1dXU-xfSW3HQfPsbi6C8geegObhMgcgQ'

/**
 * The cookie NAMES from the 2026-09-19 capture, with invented values.
 *
 * Kept realistic on purpose: the analytics noise is what a heuristic has to
 * survive, and an earlier version of this matching allowed hyphens in the tail,
 * so a 36-character MoEngage UUID matched the shape and every API call 403'd
 * with the session looking healthy.
 */
const CAPTURED = [
  { name: 'AMCVS_55CFEDA0570C3FA17F000101%40AdobeOrg', value: '1' },
  { name: 'DID', value: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890' },
  { name: 'T', value: 'BR1234567890' },
  { name: extras.CSRF_COOKIE_NAME, value: TOKEN },
  { name: '_fbp', value: 'fb.1.1700000000000.1234567890' },
  { name: '_ga', value: 'GA1.2.1234567890.1700000000' },
  { name: '_gcl_au', value: '1.1.123456789.1700000000' },
  { name: 'connect.sid', value: 's%3Aabcdef.ghijkl' },
  { name: 'is_login', value: 'true' },
  { name: 'moe_uuid', value: 'abcdefab-1234-5678-9abc-def012345678' },
  { name: 'nonce', value: 'abc123' },
  { name: 'sellerId', value: 'SELLER123' }
]

describe('the Flipkart CSRF token', () => {
  it('is recoverable from the captured jar, with no page access', () => {
    // This is why the probe can always be given one: nothing has to be read off
    // a live page, so a capture that has cookies has the token too.
    expect(extras.fromJar(CAPTURED).csrfToken).toBe(TOKEN)
  })

  it('is what the session is declared to require', () => {
    expect(extras.required).toContain('csrfToken')
  })

  it('is not confused by the analytics UUIDs sitting beside it', () => {
    // moe_uuid is 36 characters and once matched the shape. If it wins here,
    // every API call 403s while the session looks perfectly healthy.
    const found = extras.fromJar(CAPTURED).csrfToken

    expect(found).not.toBe('abcdefab-1234-5678-9abc-def012345678')
    expect(found).not.toContain('-1234-')
  })

  it('says so, rather than guessing, when the jar carries no token', () => {
    const withoutToken = CAPTURED.filter(cookie => cookie.name !== extras.CSRF_COOKIE_NAME)
    const result = extras.fromJar(withoutToken)

    expect(result.csrfToken).toBeFalsy()
    expect(result.error).toBeTruthy()
  })
})

/**
 * And the contract the capture-time probe relies on: the core spreads a third
 * argument into the record its platform probes read.
 */
interface ProbeModule {
  probePlatformSession: (platform: string, jar: unknown, extra?: unknown) => Promise<unknown>
}

const probe = require_('@trackvid/automation-core/common/probeSession') as ProbeModule

describe('the probe entry point', () => {
  it('accepts the extras alongside the jar', () => {
    // Three parameters, not two. Passing only the jar is what sent Flipkart a
    // request with no CSRF header and read the 403 as a dead session.
    expect(probe.probePlatformSession.length).toBeGreaterThanOrEqual(2)
    expect(typeof probe.probePlatformSession).toBe('function')
  })

  it('answers null for a platform it has no probe for, rather than false', () => {
    // null means "cannot tell" and must never block a capture; false means the
    // marketplace actually said no. Collapsing them would refuse real sessions.
    return expect(probe.probePlatformSession('ajio', {}, {})).resolves.toBeNull()
  })
})
