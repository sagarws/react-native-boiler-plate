import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The Username column on the claims list.
 *
 * Every platform keeps its account somewhere different, and the app carried its
 * own partial list of those places: AJIO, Meesho, Snapdeal, and nothing else.
 * So a Flipkart, Delhivery, Xbees, Myntra or Nykaa claim showed an empty
 * Username no matter what was stored on it — and that is worse than cosmetic,
 * because the row-selection gate reads that column: a Flipkart claim with a
 * perfectly good account could not be ticked.
 *
 * The fix was to stop having a second list. These tests pin the one that
 * remains — the core's, which is the same knowledge TrackVid-BE groups by
 * before handing a claim to a runner.
 */

const require_ = createRequire(import.meta.url)

const { claimAccountUsername, ACCOUNT_FIELDS } = require_(
  '@trackvid/automation-core/common/claimAccount'
) as {
  claimAccountUsername: (platform: string, doc: unknown) => string | null
  ACCOUNT_FIELDS: Record<string, string[]>
}

describe('claimAccountUsername', () => {
  it('reads the flat fields', () => {
    expect(claimAccountUsername('Ajio', { ajio_account_email: 'info@tigc.in' })).toBe(
      'info@tigc.in'
    )
    expect(claimAccountUsername('Meesho', { meesho_account_email: 'a@b.com' })).toBe('a@b.com')
    expect(claimAccountUsername('Snapdeal', { snapdeal_account_username: 'sd' })).toBe('sd')
  })

  it('reads the NESTED ones the app used to miss', () => {
    // The reported bug: a Flipkart claim with `otherClaimDetails.username` set
    // showed a blank Username in the desktop list.
    expect(
      claimAccountUsername('Flipkart', {
        otherClaimDetails: { username: 'murlifashion0227@gmail.com' }
      })
    ).toBe('murlifashion0227@gmail.com')

    // Three platforms share that bundle, exactly as the server's grouping does.
    for (const platform of ['Delhivery', 'Xbees']) {
      expect(claimAccountUsername(platform, { otherClaimDetails: { username: 'x@y.com' } })).toBe(
        'x@y.com'
      )
    }

    expect(claimAccountUsername('Myntra', { myntraClaimDetails: { username: 'm@y.com' } })).toBe(
      'm@y.com'
    )
    expect(claimAccountUsername('Nykaa', { nykaaClaimDetails: { username: 'n@y.com' } })).toBe(
      'n@y.com'
    )
  })

  it('covers every platform the map claims to', () => {
    // A platform in the map with no working read is the bug this file exists
    // for, one release later.
    for (const [platform, fields] of Object.entries(ACCOUNT_FIELDS)) {
      const path = fields[0] as string
      const doc: Record<string, unknown> = {}
      const [head, tail] = path.split('.')

      if (tail) doc[head as string] = { [tail]: 'someone@example.com' }
      else doc[head as string] = 'someone@example.com'

      expect(claimAccountUsername(platform, doc)).toBe('someone@example.com')
    }
  })

  it('matches whatever casing the document stores', () => {
    // The list stores "Ajio"; the map is keyed lowercase.
    expect(claimAccountUsername('AJIO', { ajio_account_email: 'a@b.com' })).toBe('a@b.com')
    expect(claimAccountUsername(' ajio ', { ajio_account_email: 'a@b.com' })).toBe('a@b.com')
  })

  it('answers null rather than a blank when the row names nobody', () => {
    // A real answer: Nykaa carries no per-row account at all, so a caller that
    // gets null should look the account up by platform rather than treat the
    // claim as broken.
    expect(claimAccountUsername('Flipkart', {})).toBeNull()
    expect(claimAccountUsername('Flipkart', { otherClaimDetails: {} })).toBeNull()
    expect(claimAccountUsername('Flipkart', { otherClaimDetails: { username: '   ' } })).toBeNull()
  })

  it('covers the two platforms the server never dispatches', () => {
    // Tata CliQ and Amazon have no automation, so TrackVid-BE's grouping does
    // not reach them — but the CMS model stores their account in the same
    // bundle, and the Username column is a display, not a dispatch. Leaving
    // them out showed a blank for a claim that names an account perfectly well.
    for (const platform of ['Tata CliQ', 'Amazon']) {
      expect(claimAccountUsername(platform, { otherClaimDetails: { username: 'x@y.com' } })).toBe(
        'x@y.com'
      )
    }
  })

  it('ignores a platform that is not in the map at all', () => {
    expect(claimAccountUsername('Shopify', { otherClaimDetails: { username: 'x' } })).toBeNull()
    expect(claimAccountUsername('', { ajio_account_email: 'a@b.com' })).toBeNull()
  })
})
