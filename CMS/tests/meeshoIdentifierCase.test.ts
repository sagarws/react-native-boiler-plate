import { createRequire } from 'node:module'
import { beforeEach, describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * One spelling of an AWB or a sub-order number, everywhere Meesho sees it.
 *
 * Meesho's waybills are alphanumeric with a letter prefix, and the value that
 * reaches this process has been through a barcode scanner, a spreadsheet, a
 * typed correction or a feed — none of which agree on case. The portal does not
 * treat the two alike: the Returns search is a text match, and the claim form
 * stores what it is given.
 *
 * So a lower-cased waybill fails in two silent ways. It searches as "not found"
 * against a return sitting right there — which reads as "wrong awb number, not
 * on this account" — and it files a ticket whose AWB a reviewer rejects days
 * later. Neither looks like a case problem to the person reading the row.
 */

interface Identifiers {
  meeshoId: (value: unknown) => string
}

const { meeshoId } = require_(
  '@trackvid/automation-core/platforms/meesho/common/identifiers'
) as Identifiers

describe('the one spelling', () => {
  it('upper-cases a waybill', () => {
    expect(meeshoId('vlr082879603477')).toBe('VLR082879603477')
    expect(meeshoId('VLR082879603477')).toBe('VLR082879603477')
  })

  it('trims what came off a scanner or a spreadsheet cell', () => {
    expect(meeshoId('  vlr082879603477\n')).toBe('VLR082879603477')
  })

  it('leaves a sub-order number recognisable', () => {
    // Digits and an underscore — upper-casing is a no-op, which is the point:
    // one rule for every identifier rather than a rule per field.
    expect(meeshoId('325890127312313984_1')).toBe('325890127312313984_1')
  })

  it('keeps a missing value missing', () => {
    // The callers check for emptiness before searching. `String(undefined)`
    // would sail past every one of those checks as a seven-character query —
    // and "UNDEFINED" is a search Meesho will happily answer nothing for.
    expect(meeshoId(undefined)).toBe('')
    expect(meeshoId(null)).toBe('')
    expect(meeshoId('')).toBe('')
    expect(meeshoId({})).toBe('')
    expect(meeshoId('   ')).toBe('')
  })

  it('refuses a number outright, because by then it is already the wrong one', () => {
    // Meesho's sub-order numbers are eighteen digits, which is past
    // Number.MAX_SAFE_INTEGER: one that has been through JSON.parse as a number
    // has ALREADY lost precision. Built here the way it really arrives — parsed,
    // not written as a literal, which ESLint rightly refuses to let anyone type.
    const parsed = Number('325890127312313984') as unknown

    expect(String(parsed)).toBe('325890127312314000')

    // So stringifying it would hand Meesho a plausible identifier for somebody
    // else's order and file a claim against it. "" makes the caller's emptiness
    // check fire instead, which reports the missing value it effectively is.
    expect(meeshoId(parsed)).toBe('')
  })
})

/**
 * And that the search actually sends it that way.
 *
 * The rule is only worth anything at the edge — what goes onto the wire.
 */

interface SearchResult {
  found: boolean
  row: { awbNumber: string | null } | null
  tried: string[]
}

interface ReturnsSearch {
  findReturn: (
    ctx: unknown,
    identifiers: { awb?: string | null; subOrderNumber?: string | null },
    options?: { logger?: unknown }
  ) => Promise<SearchResult>
}

const ROW = {
  order_num: '325890127312313984',
  sub_order_num: '325890127312313984_1',
  awb: 'VLR082879603477',
  shipment_status: 'Delivered',
  product: { sku: 'subhi5667fanta' }
}

const sent: string[] = []

/** See meeshoSubOrderFallback.test.ts — vi.mock cannot reach a createRequire'd CJS module. */
const axiosPath = require_.resolve('axios')

require_.cache[axiosPath] = {
  id: axiosPath,
  filename: axiosPath,
  loaded: true,
  exports: (config: { data?: { filters?: { text_global?: string } } }) => {
    const query = config.data?.filters?.text_global ?? ''

    sent.push(query)

    // Meesho as it actually behaves: it knows this return under the UPPER-CASE
    // waybill, and answers nothing for any other spelling.
    const known = query === ROW.awb || query === ROW.sub_order_num

    return Promise.resolve({ status: 200, data: { data: known ? [ROW] : [] }, headers: {} })
  }
} as unknown as NodeJS.Module

const { findReturn } = require_(
  '@trackvid/automation-core/platforms/meesho/common/returnsSearch'
) as ReturnsSearch

const ctx = { jar: [], supplierId: 1234, supplierIdentifier: 'supplier-abc' }

beforeEach(() => {
  sent.length = 0
})

describe('searching with it', () => {
  it('finds a return whose AWB was typed in lower case', async () => {
    const result = await findReturn(ctx, { awb: 'vlr082879603477' })

    expect(sent).toEqual(['VLR082879603477'])
    expect(result.found).toBe(true)
    expect(result.row?.awbNumber).toBe('VLR082879603477')
  })

  it('does not spend a second request on the same value in another case', async () => {
    // Before normalising, these were two distinct strings and the fallback
    // dutifully asked the same question twice.
    await findReturn(ctx, { awb: 'vlr082879603477', subOrderNumber: 'VLR082879603477' })

    expect(sent).toEqual(['VLR082879603477'])
  })

  it('reports what it actually sent, not what it was handed', async () => {
    const result = await findReturn(ctx, { awb: 'nope123', subOrderNumber: 'also-nope' })

    expect(result.found).toBe(false)
    // `tried` is read by the caller to justify "not on this account", so it has
    // to name the queries Meesho was really asked.
    expect(result.tried).toEqual(['NOPE123', 'ALSO-NOPE'])
  })
})
