import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Flipkart's claim lookup, account check and approved amount — the core's
 * api-based flow, run against stubbed HTTP shaped like the portal's real
 * answers (see FLIPKART_API.md in the core).
 *
 * What must hold:
 *   - the ticket search is two calls, counts then that state's list, and the
 *     orchestrator gets the seller id;
 *   - a claim row is only accepted when something on it ties it to the AWB;
 *   - approvedAmount is a payout only on an APPROVED claim;
 *   - an AWB the global search places under another order item is never filed.
 */

const require_ = createRequire(import.meta.url)

interface Call {
  url: string
  body: { operationName?: string; variables?: Record<string, unknown>; query?: string }
  headers: Record<string, string>
}

type Answer = (call: Call) => unknown

const axios = require_('axios') as { post: (...args: unknown[]) => Promise<unknown> }

const flow = require_('@trackvid/automation-core/platforms/flipkart/claim-management/api-based-flow/claimApiFlow') as {
  findClaim: (ctx: object, awb: string, hint?: object) => Promise<Record<string, unknown> | null>
  searchReturnItem: (ctx: object, value: string) => Promise<{ found: boolean; returns: { orderItemIds: string[] }[] }>
  approvedAmountOf: (claim: object | null) => number | null
  getIssueTypes: (ctx: object, productType: string) => Promise<string[]>
}

const { fileFlipkartClaim } = require_(
  '@trackvid/automation-core/platforms/flipkart/claim-management/api-based-flow/fileClaim'
) as {
  fileFlipkartClaim: (...args: unknown[]) => Promise<Record<string, unknown>>
}

const AWB = 'FMPR0000000001'
const SELLER = 'seller-1'
const quiet = { log: () => undefined, warn: () => undefined }

const returnItem = (overrides: Record<string, unknown> = {}) => ({
  order_id: 'OD1',
  order_item_id: 'OI1',
  return_id: 'R1',
  tracking_id: AWB,
  seller_id: SELLER,
  claim_eligible: true,
  claim_details: null,
  quantity: 1,
  shipment_expectation: 'expect',
  status: 'completed',
  shipment_status: 'delivered',
  ...overrides
})

const claimRow = (overrides: Record<string, unknown> = {}) => ({
  claimId: 'C1',
  incidentId: 'IN1',
  status: 'APPROVED',
  approvedAmount: 622.68,
  settlementAmount: 841,
  orderId: 'OD1',
  orderItemId: 'OI1',
  returnId: 'R1',
  trackingId: AWB,
  createdAt: '2026-09-15 10:56:26.0',
  ...overrides
})

let calls: Call[]
let answers: Record<string, Answer>

const stub = (next: Record<string, Answer>): void => {
  answers = next
}

beforeEach(() => {
  calls = []
  answers = {}
  vi.spyOn(axios, 'post').mockImplementation((...args: unknown[]) => {
    const [url, body, config] = args as [string, Call['body'], { headers: Record<string, string> }]
    const call = { url, body, headers: config.headers }

    calls.push(call)

    const answer = answers[body.operationName ?? '']

    if (!answer) throw new Error(`unexpected call ${body.operationName}`)

    return Promise.resolve({ status: 200, data: answer(call) })
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const orderSearch = (item: object | null): Answer => () => ({
  data: { getOrderSearch: { return_item_list: item ? [item] : [], has_more: false, next_page: null } }
})

const counts = (stateCounts: { state: string; count: number }[]): Answer => () => ({
  data: { claim: { sellerClaims: { total: stateCounts.length, stateCounts }, autoProcessedClaims: [] } },
  dataErrors: {},
  graphErrors: [],
  isDataPresent: true
})

const claimsByState = (byState: Record<string, object[]>): Answer => call => {
  const filter = (call.body.variables?.input as { filter: { status: string } }).filter

  return { data: { claims: { hasMore: false, nextUrl: null, claims: byState[filter.status] ?? [] } } }
}

const globalSearch = (orderItemIds: string[] | null): Answer => () => ({
  data: {
    data: {
      response: orderItemIds
        ? [
            {
              tracking_id: { trackingId: AWB },
              order_id: { orderId: 'OD1', orderItemIds },
              return_type: { returnType: 'customer_return', returnId: 'R1' },
              return_status: { status: 'completed', shipmentStatus: 'delivered' },
              data: { return_status_text: 'Return Delivered' },
              product: []
            }
          ]
        : []
    }
  }
})

describe('findClaim', () => {
  it('asks the state counts, then searches only the state that holds the claim', async () => {
    stub({
      Payments_SPF_WEB_getOrderSearch: orderSearch(returnItem()),
      GetSpfClaimCountsOrchestrator: counts([{ state: 'APPROVED', count: 1 }]),
      GetSpfClaimsOrchestrator: claimsByState({ APPROVED: [claimRow()] })
    })

    const ctx = { jar: {}, csrfToken: 't', sellerId: null }
    const claim = await flow.findClaim(ctx, AWB)

    expect(claim).toMatchObject({ claimId: 'C1', incidentId: 'IN1', status: 'APPROVED', approvedAmount: 622.68 })

    const lists = calls.filter(c => c.body.operationName === 'GetSpfClaimsOrchestrator')

    expect(lists).toHaveLength(1)
    expect(lists[0]?.body.variables).toEqual({
      input: {
        filter: { search: AWB, searchOption: 'tracking_id', status: 'APPROVED' },
        pagination: { pageSize: 10, startingPage: 1, sort: null }
      }
    })
    // A restored session has no seller id; the order search supplies it, and
    // the orchestrator carries it in both headers.
    expect(lists[0]?.headers['x-seller-id']).toBe(SELLER)
    expect(lists[0]?.headers['x-user-id']).toBe(SELLER)
    expect(lists[0]?.headers['x-client-id']).toBe('SD')
  })

  it('returns null when no state holds a claim, without searching any list', async () => {
    stub({ GetSpfClaimCountsOrchestrator: counts([]) })

    await expect(flow.findClaim({ jar: {}, csrfToken: 't', sellerId: SELLER }, AWB)).resolves.toBeNull()
    expect(calls.map(c => c.body.operationName)).toEqual(['GetSpfClaimCountsOrchestrator'])
  })

  it('never accepts a row for another tracking id', async () => {
    stub({
      GetSpfClaimCountsOrchestrator: counts([{ state: 'PROCESSING', count: 1 }]),
      GetSpfClaimsOrchestrator: claimsByState({ PROCESSING: [claimRow({ trackingId: 'SOMEONE-ELSE' })] })
    })

    await expect(flow.findClaim({ jar: {}, csrfToken: 't', sellerId: SELLER }, AWB)).resolves.toBeNull()
  })

  it('accepts an older row with no tracking id only through a known order item', async () => {
    stub({
      GetSpfClaimCountsOrchestrator: counts([{ state: 'REJECTED', count: 1 }]),
      GetSpfClaimsOrchestrator: claimsByState({ REJECTED: [claimRow({ trackingId: null, status: 'REJECTED' })] })
    })

    const ctx = { jar: {}, csrfToken: 't', sellerId: SELLER }

    await expect(flow.findClaim(ctx, AWB)).resolves.toBeNull()
    await expect(flow.findClaim(ctx, AWB, { orderItemId: 'OI1' })).resolves.toMatchObject({ claimId: 'C1' })
  })
})

describe('approvedAmountOf', () => {
  it('is the amount only on an APPROVED claim', () => {
    expect(flow.approvedAmountOf({ status: 'APPROVED', approvedAmount: 622.68 })).toBe(622.68)
    // Every other tab reports 0, which is not a payout.
    expect(flow.approvedAmountOf({ status: 'SELLER_PENDING', approvedAmount: 0 })).toBeNull()
    expect(flow.approvedAmountOf({ status: 'APPROVED', approvedAmount: null })).toBeNull()
    expect(flow.approvedAmountOf(null)).toBeNull()
  })
})

describe('getIssueTypes', () => {
  it('declares $productType as String!, as the portal does', async () => {
    stub({
      Payments_SPF_WEB_getIssueTypes: () => ({ data: { getIssueTypes: { Main_Product: ['I received a wrong product'] } } })
    })

    await expect(flow.getIssueTypes({ jar: {}, csrfToken: 't', sellerId: null }, 'Main Product')).resolves.toEqual([
      'I received a wrong product'
    ])
    expect(calls[0]?.body.query).toContain('$productType: String!')
  })
})

describe('fileFlipkartClaim', () => {
  const vocab = { productTypes: ['Main Product'], issueTypesByProduct: {} }
  const entry = { awbNumber: AWB, issueType: 'I received a wrong product', evidenceImages: [] }
  const file = () => fileFlipkartClaim({ jar: {}, csrfToken: 't', sellerId: null }, entry, AWB, '/tmp', vocab, 'ops@example.com', { log: quiet })

  it('reports an existing approved claim with its approved amount, filing nothing', async () => {
    stub({
      Payments_SPF_WEB_getOrderSearch: orderSearch(
        returnItem({ claim_eligible: false, claim_details: { claim_id: 'C1', incident_id: 'IN1', claim_status: 'OPEN' } })
      ),
      GetSpfClaimCountsOrchestrator: counts([{ state: 'APPROVED', count: 1 }]),
      GetSpfClaimsOrchestrator: claimsByState({ APPROVED: [claimRow()] })
    })

    await expect(file()).resolves.toEqual({
      claimId: 'C1',
      incidentId: 'IN1',
      alreadyExisted: true,
      cmsStatus: 'Approved',
      flipkartStatus: 'APPROVED',
      approvedAmount: 622.68
    })
    expect(calls.some(c => c.body.operationName === 'Payments_SPF_WEB_createclaimV2')).toBe(false)
  })

  it('refuses an AWB the global search places under another order item', async () => {
    stub({
      Payments_SPF_WEB_getOrderSearch: orderSearch(returnItem()),
      returns_searchReturnItem: globalSearch(['ANOTHER-ITEM'])
    })

    await expect(file()).rejects.toThrow(/^ACCOUNT_MISMATCH:/)
    expect(calls.some(c => c.body.operationName === 'Payments_SPF_WEB_createclaimV2')).toBe(false)
  })

  it('tells "on this account but not claimable" apart from "not on this account"', async () => {
    stub({
      Payments_SPF_WEB_getOrderSearch: orderSearch(null),
      returns_searchReturnItem: globalSearch(['OI1'])
    })

    await expect(file()).rejects.toThrow(/^NOT_CLAIM_ELIGIBLE: return FMPR0000000001 is on account ops@example.com/)

    stub({
      Payments_SPF_WEB_getOrderSearch: orderSearch(null),
      returns_searchReturnItem: globalSearch(null)
    })

    await expect(file()).rejects.toThrow(
      'NO_RETURN_PACKETS: Wrong awb number, Not exist in account ops@example.com'
    )
  })
})
