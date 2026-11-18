import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface SnapdealFlow {
  paidAmountOf: (row: unknown) => number | null
}

const flow = require_(
  '@trackvid/automation-core/platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
) as SnapdealFlow

/**
 * What Snapdeal paid, from the returns list.
 *
 * There is no "approved" field anywhere in Snapdeal's API. A completed return
 * carries `paymentDetail.amount` when the claim was paid and nothing when it
 * was not, and that absence IS the rejection — so reading the amount wrong
 * decides the outcome wrong, in both directions.
 *
 * The amount is NEGATIVE in the payload, because it is a debit against the
 * seller's account (verified 2026-09-18: -616.22 for a claim worth ₹616.22).
 * A claim is worth its size, so the sign is dropped — writing -616.22 into
 * compensationAmount would report a payout as a charge.
 */

describe('the paid amount on a settled return', () => {
  it('drops the sign — the payload is a debit, the claim is a value', () => {
    expect(flow.paidAmountOf({ paymentDetail: { amount: -616.22, settled: true } })).toBe(616.22)
  })

  it('takes a positive amount as it stands', () => {
    expect(flow.paidAmountOf({ paymentDetail: { amount: 616.22 } })).toBe(616.22)
  })

  it('reads a completed return with no payment as no amount — which is the rejection', () => {
    expect(flow.paidAmountOf({ paymentDetail: null })).toBeNull()
    expect(flow.paidAmountOf({})).toBeNull()
    expect(flow.paidAmountOf({ paymentDetail: { amount: null } })).toBeNull()
  })

  it('treats zero as no payment, not as a payment of nothing', () => {
    expect(flow.paidAmountOf({ paymentDetail: { amount: 0 } })).toBeNull()
  })

  it('refuses anything that is not a number', () => {
    expect(flow.paidAmountOf({ paymentDetail: { amount: 'six hundred' } })).toBeNull()
    expect(flow.paidAmountOf(null)).toBeNull()
  })
})
