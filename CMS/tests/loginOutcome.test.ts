import { describe, expect, it } from 'vitest'
import { urlMatches } from '@shared/utils/loginOutcome'

describe('urlMatches', () => {
  it('matches a positive fragment', () => {
    expect(urlMatches('https://seller.ajio.com/dashboard', { urlIncludes: ['seller.ajio.com'] })).toBe(true)
  })

  it('does not match a positive fragment that is absent', () => {
    expect(urlMatches('https://sso.relianceretail.com/authorize', { urlIncludes: ['seller.ajio.com'] })).toBe(
      false
    )
  })

  it('treats leaving the login route as success', () => {
    expect(urlMatches('https://supplier.meesho.com/panel/v3/new/', { urlExcludes: ['/login'] })).toBe(true)
  })

  it('does not treat staying on the login route as success', () => {
    expect(urlMatches('https://supplier.meesho.com/login', { urlExcludes: ['/login'] })).toBe(false)
  })

  it('never calls a blank window a success', () => {
    // The window starts at about:blank, which trivially "does not contain
    // /login". Matching there would report success before the form was ever
    // submitted, and the capture would harvest an empty jar.
    expect(urlMatches('about:blank', { urlExcludes: ['/login'] })).toBe(false)
    expect(urlMatches('', { urlExcludes: ['/login'] })).toBe(false)
  })

  it('is false for a match with no url rules', () => {
    // Selector-only matches are the driver's job; this half must abstain
    // rather than guess.
    expect(urlMatches('https://anything', { anySelector: ['#nav_24 a'] })).toBe(false)
  })

  it('is false when there is no match to test', () => {
    expect(urlMatches('https://anything', undefined)).toBe(false)
  })

  it('prefers a positive hit over an exclusion miss', () => {
    // Both rules present: an explicit include is stronger evidence than the
    // absence of an exclude.
    const match = { urlIncludes: ['/error'], urlExcludes: ['/error'] }

    expect(urlMatches('https://portal/error', match)).toBe(true)
  })
})
