import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface AjioFlow {
  mapAjioTicketStatus: (status: string | null) => string | null
}

const flow = require_(
  '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/returnDeliveredClaimApiFlow'
) as AjioFlow

/**
 * AJIO's help-centre ticket, which is where a claim's verdict lives.
 *
 * Verified 2026-09-18: a settled claim answers
 *   { result: [{ ticketId: "789066463822", status: "APPROVED",
 *                ticketType: "SPF", subject: "Claiming SPF | …" }] }
 *
 * ONLY THE DECISIONS MAP. Everything else a ticket passes through means nobody
 * has ruled on the claim yet, and writing a status for those would rewrite a
 * row under review on every sweep. CUSTOMER_REPLIED matters most here: the
 * claim flow reads it as "the ticket was created", which is a statement about
 * the FILING and not about the outcome — reading it as a verdict would mark
 * every freshly filed claim as settled.
 */

describe('an AJIO ticket verdict', () => {
  it('reads APPROVED and REJECTED as the decisions they are', () => {
    expect(flow.mapAjioTicketStatus('APPROVED')).toBe('Approved')
    expect(flow.mapAjioTicketStatus('REJECTED')).toBe('Rejected')
  })

  it('ignores casing and spacing, which portals are careless about', () => {
    expect(flow.mapAjioTicketStatus(' approved ')).toBe('Approved')
    expect(flow.mapAjioTicketStatus('Closed-Rejected')).toBe('Rejected')
  })

  it('writes nothing for a ticket nobody has ruled on', () => {
    for (const state of ['OPEN', 'IN_PROGRESS', 'PENDING', 'ESCALATED', '']) {
      expect(flow.mapAjioTicketStatus(state)).toBeNull()
    }

    expect(flow.mapAjioTicketStatus(null)).toBeNull()
  })

  it('never reads CUSTOMER_REPLIED as a verdict', () => {
    // The claim flow uses it to mean "the ticket exists". A settled status here
    // would mark every claim approved the moment it was filed.
    expect(flow.mapAjioTicketStatus('CUSTOMER_REPLIED')).toBeNull()
  })
})
