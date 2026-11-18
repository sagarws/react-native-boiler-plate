import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

interface SnapdealFlow {
  returnTypeOf: (item: unknown, data: unknown) => string | null
}

const flow = require_(
  '@trackvid/automation-core/platforms/snapdeal/claim-management/api-based-flow/claimApiFlow'
) as SnapdealFlow

/**
 * Which kind of return this is — and it is not always the same kind.
 *
 * `Courier_Return` was sent for every dispute, from the one capture we had.
 * A manual claim Snapdeal accepted on 2026-09-18 carried `Buyer_Return`, while
 * four automated claims sending `Courier_Return` came back HTTP 502 — a gateway
 * error rather than a refusal, which is what a backend does when the pair
 * (returnType, issueType) resolves to nothing it can build a case from.
 *
 * It also picks the ISSUE VOCABULARY, which is served per return type, so
 * reading it wrong can file under an id that means something else — worse than
 * a 502, because that one succeeds.
 */

describe('the return type on a search result', () => {
  it('reads the type the row carries', () => {
    expect(flow.returnTypeOf({ subOrderId: '74231842081', returnType: 'Buyer_Return' }, {})).toBe(
      'Buyer_Return'
    )
  })

  it('reads it from the response’s own grouping when the row is silent', () => {
    // The captured shape: the arrays of STRINGS are types, the array of objects
    // is the rows.
    const data = {
      returnType: {
        delivered: ['Courier_Return'],
        returnsList: [{ awbNumber: 'SDLR5006960138', subOrderId: '74231842081' }]
      }
    }

    expect(flow.returnTypeOf({ subOrderId: '74231842081' }, data)).toBe('Courier_Return')
  })

  it('prefers the row over the grouping — the row is about THIS return', () => {
    const data = { returnType: { delivered: ['Courier_Return'], returnsList: [{}] } }

    expect(flow.returnTypeOf({ returnType: 'Buyer_Return' }, data)).toBe('Buyer_Return')
  })

  it('answers null rather than guessing, so the caller keeps its default', () => {
    expect(flow.returnTypeOf({ subOrderId: 'x' }, {})).toBeNull()
    expect(flow.returnTypeOf(null, null)).toBeNull()
    // Not a type, whatever else it is.
    expect(flow.returnTypeOf({ returnType: 'DISPUTE' }, {})).toBeNull()
    expect(flow.returnTypeOf({ type: 42 }, {})).toBeNull()
  })

  it('is not fooled by the rows array, which is objects rather than types', () => {
    expect(flow.returnTypeOf({}, { returnType: { returnsList: [{ awbNumber: 'A' }] } })).toBeNull()
  })
})
