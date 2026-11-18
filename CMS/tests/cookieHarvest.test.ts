import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { domainMatches } from '@shared/utils/cookieDomain'

/**
 * Nykaa's portal is served from dispute.nykaa.com but signs in through Zoho
 * Desk, and the CSRF cookie the write APIs demand is set on a zoho host.
 *
 * Harvesting only the nykaa domains produced a jar that passed every read —
 * reads are not CSRF-guarded — and was refused on the first write with a 401
 * that reads exactly like a dead session. These tests pin the two halves of the
 * fix: the domain filter keeps the zoho cookies, and a flat jar resolves a name
 * collision in favour of the origin actually being called.
 */

const require_ = createRequire(import.meta.url)

const { toJar } = require_('@trackvid/automation-core/common/cookieHarvest') as {
  toJar: (
    cookies: { name: string; value: string; domain: string }[],
    options?: { domains?: string[]; preferDomains?: string[] }
  ) => Record<string, string>
}

const { getPlatform } = require_('@trackvid/automation-core/common/platforms') as {
  getPlatform: (key: string) => { cookieDomains: string[] }
}

const NYKAA_FILTER = { domains: ['nykaa', 'zoho'], preferDomains: ['dispute.nykaa.com'] }

describe('toJar', () => {
  it('keeps the CSRF cookie even though it is set on a different host', () => {
    const jar = toJar(
      [
        { name: 'portal_sid', value: 'a', domain: 'dispute.nykaa.com' },
        { name: 'crmcsr', value: 'the-csrf-value', domain: '.zoho.in' }
      ],
      NYKAA_FILTER
    )

    expect(jar.crmcsr).toBe('the-csrf-value')
  })

  it('drops cookies from hosts that have nothing to do with the portal', () => {
    const jar = toJar(
      [
        { name: 'portal_sid', value: 'a', domain: 'dispute.nykaa.com' },
        { name: 'tracker', value: 'nope', domain: '.doubleclick.net' }
      ],
      NYKAA_FILTER
    )

    expect(jar.tracker).toBeUndefined()
    expect(jar.portal_sid).toBe('a')
  })

  it('lets the portal host win a name collision with an IAM host', () => {
    // A flat jar has one slot per name. Sending Zoho's value for a cookie the
    // portal also sets would authenticate as the wrong thing.
    const jar = toJar(
      [
        { name: 'csrf', value: 'from-zoho', domain: 'desk.zoho.in' },
        { name: 'csrf', value: 'from-portal', domain: 'dispute.nykaa.com' }
      ],
      NYKAA_FILTER
    )

    expect(jar.csrf).toBe('from-portal')
  })

  it('keeps everything when no filter is given', () => {
    const jar = toJar([{ name: 'anything', value: 'kept', domain: '.example.com' }])

    expect(jar.anything).toBe('kept')
  })
})

describe('the nykaa capture domains', () => {
  it('covers the zoho hosts the sign-in actually sets cookies on', () => {
    const { cookieDomains } = getPlatform('nykaa')

    // The capture window filters with domainMatches, so a registry entry that
    // does not match these is a jar with no CSRF cookie in it.
    expect(cookieDomains.some(wanted => domainMatches('accounts.zoho.in', wanted))).toBe(true)
    expect(cookieDomains.some(wanted => domainMatches('desk.zoho.in', wanted))).toBe(true)
    expect(cookieDomains.some(wanted => domainMatches('dispute.nykaa.com', wanted))).toBe(true)
  })

  it('still refuses a lookalike domain', () => {
    const { cookieDomains } = getPlatform('nykaa')

    expect(cookieDomains.some(wanted => domainMatches('notzoho.in', wanted))).toBe(false)
    expect(cookieDomains.some(wanted => domainMatches('evil-nykaa.com', wanted))).toBe(false)
  })
})
