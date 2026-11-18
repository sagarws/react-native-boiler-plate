import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * Finding a Meesho return when the AWB on the row is not the AWB Meesho holds.
 *
 * The number a CMS row carries is not always current. A re-booked return gets a
 * new waybill and the row keeps the old one; a row scanned off a packet can
 * carry the forward leg's. Meesho's search then answers `data: []`, and an empty
 * answer from a SCOPED search means "not on this account" — so the claim failed
 * as "Wrong awb number" and the mapping sweep reported the row as belonging to
 * nobody. Both readings are wrong, and both send somebody to fix the wrong thing.
 *
 * The sub-order number is what Meesho actually keys on and it does not change.
 * What is pinned here is that it is asked SECOND — never instead — and that the
 * row which comes back is then read for the CURRENT waybill.
 */

interface SearchResult {
  found: boolean
  row: { awbNumber: string | null; subOrderNumber: string | null; raw: unknown } | null
  rows: unknown[]
  raw: unknown
  matchedBy: string | null
  query: string | null
  tried: string[]
}

interface ReturnsSearch {
  findReturn: (
    ctx: unknown,
    identifiers: { awb?: string | null; subOrderNumber?: string | null; orderNumber?: string | null },
    options?: { logger?: unknown }
  ) => Promise<SearchResult>
}

/** The row from the 2026-09-18 capture, trimmed to the fields that are read. */
const ROW = {
  order_num: '325890127312313984',
  sub_order_num: '325890127312313984_1',
  sub_order_identifier: '325890127312313984_1_return_933062249',
  type: 'RET',
  sub_type: 'FIRST_RET',
  shipment_status: 'Delivered',
  created_date_iso: '2026-09-12T21:35:25+0530',
  delivered_date_iso: '2026-09-18T13:44:13+0530',
  carrier_name: 'Valmo',
  awb: 'VLR082879603477',
  product: { sku: 'subhi5667fanta', name: 'Saree' }
}

/** Every query the module actually sent, in order. */
const sent: string[] = []

/**
 * Meesho, as far as this test is concerned: it knows the row under its own AWB
 * and its sub-order number, and nothing else.
 */
const fakeAxios = (config: { data?: { filters?: { text_global?: string } } }) => {
  const query = config.data?.filters?.text_global ?? ''

  sent.push(query)

  const known = query === ROW.awb || query === ROW.sub_order_num || query === ROW.order_num

  return Promise.resolve({ status: 200, data: { data: known ? [ROW] : [] }, headers: {} })
}

/**
 * Put the fake in Node's require cache, not in Vitest's module registry.
 *
 * `vi.mock('axios')` does nothing here. The core is CommonJS loaded through
 * `createRequire`, which is Node's own loader — it never passes through Vite, so
 * a Vitest mock is simply not consulted and the module gets the real axios. That
 * is not a test that fails safely: it is a test that SENDS REAL REQUESTS to
 * supplier.meesho.com, which is exactly what happened the first time this ran.
 *
 * Seeding the cache before the module is required is the interception that works
 * for a native require, and it has to happen first: returnsSearch.js requires
 * axios at module scope, so by the time the module object exists it is too late.
 */
const axiosPath = require_.resolve('axios')

require_.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: fakeAxios
} as unknown as NodeJS.Module

const { findReturn } = require_(
  '@trackvid/automation-core/platforms/meesho/common/returnsSearch'
) as ReturnsSearch

/** A session that already names its supplier, so no identity call is made. */
const ctx = { jar: [], supplierId: 1234, supplierIdentifier: 'supplier-abc' }

beforeEach(() => {
  sent.length = 0
})

describe('finding a Meesho return', () => {
  it('asks by AWB first, and stops there when that answers', async () => {
    const result = await findReturn(ctx, {
      awb: ROW.awb,
      subOrderNumber: ROW.sub_order_num
    })

    expect(result.found).toBe(true)
    expect(result.matchedBy).toBe('awb')
    // ONE request. The sub-order number is a fallback, not a second opinion —
    // asking it anyway would double every search on a run of three hundred.
    expect(sent).toEqual([ROW.awb])
  })

  it('falls back to the sub-order number when the AWB finds nothing', async () => {
    const result = await findReturn(ctx, {
      awb: 'VLR000000000000',
      subOrderNumber: ROW.sub_order_num
    })

    expect(result.found).toBe(true)
    expect(result.matchedBy).toBe('subOrderNumber')
    // In that order, and only because the first came back empty.
    expect(sent).toEqual(['VLR000000000000', ROW.sub_order_num])
  })

  it('answers with the waybill MEESHO holds, not the one it was asked with', async () => {
    const stale = 'VLR000000000000'
    const result = await findReturn(ctx, { awb: stale, subOrderNumber: ROW.sub_order_num })

    // The whole point of the fallback: the ticket has to carry this number, or
    // it names a shipment Meesho cannot find.
    expect(result.row?.awbNumber).toBe('VLR082879603477')
    expect(result.row?.awbNumber).not.toBe(stale)
    expect(result.row?.subOrderNumber).toBe(ROW.sub_order_num)
  })

  it('keeps the raw row, so the claim still gets its delivery date and product', async () => {
    const result = await findReturn(ctx, { awb: 'VLR000000000000', subOrderNumber: ROW.sub_order_num })

    // Read off `row.raw` rather than re-found by matching the QUERY against
    // `awb` — which is what the claim flow used to do, and which returns null
    // for every row found by sub-order number, silently dropping the delivered
    // date the claim window is judged on.
    expect(result.raw).toMatchObject({ delivered_date_iso: ROW.delivered_date_iso })
  })

  it('does not ask twice when the two identifiers are the same', async () => {
    await findReturn(ctx, { awb: ROW.sub_order_num, subOrderNumber: ROW.sub_order_num })

    expect(sent).toHaveLength(1)
  })

  it('skips blanks rather than searching for nothing', async () => {
    const result = await findReturn(ctx, { awb: '', subOrderNumber: ROW.sub_order_num })

    expect(sent).toEqual([ROW.sub_order_num])
    expect(result.found).toBe(true)
  })

  it('reports a genuine miss as a miss, having tried both', async () => {
    const result = await findReturn(ctx, {
      awb: 'VLR000000000000',
      subOrderNumber: '999999999999999999_1'
    })

    expect(result.found).toBe(false)
    expect(result.row).toBeNull()
    expect(result.matchedBy).toBeNull()
    // Named, so "not on this account" can be trusted: both questions were put.
    expect(result.tried).toEqual(['VLR000000000000', '999999999999999999_1'])
  })

  it('refuses a call with nothing to search for', async () => {
    await expect(findReturn(ctx, { awb: '', subOrderNumber: '' })).rejects.toThrow()
    expect(sent).toHaveLength(0)
  })
})
