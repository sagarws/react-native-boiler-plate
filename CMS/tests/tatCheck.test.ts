import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { CLAIM_TAT_CHECKS, TICKET_THREADS } from '@main/automations/registry'
import { hasTatCheck, TAT_CHECK_PLATFORMS, TICKET_THREAD_PLATFORMS } from '@shared/constants/claims'

/**
 * Check TAT — the claim window, as the marketplace states it.
 *
 * Two things have to hold. The button and the implementation must agree about
 * which platforms can be asked (they live in different files because the
 * renderer cannot import the main process's registry). And "expired" must mean
 * the window, not any refusal: a wrong AWB is a different problem, and filing
 * it away as "TAT Expired" hides it behind a reason nobody can act on.
 */

const require_ = createRequire(import.meta.url)

const { tatVerdict } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/claimApiFlow'
) as {
  tatVerdict: (validation: {
    isValid: boolean
    errors: { message: string }[]
  }) => { expired: boolean; message: string | null }
}

const refusedWith = (message: string) => ({ isValid: false, errors: [{ message }] })

// Here rather than in ticketThread.test.ts, which mocks the registry.
describe('ticket window platforms', () => {
  it('lists the same platforms the renderer offers the View icon for', () => {
    expect(Object.keys(TICKET_THREADS).sort()).toEqual([...TICKET_THREAD_PLATFORMS].sort())
  })
})

describe('TAT check platforms', () => {
  it('lists the same platforms the renderer offers the button for', () => {
    expect(Object.keys(CLAIM_TAT_CHECKS).sort()).toEqual([...TAT_CHECK_PLATFORMS].sort())
  })

  it('answers for Meesho and for nothing that cannot be asked', () => {
    expect(hasTatCheck('Meesho')).toBe(true)
    expect(hasTatCheck('meesho')).toBe(true)
    // Flipkart's window exists but the portal never states it as a verdict, so
    // there is nothing here to ask.
    expect(hasTatCheck('Flipkart')).toBe(false)
  })
})

describe('tatVerdict', () => {
  it("reads Meesho's own window message as expired", () => {
    const verdict = tatVerdict(
      refusedWith('The dispute can only be claimed within 7 days of return delivery')
    )

    expect(verdict.expired).toBe(true)
    // The marketplace's wording is kept — the day count is the part an operator
    // checks against the delivery date.
    expect(verdict.message).toContain('7 days')
  })

  it('does not call a valid claim expired', () => {
    expect(tatVerdict({ isValid: true, errors: [] }).expired).toBe(false)
  })

  it('leaves every other refusal alone', () => {
    // These are real answers from the same endpoint. Filing them as "TAT
    // Expired" would move a fixable row to Failed to Proceed for good.
    expect(tatVerdict(refusedWith('Please enter a valid sub order number.')).expired).toBe(false)
    expect(tatVerdict(refusedWith('AWB number does not belong to this supplier')).expired).toBe(false)
  })
})
