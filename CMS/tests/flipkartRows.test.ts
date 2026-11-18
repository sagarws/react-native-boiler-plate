import { describe, expect, it } from 'vitest'
import {
  flipkartDate,
  flipkartId,
  flipkartKey,
  flipkartSku,
  flipkartWindows,
  mergeFlipkartRecord,
  toFlipkartRecord
} from '@shared/utils/flipkartRows'

/**
 * The Flipkart backup keeps four columns of two reports and joins them on the
 * order item id. A wrong column here is a Create Claim that fills nothing, and
 * a wrong key doubles a return on every re-download.
 */

const context = { username: 'seller@example.com', requestId: 'req-1', fallbackDate: '2026-08-20' }

describe('a report row', () => {
  it('reads the forward AWB off an Orders row', () => {
    const record = toFlipkartRecord(
      'forward',
      { order_item_id: '425678901234567890', sku: 'SKU-1', delivery_tracking_id: 'FMPC123', order_date: '2026-09-02' },
      context
    )

    expect(record).toMatchObject({ key: '425678901234567890', orderItemId: '425678901234567890', sku: 'SKU-1', awb: 'FMPC123', date: '2026-09-02' })
  })

  it('reads the return AWB off a Returns row, keyed on the return id', () => {
    const record = toFlipkartRecord(
      'return',
      {
        order_item_id: '425678901234567890',
        return_id: '12345',
        sku: 'SKU-1',
        reverse_logistics_tracking_id: 'FMPR999',
        return_requested_date: '04-10-2026'
      },
      context
    )

    expect(record).toMatchObject({ key: '425678901234567890|12345', awb: 'FMPR999', date: '2026-10-04' })
  })

  it('skips a row with no order item id, and treats NA as empty', () => {
    expect(toFlipkartRecord('forward', { order_item_id: '', sku: 'x' }, context)).toBeNull()
    expect(
      toFlipkartRecord('forward', { order_item_id: '1', delivery_tracking_id: 'NA' }, context)?.awb
    ).toBe('')
  })

  it('falls back to the window start when the date will not parse', () => {
    expect(toFlipkartRecord('forward', { order_item_id: '1', order_date: 'soon' }, context)?.date).toBe('2026-08-20')
  })
})

describe('re-downloads', () => {
  it('keep one return when the AWB arrives later, and fill it in', () => {
    const first = toFlipkartRecord('return', { order_item_id: '1', return_id: 'R1', reverse_logistics_tracking_id: '' }, context)!
    const later = toFlipkartRecord('return', { order_item_id: '1', return_id: 'R1', reverse_logistics_tracking_id: 'FMPR1' }, context)!

    expect(first.key).toBe(later.key)
    expect(mergeFlipkartRecord(first, later).awb).toBe('FMPR1')
  })

  it('never blank a field that was held', () => {
    const held = toFlipkartRecord('forward', { order_item_id: '1', sku: 'A', delivery_tracking_id: 'F1' }, context)!
    const blank = toFlipkartRecord('forward', { order_item_id: '1', sku: '', delivery_tracking_id: '' }, context)!

    expect(mergeFlipkartRecord(held, blank)).toMatchObject({ sku: 'A', awb: 'F1' })
  })
})

describe('windows and dates', () => {
  it('tiles a range with no gap and no overlap', () => {
    expect(flipkartWindows('2026-08-01', '2026-10-12')).toEqual([
      { from: '2026-08-01', to: '2026-09-29' },
      { from: '2026-09-30', to: '2026-10-12' }
    ])
    expect(flipkartWindows('2026-10-12', '2026-10-01')).toEqual([])
  })

  it('reads the date shapes a sheet can carry', () => {
    expect(flipkartDate('2026-09-02 10:15:00')).toBe('2026-09-02')
    expect(flipkartDate('2/9/2026')).toBe('2026-09-02')
    expect(flipkartDate('')).toBe('')
  })

  it('keys forward rows by order item alone', () => {
    expect(flipkartKey('forward', ' 1a ')).toBe('1A')
  })
})

/**
 * Flipkart's export tags every identifier so Excel keeps it as text. These are
 * the values as the Report Centre served them for an Orders report.
 */
describe('the tags Flipkart wraps an identifier in', () => {
  it('takes them off an Orders row exactly as served', () => {
    const record = toFlipkartRecord(
      'forward',
      {
        order_item_id: 'OI:438512650864022100',
        sku: '"""SKU:8905834070408"""',
        delivery_tracking_id: 'DTr:FMPC6455977337',
        order_date: '2026-09-01 19:29:53'
      },
      context
    )

    expect(record).toMatchObject({
      key: '438512650864022100',
      orderItemId: '438512650864022100',
      sku: '8905834070408',
      awb: 'FMPC6455977337',
      date: '2026-09-01'
    })
  })

  it('keys a return on its untagged return id', () => {
    const record = toFlipkartRecord(
      'return',
      { order_item_id: 'OI:338511663906883100', return_id: 'R:12254830450163589435977728' },
      context
    )

    expect(record?.key).toBe('338511663906883100|12254830450163589435977728')
  })

  it('leaves an untagged value, and an empty one, alone', () => {
    expect(flipkartId('FMPC123')).toBe('FMPC123')
    expect(flipkartId('')).toBe('')
    expect(flipkartId('DTr:NA')).toBe('')
  })

  it("strips only the SKU tag from a SKU, never a seller's own colon", () => {
    expect(flipkartSku('"""SKU:ABC-1"""')).toBe('ABC-1')
    expect(flipkartSku('TS:RED-M')).toBe('TS:RED-M')
  })
})
