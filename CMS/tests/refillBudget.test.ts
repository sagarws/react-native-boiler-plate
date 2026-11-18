import { describe, expect, it } from 'vitest'
import { marketplaceDidNotAnswer } from '@main/services/refill.service'

/**
 * What a failed refill ask costs the row.
 *
 * THE CASE THAT FOUND THIS. A Meesho sweep ran twelve rows back to back,
 * Meesho answered two of them with `HTTP 429 — you've made too many requests`,
 * and both were charged one of the row's three refill attempts. The same AWB,
 * refilled by hand minutes later with the same account, filled first try.
 *
 * Three nights of that and the cron retires the row for good — while the button
 * an operator presses still works, which is exactly how it stayed invisible:
 * every manual check of a "broken" row succeeds.
 *
 * So the rule this pins: an ask the marketplace REFUSED TO LOOK AT costs
 * nothing, and an ask it ANSWERED costs one. Getting this backwards in either
 * direction is expensive — too strict retires rows that were never asked, too
 * lax gives a genuinely unanswerable row unlimited browser time, every night,
 * for ever.
 */

describe('an ask the marketplace refused', () => {
  it('recognises a rate limit, however it is worded', () => {
    expect(marketplaceDidNotAnswer('Search returns failed: HTTP 429 {"error":"Too many Requests"}')).toBe(true)
    expect(marketplaceDidNotAnswer("You've made too many requests, please try again after some time.")).toBe(true)
    expect(marketplaceDidNotAnswer('rate limited')).toBe(true)
  })

  it('recognises a gateway that never looked', () => {
    expect(marketplaceDidNotAnswer('Probe rejected session (HTTP 502)')).toBe(true)
    expect(marketplaceDidNotAnswer('HTTP 503 service unavailable')).toBe(true)
    expect(marketplaceDidNotAnswer('socket hang up')).toBe(true)
    expect(marketplaceDidNotAnswer('ETIMEDOUT')).toBe(true)
    expect(marketplaceDidNotAnswer('request timed out')).toBe(true)
  })
})

describe('an ask the marketplace answered', () => {
  it('still costs the row an attempt', () => {
    // These are the cap's whole purpose: the marketplace looked and the row is
    // not there. A fourth ask answers neither, so the budget must run down.
    expect(marketplaceDidNotAnswer('HTTP 400 {"error_message":"Data not found"}')).toBe(false)
    expect(marketplaceDidNotAnswer('No claim found for AWB VLR082874401349')).toBe(false)
    expect(marketplaceDidNotAnswer('SE1: Invalid Awb number')).toBe(false)
    expect(marketplaceDidNotAnswer('INVALID_CREDENTIALS: the marketplace rejected the login')).toBe(false)
  })

  it('does not read an AWB that happens to contain 429 as a rate limit', () => {
    // Word-bounded for this reason: waybills are long digit strings and one in
    // a few hundred carries 429 or 503 somewhere inside it. Treating that row
    // as "never asked" would give it unlimited retries for ever.
    expect(marketplaceDidNotAnswer('No claim found for AWB 1490711784291234')).toBe(false)
    expect(marketplaceDidNotAnswer('No claim found for AWB VLR429503')).toBe(false)
  })
})
