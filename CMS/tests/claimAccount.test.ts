import { describe, expect, it } from 'vitest'
import {
  claimAccountUsername,
  usesCompanyWideAccount
} from '@trackvid/automation-core/common/claimAccount'
import {
  claimContextFromSession,
  missingContextFields
} from '@trackvid/automation-core/common/claimContext'
import { cookieHeader } from '@trackvid/automation-core/common/sessionHelpers'

/**
 * Every platform keeps its account somewhere different, and none of them keep
 * it in an `account` object.
 *
 * All seven desktop runners read `doc.account?.username`, a field
 * `/cms/find-by-awb` has never returned — so the first desktop claim ever run
 * failed with "The claim has no marketplace account attached" while the
 * credential sat in the company document all along. The mapping here is
 * TrackVid-BE's own grouping in `triggerPuppeteerForCms.ts`.
 */
describe('claimAccountUsername', () => {
  it('reads each platform from the field the backend groups by', () => {
    expect(claimAccountUsername('ajio', { ajio_account_email: 'a@b.com' })).toBe('a@b.com')
    expect(claimAccountUsername('meesho', { meesho_account_email: 'm@b.com' })).toBe('m@b.com')
    expect(claimAccountUsername('snapdeal', { snapdeal_account_username: 'sd' })).toBe('sd')
    expect(
      claimAccountUsername('myntra', { myntraClaimDetails: { username: 'usplops@wk.com' } })
    ).toBe('usplops@wk.com')
    expect(claimAccountUsername('nykaa', { nykaaClaimDetails: { username: 'nk' } })).toBe('nk')
  })

  // These three share otherClaimDetails, exactly as the backend's grouping does.
  it('reads flipkart, delhivery and xbees from otherClaimDetails', () => {
    const doc = { otherClaimDetails: { username: 'shared' } }

    for (const platform of ['flipkart', 'delhivery', 'xbees']) {
      expect(claimAccountUsername(platform, doc)).toBe('shared')
    }
  })

  it('is case-insensitive about the platform', () => {
    expect(claimAccountUsername('MYNTRA', { myntraClaimDetails: { username: 'x' } })).toBe('x')
  })

  it('treats a blank field as absent', () => {
    expect(claimAccountUsername('ajio', { ajio_account_email: '   ' })).toBeNull()
    expect(claimAccountUsername('myntra', { myntraClaimDetails: {} })).toBeNull()
  })

  it('does not read another platform\'s field', () => {
    expect(claimAccountUsername('myntra', { ajio_account_email: 'a@b.com' })).toBeNull()
  })

  // Reading it FIRST would let a stale or hand-made value beat the field the
  // backend actually groups by.
  it('falls back to an attached account object, but only last', () => {
    expect(claimAccountUsername('myntra', { account: { username: 'attached' } })).toBe('attached')
    expect(
      claimAccountUsername('myntra', {
        account: { username: 'attached' },
        myntraClaimDetails: { username: 'canonical' }
      })
    ).toBe('canonical')
  })

  it('returns null rather than throwing for an unknown platform', () => {
    expect(claimAccountUsername('newmarket', { anything: 'x' })).toBeNull()
  })
})

describe('usesCompanyWideAccount', () => {
  // Nykaa carries no per-row account — the server falls back to the company's
  // single verified login — so null there is an answer, not a broken row.
  it('knows Nykaa resolves by company login', () => {
    expect(usesCompanyWideAccount('nykaa')).toBe(true)
    expect(usesCompanyWideAccount('myntra')).toBe(false)
  })
})

/**
 * A stored session can stand in for a sign-in — if it is complete.
 *
 * Only `loginSnapdealApi` accepts a `session` option; the other six ignore the
 * jar handed to them and sign in anyway, which is why the desktop opened a
 * browser for every claim while a good session sat in the company document.
 * What a login returns is more than a jar — supplier ids, a csrf token, a
 * portal id, OAuth tokens — and all of it is already on the stored record.
 */
describe('claimContextFromSession', () => {
  it('hands Myntra back a bare jar, which is what its login returns', () => {
    expect(claimContextFromSession('myntra', { jar: { 'erp.at': 'x', session: 'y' } })).toEqual({
      'erp.at': 'x',
      session: 'y'
    })
  })

  // Snapdeal's calls read `ctx.jar`. It once got Myntra's bare jar, so a reused
  // session sent an EMPTY cookie header: the probe passed, then every
  // globalSearch came back HTTP 800 ("Global search failed: HTTP 800").
  it('hands Snapdeal a context whose jar reaches the cookie header', () => {
    const context = claimContextFromSession('snapdeal', {
      jar: { JSESSIONID: 'j', AWSALB: 'a' },
      sellerId: 'S1'
    })

    expect(context).toEqual({ jar: { JSESSIONID: 'j', AWSALB: 'a' }, sellerId: 'S1' })
    expect(cookieHeader((context as { jar: Record<string, string> }).jar)).toBe(
      'JSESSIONID=j; AWSALB=a'
    )
    expect(claimContextFromSession('snapdeal', { jar: { a: '1' } })).toEqual({
      jar: { a: '1' },
      sellerId: null
    })
  })

  it('rebuilds the extras each login discovers', () => {
    expect(claimContextFromSession('meesho', { jar: { a: '1' }, supplierId: 42 })).toEqual({
      jar: { a: '1' },
      supplierId: 42,
      supplierIdentifier: null
    })
    expect(claimContextFromSession('flipkart', { jar: { a: '1' }, csrfToken: 'c' })).toMatchObject({
      csrfToken: 'c'
    })
    expect(claimContextFromSession('nykaa', { jar: { a: '1' }, portalId: 'p' })).toMatchObject({
      portalId: 'p'
    })
  })

  // An incomplete context is worse than none: it fails several API calls later,
  // somewhere that reads like a different bug. Null sends the caller to a login.
  it('returns null when a required extra is missing, and says which', () => {
    // Meesho is deliberately NOT in this list. It used to demand supplierId,
    // and the capture read that id from a response which never carried one — so
    // every stored session was "incomplete" and every run signed in again. The
    // ids are read over HTTP when missing (ensureSupplierIdentity), so cookies
    // that still work are used.
    expect(claimContextFromSession('meesho', { jar: { a: '1' } })).toMatchObject({
      jar: { a: '1' },
      supplierId: undefined
    })
    expect(missingContextFields('meesho', { jar: { a: '1' } })).toEqual([])

    expect(claimContextFromSession('flipkart', { jar: { a: '1' } })).toBeNull()
    expect(claimContextFromSession('myntra', { jar: {} })).toBeNull()
  })

  // Delhivery and Xbees hold OAuth tokens and no cookie jar at all, so an
  // empty jar must not disqualify them.
  it('does not require a jar from the token platforms', () => {
    expect(claimContextFromSession('delhivery', { accessToken: 'tok' })).toMatchObject({
      accessToken: 'tok',
      tokenType: 'Bearer'
    })
    expect(claimContextFromSession('xbees', {})).toBeNull()
  })

  it('returns null for an unknown platform rather than guessing', () => {
    expect(claimContextFromSession('newmarket', { jar: { a: '1' } })).toBeNull()
  })
})

/**
 * A claim must not fail because a field went missing upstream.
 *
 * The operator picks the account on the create form and the row is supposed to
 * carry it — but that has been lost between the form and the database more than
 * once, and "no account attached" is not something the person filing the claim
 * can act on. When the company has exactly ONE credential for that platform
 * there is no ambiguity: every claim on it runs under that account anyway,
 * which is what the form's own dropdown does when it auto-selects a sole entry.
 */
describe('account fallback rules', () => {
  it('prefers the row over anything else', () => {
    expect(
      claimAccountUsername('myntra', { myntraClaimDetails: { username: 'on-the-row' } })
    ).toBe('on-the-row')
  })

  // With more than one credential, guessing would file the dispute from the
  // wrong seller account — worse than stopping and saying so.
  it('has nothing to fall back on when the row is empty', () => {
    expect(claimAccountUsername('myntra', {})).toBeNull()
  })
})
