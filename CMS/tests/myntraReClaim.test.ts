import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Reopening a Myntra claim it has already rejected.
 *
 * The operator brings a rejection export, which carries the ticket, its
 * category and its dates — and the dispute needs the order, the return, the
 * tracking id, the SKU, the style and the proof URLs, none of which are in it.
 * So a sheet row is an INSTRUCTION and the payload is built from what Myntra
 * currently holds. These pin that build against the captured request.
 */

const require_ = createRequire(import.meta.url)

const {
  buildFwTicketPayload,
  SHEET_COLUMNS,
  REQUIRED_SHEET_COLUMNS,
  DISPUTE_RETURN_REASON
} = require_(
  '@trackvid/automation-core/platforms/myntra/re-claim/api-based-flow/reClaim'
) as {
  buildFwTicketPayload: (
    claim: Record<string, unknown>,
    input: { description: string; issueCategory?: string }
  ) => Record<string, unknown>
  SHEET_COLUMNS: string[]
  REQUIRED_SHEET_COLUMNS: string[]
  DISPUTE_RETURN_REASON: string
}

/** Trimmed from the captured `fetchClaimByTicketId` response. */
const CLAIM = {
  ticketId: 9059207,
  orderId: 100299230385,
  returnId: 100201042136,
  trackingId: 'MYSP1457118950',
  skuId: 114158992,
  styleId: 35701267,
  issueCategory: 'BOX_DAMAGED',
  shippingLabelProofUrl: 'https://blob/spf-claims/c07952c3_100299230385_1788872243296',
  productProofUrl:
    'https://blob/spf-claims/2754f5b8_100299230385_1788872249277,' +
    'https://blob/spf-claims/c847cc82_100299230385_1788872252374',
  videoProofUrl: 'https://blob/spf-claims/be442b90_100299230385_1788872262459'
}

describe('buildFwTicketPayload', () => {
  it('builds the body Myntra was captured accepting', () => {
    expect(buildFwTicketPayload(CLAIM, { description: 'Please recheck.' })).toEqual({
      ticketId: 9059207,
      description: 'Please recheck.',
      orderId: 100299230385,
      returnId: 100201042136,
      trackingId: 'MYSP1457118950',
      skuId: 114158992,
      styleId: 35701267,
      issueCategory: 'BOX_DAMAGED',
      returnReason: 'Others',
      attachments: [
        'https://blob/spf-claims/c07952c3_100299230385_1788872243296',
        'https://blob/spf-claims/2754f5b8_100299230385_1788872249277',
        'https://blob/spf-claims/c847cc82_100299230385_1788872252374'
      ]
    })
  })

  it('sends the ids as NUMBERS, as the capture does', () => {
    // Myntra's own request sends them unquoted, and a stringified order id is
    // the kind of thing an API accepts until the day it does not.
    const payload = buildFwTicketPayload(
      { ...CLAIM, ticketId: '9059207', orderId: '100299230385' },
      { description: 'x' }
    )

    expect(typeof payload.ticketId).toBe('number')
    expect(typeof payload.orderId).toBe('number')
  })

  it('flattens the proofs, shipping label first', () => {
    // Myntra stores the product proofs as ONE comma-separated string and the
    // label separately; the dispute wants a flat array in that order.
    const payload = buildFwTicketPayload(CLAIM, { description: 'x' })

    expect((payload.attachments as string[])[0]).toContain('c07952c3')
    expect(payload.attachments).toHaveLength(3)
  })

  it('drops a proof slot the claim does not have', () => {
    const payload = buildFwTicketPayload(
      { ...CLAIM, shippingLabelProofUrl: null, productProofUrl: '' },
      { description: 'x' }
    )

    // An empty string in the array would be an attachment Myntra cannot fetch.
    expect(payload.attachments).toEqual([])
  })

  it('lets the sheet override the category the claim was rejected under', () => {
    // Re-filing under a different category is a deliberate choice; the claim's
    // own value is the one that was already refused.
    expect(
      buildFwTicketPayload(CLAIM, { description: 'x', issueCategory: 'ITEM_MISSING' })
        .issueCategory
    ).toBe('ITEM_MISSING')

    // …and an empty override keeps what the claim says, rather than blanking it.
    expect(buildFwTicketPayload(CLAIM, { description: 'x', issueCategory: '' }).issueCategory).toBe(
      'BOX_DAMAGED'
    )
  })

  it('refuses to send an empty argument', () => {
    // Myntra accepts one and rejects the ticket again, which spends the
    // seller's single reopen on a sentence nobody wrote.
    expect(() => buildFwTicketPayload(CLAIM, { description: '   ' })).toThrow(/description/i)
  })

  it('refuses when there is no claim to dispute', () => {
    expect(() => buildFwTicketPayload(null as never, { description: 'x' })).toThrow()
  })

  it('always files the dispute under "Others"', () => {
    // Not the claim's own return reason — that is the customer's and stays on
    // the ticket. This is the reason for REOPENING, and the portal sends
    // "Others" for every one; the capture echoes it back as
    // `ticketDisputedReturnReason: "Others"` beside a claim whose returnReason
    // is "Found a better price on Myntra".
    expect(DISPUTE_RETURN_REASON).toBe('Others')
    expect(buildFwTicketPayload(CLAIM, { description: 'x' }).returnReason).toBe('Others')
    expect(
      buildFwTicketPayload({ ...CLAIM, returnReason: 'Found a better price on Myntra' }, {
        description: 'x'
      }).returnReason
    ).toBe('Others')
  })

  it('cannot be talked out of it by a caller', () => {
    // Fixed, not defaulted: a caller that could pass its own would be one that
    // could send a value the portal never sends, and finding out that Myntra
    // minds costs a seller their single reopen.
    const payload = buildFwTicketPayload(CLAIM, {
      description: 'x',
      returnReason: 'Damaged'
    } as { description: string })

    expect(payload.returnReason).toBe('Others')
  })

  /**
   * The sheet asks for exactly what the flow reads — three of the export's
   * fourteen columns. The template is generated from this list, so anything
   * added here is something an operator will be asked to fill in.
   */
  it('reads three columns, and only three', () => {
    expect(SHEET_COLUMNS).toEqual(['ticketId', 'RR Remarks', 'issueCategory'])
  })

  it('requires the ticket and the argument, but not the category', () => {
    expect(REQUIRED_SHEET_COLUMNS).toEqual(['ticketId', 'RR Remarks'])
    // Optional by design: blank keeps the category Myntra already has, and
    // demanding it would make an operator name one the portal knows better.
    expect(REQUIRED_SHEET_COLUMNS).not.toContain('issueCategory')
  })
})
