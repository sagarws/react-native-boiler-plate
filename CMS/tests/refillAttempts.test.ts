import { describe, expect, it } from 'vitest'
import { MAX_REFILL_ATTEMPTS, refillExhausted } from '@shared/constants/refill'
import { MAX_CLAIM_ATTEMPTS } from '@shared/constants/claims'

/**
 * Refill Data gets its own budget, and stops when it is spent.
 *
 * A refill that has asked the marketplace three times and come back with
 * nothing will not answer on the fourth — the AWB is wrong, or the return sits
 * on an account this company does not hold, and both need a person. Every
 * further ask is a browser session the nightly run could have spent on a row it
 * can actually fill.
 *
 * The count lives on the claim as `refillAttempt`, incremented once per row per
 * run by the app itself.
 */

describe('the refill budget', () => {
  it('counts from zero, so the back catalogue is not frozen', () => {
    // Every row written before the field existed has no `refillAttempt` at all.
    // Reading absent as "spent" would skip all of them, for ever.
    expect(refillExhausted(undefined)).toBe(false)
    expect(refillExhausted(null)).toBe(false)
    expect(refillExhausted(0)).toBe(false)
  })

  it('allows exactly MAX_REFILL_ATTEMPTS asks, then stops', () => {
    for (let spent = 0; spent < MAX_REFILL_ATTEMPTS; spent += 1) {
      expect(refillExhausted(spent), `after ${spent} refills`).toBe(false)
    }

    expect(refillExhausted(MAX_REFILL_ATTEMPTS)).toBe(true)
    expect(refillExhausted(MAX_REFILL_ATTEMPTS + 5)).toBe(true)
  })

  it('is separate from the claim’s budget, and must stay that way', () => {
    // The same number today, deliberately NOT the same constant: a row that has
    // burned its FILING attempts is often exactly the row whose blanks a refill
    // would supply, so one budget must never consume the other.
    expect(MAX_REFILL_ATTEMPTS).toBe(3)
    expect(MAX_CLAIM_ATTEMPTS).toBe(3)
  })
})
