import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface DelhiveryFlow {
  mapDelhiveryTicketStatus: (status: string | null) => string | null
  mapDelhiveryStatus: (status: string | null) => string | null
}

const flow = require_(
  '@trackvid/automation-core/platforms/delhivery/claim-management/api-based-flow/claimApiFlow'
) as DelhiveryFlow

/**
 * Delhivery's support ticket, which is where the decision actually lives.
 *
 * Verified 2026-09-18 against a refused claim: the ticket reports one word —
 * `rejected` — and `accepted` is its opposite. That vocabulary is NOT the
 * claims list's (`claim_approved` / `claim_rejected`), so the two are mapped
 * separately rather than through one table that would have to guess which
 * endpoint a string came from.
 *
 * ONLY THE TWO DECISIONS MAP. Everything else Delhivery reports means nobody
 * has decided yet, and writing a status for it would rewrite a row under review
 * on every sweep.
 */

describe('a Delhivery ticket verdict', () => {
  it('reads accepted as approved and rejected as rejected', () => {
    expect(flow.mapDelhiveryTicketStatus('accepted')).toBe('Approved')
    expect(flow.mapDelhiveryTicketStatus('rejected')).toBe('Rejected')
  })

  it('ignores casing and padding, which portals are careless about', () => {
    expect(flow.mapDelhiveryTicketStatus(' Accepted ')).toBe('Approved')
    expect(flow.mapDelhiveryTicketStatus('REJECTED')).toBe('Rejected')
  })

  it('writes nothing for a state that is not a decision', () => {
    // The row keeps whatever it has — In Review stays In Review.
    for (const state of ['open', 'pending', 'in_progress', 'escalated', '']) {
      expect(flow.mapDelhiveryTicketStatus(state)).toBeNull()
    }

    expect(flow.mapDelhiveryTicketStatus(null)).toBeNull()
  })

  it('keeps the claims list’s own vocabulary separate', () => {
    // The list says claim_rejected; the ticket says rejected. Neither table
    // should answer for the other's strings.
    expect(flow.mapDelhiveryStatus('claim_rejected')).toBe('Rejected')
    expect(flow.mapDelhiveryTicketStatus('claim_rejected')).toBeNull()
  })
})
