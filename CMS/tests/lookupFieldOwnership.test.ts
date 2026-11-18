import { describe, expect, it } from 'vitest'

/**
 * What a Return Order Number fills stays filled.
 *
 * THE CASE THIS PINS. An operator typed one return order number, got five
 * fields back — return AWB, forward AWB, customer order number, SKU and POB —
 * then corrected the return AWB by hand and watched SKU and POB empty
 * themselves, with the customer order number and forward AWB re-answered from
 * the new AWB's record.
 *
 * Both of those are reasonable rules on their own, which is why this needed
 * writing down rather than deleting:
 *
 *   - SKU and POB are normally read from the master row of the AWB you type,
 *     so changing the AWB makes them stale. Leaving them would file the claim
 *     under the previous AWB's place of business.
 *   - The AWB record is the natural source for the customer order and forward
 *     AWB.
 *
 * Neither holds once a RETURN ORDER answered first: those values belong to the
 * return order, not to the AWB, and editing the AWB does not make them wrong.
 *
 * Ownership is per-field and ends when the operator edits that field by hand —
 * from then on it is theirs and the staleness rules apply again.
 */

/** The ownership list `ClaimForm` keeps in `filledByLookupRef`. */
const makeOwnership = (filled: string[]) => {
  let owned = [...filled]

  return {
    owns: (field: string) => owned.includes(field),
    editedByHand: (field: string) => (owned = owned.filter(name => name !== field)),
    newLookup: (fields: string[]) => (owned = [...fields])
  }
}

const FILLED = ['AWBNumber', 'forwardAWB', 'customerOrderNumber', 'skuName', 'pobId']

describe('after a return order fills the form', () => {
  it('protects every field it filled', () => {
    const ownership = makeOwnership(FILLED)

    for (const field of FILLED) expect(ownership.owns(field)).toBe(true)
  })

  it('leaves SKU and POB alone when the AWB is corrected', () => {
    // The reported bug, in one line: the AWB edit clears what it does not own.
    const ownership = makeOwnership(FILLED)

    expect(ownership.owns('skuName')).toBe(true)
    expect(ownership.owns('pobId')).toBe(true)
  })

  it('protects nothing it did not fill', () => {
    // A line with no POB must not protect a POB the operator typed earlier —
    // protection follows what the lookup actually answered.
    const ownership = makeOwnership(['AWBNumber', 'skuName'])

    expect(ownership.owns('pobId')).toBe(false)
  })
})

describe('once the operator edits a filled field', () => {
  it('hands that field back, leaving the others protected', () => {
    const ownership = makeOwnership(FILLED)

    ownership.editedByHand('pobId')

    expect(ownership.owns('pobId')).toBe(false)
    expect(ownership.owns('skuName')).toBe(true)
  })
})

describe('when a new return order is looked up', () => {
  it('replaces the ownership rather than adding to it', () => {
    // Otherwise the previous order's POB would be protected from the new
    // order's own answer — stale data defended by the rule meant to preserve
    // fresh data.
    const ownership = makeOwnership(FILLED)

    ownership.newLookup(['AWBNumber', 'skuName'])

    expect(ownership.owns('pobId')).toBe(false)
    expect(ownership.owns('skuName')).toBe(true)
  })
})
