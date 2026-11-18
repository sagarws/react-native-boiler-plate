import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * Which claim gets raised for which return.
 *
 * The operator uploads one file per claim type, and THE SLOT A FILE LANDS IN IS
 * THE CHOICE — the record's own `order_status` does not overrule it. That is a
 * deliberate decision and it is the reason these tests exist: a claim filed
 * under the wrong sub-type cannot be corrected at AJIO, so the one thing this
 * must never do quietly is disagree with the operator.
 *
 * Where it CAN disagree — the operator says NDR and TrackVid says the return
 * was delivered — the row is held back and reported, not filed either way.
 *
 * The automation server takes the other path (`claimTypeSource: 'order-status'`),
 * because a bulk upload there has no operator to ask. Both are pinned here: the
 * two runners share this function, and a change made for one silently changes
 * the other.
 */

const require_ = createRequire(import.meta.url)

interface BucketRow {
  awb: string
  sku: string
  claimType: string
  orderStatus?: string
}

type BucketName =
  | 'claimable'
  | 'alreadyClaimed'
  | 'wrongStatus'
  | 'typeMismatch'
  | 'notFound'
  | 'noCredentials'
  | 'skuNotFound'
  | 'conflict'

interface Sorted {
  groups: { accountEmail: string; configArr: { typeOfClaim: string; subIssueType: string }[] }[]
  // Every bucket is always present — `noUncheckedIndexedAccess` would otherwise
  // make each one `| undefined` and bury the assertions in optional chaining.
  buckets: { [K in BucketName]: BucketRow[] }
}

const { bucketRows } = require_(
  '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/bulkSpfBuckets'
) as {
  bucketRows: (options: Record<string, unknown>) => Sorted
}

const NOT_DELIVERED = 'Return Not Delivered'
const DELIVERED = 'Marketplace Delivered'

const record = (over: Record<string, unknown>): Record<string, unknown> => ({
  _id: 'm1',
  companyId: 'c1',
  return_order_no: 'R1',
  return_order_AWB_no: 'A1',
  order_seller_SKU: 'SKU-1',
  order_status: NOT_DELIVERED,
  ajio_account_email: 'seller@example.com',
  POB_ID: 'POB1',
  ...over
})

const credential = { username: 'seller@example.com', password: 'secret' }
const findCredential = (email: string): unknown =>
  email === 'seller@example.com' ? credential : null

const sort = (rows: unknown[], records: unknown[], source: 'row' | 'order-status'): Sorted =>
  bucketRows({ rows, records, findCredential, byRon: true, claimTypeSource: source })

describe('bucketRows — the operator chooses the claim type', () => {
  it('files what the operator asked for when the status agrees', () => {
    const sorted = sort([{ id: 'R1', sku: '', claimType: 'NDR' }], [record({})], 'row')

    expect(sorted.buckets.claimable).toHaveLength(1)
    expect(sorted.groups[0]?.configArr[0]?.typeOfClaim).toBe('NOT DELIVERED RETURNS')
    expect(sorted.groups[0]?.configArr[0]?.subIssueType).toBe('Not Delivered Returns')
  })

  it('holds the row back when the operator and TrackVid disagree, rather than picking one', () => {
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'NDR' }],
      [record({ order_status: DELIVERED })],
      'row'
    )

    expect(sorted.buckets.claimable).toHaveLength(0)
    expect(sorted.buckets.typeMismatch).toHaveLength(1)
    expect(sorted.buckets.typeMismatch[0]?.orderStatus).toBe(DELIVERED)
  })

  it('files a status it has no opinion about, because there is nothing to disagree with', () => {
    // "Delivered" implies neither claim type, so the operator's choice stands
    // unopposed — and the status gate that would have skipped this on the
    // server is deliberately not applied here.
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'DDR' }],
      [record({ order_status: 'Delivered' })],
      'row'
    )

    expect(sorted.buckets.claimable).toHaveLength(1)
    expect(sorted.groups[0]?.configArr[0]?.typeOfClaim).toBe('DELIVERY DISPUTE RETURNS')
  })

  it('claims every article of a return when no SKU is named, each on its own row', () => {
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'NDR' }],
      [record({}), record({ _id: 'm2', order_seller_SKU: 'SKU-2' })],
      'row'
    )

    expect(sorted.buckets.claimable).toHaveLength(2)
    expect(sorted.groups).toHaveLength(1)
    expect(sorted.groups[0]?.configArr).toHaveLength(2)
  })

  it('never claims a return that already has a ticket, so re-running a file is safe', () => {
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'NDR' }],
      [record({ ticketNumber: 'TK-1' })],
      'row'
    )

    expect(sorted.buckets.claimable).toHaveLength(0)
    expect(sorted.buckets.alreadyClaimed).toHaveLength(1)
  })

  it('groups by the account that owns the return, not by company', () => {
    // A company holds several AJIO logins and a return is only claimable by the
    // one that owns it. Signing in as the wrong seller finds nothing under its
    // POB and every claim fails for a reason that reads like a broken session.
    const sorted = sort(
      [
        { id: 'R1', sku: '', claimType: 'NDR' },
        { id: 'R2', sku: '', claimType: 'NDR' }
      ],
      [
        record({}),
        record({ _id: 'm2', return_order_no: 'R2', ajio_account_email: 'other@example.com' })
      ],
      'row'
    )

    expect(sorted.buckets.claimable).toHaveLength(1)
    expect(sorted.buckets.noCredentials).toHaveLength(1)
    expect(sorted.groups).toHaveLength(1)
    expect(sorted.groups[0]?.accountEmail).toBe('seller@example.com')
  })
})

describe('bucketRows — the server derives the claim type instead', () => {
  it('takes the type from the status and ignores what the row says', () => {
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'NDR' }],
      [record({ order_status: DELIVERED })],
      'order-status'
    )

    expect(sorted.buckets.typeMismatch).toHaveLength(0)
    expect(sorted.buckets.claimable).toHaveLength(1)
    expect(sorted.groups[0]?.configArr[0]?.typeOfClaim).toBe('DELIVERY DISPUTE RETURNS')
  })

  it('skips a status it does not recognise, because there is no operator to ask', () => {
    const sorted = sort(
      [{ id: 'R1', sku: '', claimType: 'NDR' }],
      [record({ order_status: 'Delivered' })],
      'order-status'
    )

    expect(sorted.buckets.claimable).toHaveLength(0)
    expect(sorted.buckets.wrongStatus).toHaveLength(1)
  })
})
