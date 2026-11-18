import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { readRows, writeTicketReport } from '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/bulkSpfExcel'

/**
 * Which columns the NDR/DDR bulk claim reads out of an uploaded sheet.
 *
 * The one that went wrong: AJIO's return report lists "Outward AWB No" (the
 * forward shipment) several columns before "Return AWB", and the reader took
 * the first AWB-looking header — every return was then looked up by the wrong
 * number and nothing matched.
 */

let dir = ''

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

const sheet = (rows: (string | number)[][]): string => {
  dir = dir || mkdtempSync(join(tmpdir(), 'bulk-spf-'))
  const path = join(dir, `${Math.random().toString(36).slice(2)}.xlsx`)
  const book = XLSX.utils.book_new()

  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), 'Sheet1')
  XLSX.writeFile(book, path)

  return path
}

const AJIO_REPORT = [
  'Code/ Con', 'Class', 'Channel Invoice No', 'Client SKU ID / EAN', 'Outward AWB No', 'Quantity',
  'B2C TBV', 'B2C Tax', 'Total TSV', 'Order Status', 'OR Status', 'OMS Ret Status', 'RT Number',
  'Return AWB', 'POB ID', 'Remarks', 'Ticket No'
]

describe('readRows', () => {
  it('reads AJIO\'s return report by "RT Number", keeping the Return AWB alongside', () => {
    const value = (header: string, awb: string, sku: string, ticket = ''): string =>
      header === 'Return AWB'
        ? awb
        : header === 'Client SKU ID / EAN'
          ? sku
          : header === 'Outward AWB No'
            ? 'FWD-999'
            : header === 'POB ID'
              ? 'DV00332648'
              : header === 'Ticket No'
                ? ticket
                : header === 'RT Number'
                  ? `RT-${awb}`
                  : 'x'

    const path = sheet([
      AJIO_REPORT,
      AJIO_REPORT.map(h => value(h, 'R2454706713', '8907979450855')),
      AJIO_REPORT.map(h => value(h, 'R2458256641', '8907979450862', '7789361346834'))
    ])

    const read = readRows(path, { claimType: 'ndr' })

    // "RT Number" is AJIO's name for the return order number, and it wins: it
    // resolves the return directly, so the claim skips the AWB search — which is
    // the only way to reach a self-ship return or one older than the search
    // window. It used to be ignored, and every claim from AJIO's own report
    // searched for an id the sheet was already carrying.
    expect(read.idHeader).toBe('RT Number')
    expect(read.skuHeader).toBe('Client SKU ID / EAN')
    expect(read.pobHeader).toBe('POB ID')
    expect(read.ticketHeader).toBe('Ticket No')
    expect(read.byRon).toBe(true)
    expect(read.ids).toEqual(['RT-R2454706713', 'RT-R2458256641'])
    // BOTH identifiers survive. They do different jobs — the order number
    // resolves the return at AJIO, the AWB is what the results sheet and the
    // write-back report under — and they used to be mutually exclusive, so the
    // report's own AWB was discarded.
    expect(read.rows[0]).toEqual({
      id: 'RT-R2454706713',
      ron: 'RT-R2454706713',
      awb: 'R2454706713',
      sku: '8907979450855',
      claimType: 'NDR',
      pobid: 'DV00332648',
      ticketNumber: ''
    })
    expect(read.rows[1]).toMatchObject({ ticketNumber: '7789361346834' })
  })

  it('never takes the forward AWB, even now that RT Number wins', () => {
    const path = sheet([
      ['Outward AWB No', 'RT Number', 'Return AWB', 'POB ID'],
      ['FWD-999', 'RT-1', 'RET-1', 'DV1']
    ])
    const read = readRows(path)

    expect(read.idHeader).toBe('RT Number')
    expect(read.rows[0]).toMatchObject({ ron: 'RT-1', awb: 'RET-1' })
  })

  it('accepts the desktop template: RT Number, Return AWB, SKU, POB', () => {
    // Either identifier is enough. Filled with the order number alone — which is
    // the case an AWB-less self-ship return leaves an operator with.
    const read = readRows(
      sheet([
        ['RT Number', 'Return AWB', 'Client SKU ID / EAN', 'POB ID'],
        ['RT-7', '', 'SKU-7', 'DV1']
      ])
    )

    expect(read.byRon).toBe(true)
    expect(read.rows[0]).toMatchObject({ id: 'RT-7', ron: 'RT-7', awb: '', pobid: 'DV1' })
  })

  it('keeps reading the template exactly as before', () => {
    const read = readRows(sheet([['Return Order No', 'Seller SKU'], ['RON1', 'SKU1']]))

    expect(read.idHeader).toBe('Return Order No')
    expect(read.skuHeader).toBe('Seller SKU')
    expect(read.byRon).toBe(true)
    // No POB column: rows still read (the server's master-data flow needs none).
    expect(read.pobHeader).toBeNull()
    expect(read.rows[0]).toMatchObject({ pobid: '', ticketNumber: '' })
  })

  it('still accepts a plain "Return AWB No" sheet with no SKU column', () => {
    const read = readRows(sheet([['Return AWB No'], ['R1'], ['R1']]))

    expect(read.idHeader).toBe('Return AWB No')
    expect(read.skuHeader).toBeNull()
    expect(read.ids).toEqual(['R1'])
  })

  it('prefers "Seller SKU" when a sheet has both SKU columns', () => {
    const read = readRows(sheet([['Client SKU ID / EAN', 'Seller SKU', 'Return AWB'], ['EAN1', 'SKU1', 'R1']]))

    expect(read.skuHeader).toBe('Seller SKU')
    expect(read.rows[0]).toMatchObject({ sku: 'SKU1' })
  })

  it('refuses a sheet whose only AWB is the forward one', () => {
    expect(() => readRows(sheet([['Outward AWB No', 'Client SKU ID / EAN'], ['FWD1', 'EAN1']]))).toThrow(
      /Return AWB/
    )
  })
})

describe('writeTicketReport', () => {
  it('writes a Success and a Failed sheet keyed by Return AWB', () => {
    dir = mkdtempSync(join(tmpdir(), 'bulk-spf-'))
    const path = join(dir, 'report.xlsx')

    writeTicketReport(path, {
      success: [{ awb: 'SF3642735279AJI', sku: '8907279922724', ticketId: 'T-1' }],
      failed: [{ awb: 'R2356381779AJI', sku: '8909196734589', reason: 'Failed: claim create failed' }]
    })

    const book = XLSX.readFile(path)
    const rows = (name: string): unknown[][] =>
      XLSX.utils.sheet_to_json(book.Sheets[name] as XLSX.WorkSheet, { header: 1 })

    expect(book.SheetNames).toEqual(['Success', 'Failed'])
    expect(rows('Success')).toEqual([
      ['RETURN AWB', 'SELLER SKU', 'TICKET ID'],
      ['SF3642735279AJI', '8907279922724', 'T-1']
    ])
    expect(rows('Failed')).toEqual([
      ['RETURN AWB', 'SELLER SKU', 'FAILED REASON'],
      ['R2356381779AJI', '8909196734589', 'Failed: claim create failed']
    ])
  })
})
