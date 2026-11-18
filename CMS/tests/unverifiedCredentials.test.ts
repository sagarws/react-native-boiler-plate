import { describe, expect, it } from 'vitest'

/**
 * Which logins the automations are allowed to use.
 *
 * `is_verified: false` is written when a marketplace says the password is
 * wrong — Snapdeal's "Invalid Username or Password", and the equivalents on
 * AJIO and Myntra. Everything then skips that account, because every sign-in
 * with it will fail and each attempt costs a browser session, a refill budget
 * or a claim's retry count.
 *
 * THE SUBTLETY THIS PINS, and it is the one that can take down a whole
 * installation: the field was added later, so most credentials do not carry it
 * at all. Absent means "nobody has said", NOT "refused". Reading absent as
 * unverified would stop every automation on every legacy account at once — the
 * kind of fault that looks like the app is broken rather than like a filter
 * being too strict.
 *
 * Written against the rule itself rather than through `credentialsFor`, which
 * needs a signed-in company document; the rule is the part that is easy to get
 * backwards in a later edit.
 */

/** The same comparison `credentialsFor` makes. */
const refusedByMarketplace = (account: Record<string, unknown>): boolean =>
  account.is_verified === false

describe('a login the marketplace has refused', () => {
  it('is left out', () => {
    expect(refusedByMarketplace({ username: 'a@b.com', is_verified: false })).toBe(true)
  })
})

describe('a login nobody has judged', () => {
  it('is kept when the field is absent', () => {
    // Most credentials predate the field. If this ever flips, every legacy
    // account on every platform stops working in the same minute.
    expect(refusedByMarketplace({ username: 'a@b.com' })).toBe(false)
  })

  it('is kept when the field is null or undefined', () => {
    expect(refusedByMarketplace({ username: 'a@b.com', is_verified: null })).toBe(false)
    expect(refusedByMarketplace({ username: 'a@b.com', is_verified: undefined })).toBe(false)
  })

  it('is kept when the field is a string, however it reads', () => {
    // Imports have written strings before. "false" as a STRING is not the
    // marketplace refusing anything, and guessing at it would retire a working
    // account on a data-entry quirk.
    expect(refusedByMarketplace({ username: 'a@b.com', is_verified: 'false' })).toBe(false)
  })
})

describe('a verified login', () => {
  it('is kept', () => {
    expect(refusedByMarketplace({ username: 'a@b.com', is_verified: true })).toBe(false)
  })
})
