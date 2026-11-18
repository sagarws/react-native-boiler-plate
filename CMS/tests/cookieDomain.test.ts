import { describe, expect, it } from 'vitest'
import { domainMatches } from '@shared/utils/cookieDomain'

describe('domainMatches', () => {
  it('matches an exact host', () => {
    expect(domainMatches('seller.ajio.com', 'seller.ajio.com')).toBe(true)
  })

  it('ignores a leading dot on either side', () => {
    // Chromium stores a domain-wide cookie as ".ajio.com"; the registry lists
    // it both ways. They are the same domain.
    expect(domainMatches('.ajio.com', 'ajio.com')).toBe(true)
    expect(domainMatches('ajio.com', '.ajio.com')).toBe(true)
    expect(domainMatches('.ajio.com', '.ajio.com')).toBe(true)
  })

  it('matches a subdomain of the wanted domain', () => {
    // AJIO splits its session across the apex and the seller subdomain.
    expect(domainMatches('seller.ajio.com', '.ajio.com')).toBe(true)
    expect(domainMatches('.seller.ajio.com', 'ajio.com')).toBe(true)
  })

  it('does not match a different domain that merely ends the same way', () => {
    // The bug a bare endsWith would introduce. Shipping a third party's
    // cookies to the backend as a seller session is worse than shipping none.
    expect(domainMatches('notajio.com', 'ajio.com')).toBe(false)
    expect(domainMatches('evil-ajio.com', 'ajio.com')).toBe(false)
  })

  it('does not match a parent of the wanted domain', () => {
    // Asking for seller.ajio.com must not sweep in every .ajio.com cookie.
    expect(domainMatches('ajio.com', 'seller.ajio.com')).toBe(false)
  })

  it('is case-insensitive', () => {
    expect(domainMatches('Seller.AJIO.com', 'seller.ajio.com')).toBe(true)
  })

  it('is false for empty input', () => {
    expect(domainMatches('', 'ajio.com')).toBe(false)
    expect(domainMatches('ajio.com', '')).toBe(false)
  })
})
