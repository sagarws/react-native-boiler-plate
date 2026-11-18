import { describe, expect, it } from 'vitest'
import type { ECommercePlatformRecord } from '@shared/types/cmsCreate'
import {
  applyRefill,
  editRow,
  needsRefill,
  platformSheets,
  refillRequestRow,
  rowsFromWorkbook,
  type BulkRow
} from '@renderer/pages/claims/create/bulk/normalBulk'

/**
 * Normal Bulk Claim refills a row that carries little more than its return AWB
 * before verifying it, instead of rejecting it for the blanks.
 */

const platform = (name: string): ECommercePlatformRecord =>
  ({ _id: `id-${name}`, name, claimTypes: [] }) as unknown as ECommercePlatformRecord

const rowFor = (name: string, cells: Record<string, string>, accounts: string[] = []): BulkRow => {
  const sheets = platformSheets([platform(name)], () => accounts)
  const { rows } = rowsFromWorkbook(
    { fileName: 'x.xlsx', sheets: [{ name, rows: [{ rowNumber: 2, cells }] }] },
    sheets
  )

  return rows[0] as BulkRow
}

describe('which rows are refilled', () => {
  it('refills a Snapdeal row that has only its return AWB', () => {
    expect(needsRefill(rowFor('Snapdeal', { 'Return AWB': 'SDLR1' }))).toBe(true)
  })

  it('leaves a row alone when nothing refill answers is blank', () => {
    const row = rowFor('Snapdeal', {
      'Return AWB': 'SDLR1',
      'Forward AWB': 'SF1',
      SKU: 'SKU-1',
      'Sub Order Number': '7524',
      'Seller Account': 'a@x.com'
    })

    expect(needsRefill(row)).toBe(false)
  })

  it('does not refill a platform whose bulk spec has not opted in', () => {
    expect(needsRefill(rowFor('Meesho', { 'Return AWB': 'M1' }))).toBe(false)
  })

  it('does not refill a row with no AWB to search by', () => {
    expect(needsRefill(rowFor('Snapdeal', { 'Return AWB': '' }))).toBe(false)
  })
})

describe('what refill writes into the row', () => {
  it('fills blank cells, keeps typed ones, and says where the answer came from', () => {
    const row = rowFor('Snapdeal', { 'Return AWB': 'SDLR1', SKU: 'TYPED' })

    expect(refillRequestRow(row)).toMatchObject({ awb: 'SDLR1', sku: 'TYPED', forwardAWB: '' })

    const next = applyRefill(row, {
      id: row.id,
      values: { forwardAWB: 'SF4194260373SDM', subOrderNumber: '75241614550', sku: 'FROM-BACKUP' },
      source: 'local',
      message: null
    })

    expect(next.cells['Forward AWB']).toBe('SF4194260373SDM')
    expect(next.cells['Sub Order Number']).toBe('75241614550')
    // A value the operator typed is never replaced.
    expect(next.cells.SKU).toBe('TYPED')
    expect(next.refill).toEqual({ source: 'local', filled: ['forward AWB', 'sub-order'], message: null })
    expect(next.status).toBe('pending')
  })

  it('keeps an answer with no column on the sheet — Flipkart’s order item id', () => {
    const row = rowFor('Flipkart', { 'Return AWB': 'FMPR1' })
    const next = applyRefill(row, {
      id: row.id,
      values: { subOrderNumber: 'OI-1' },
      source: 'local',
      message: null
    })

    expect(next.refilled).toEqual({ subOrderNumber: 'OI-1' })
  })

  it('goes on to verification unfilled when refill had nothing for it', () => {
    const row = rowFor('Myntra', { 'Return AWB': 'MY1' })

    expect(applyRefill(row, undefined).status).toBe('pending')
  })
})

describe('editing a row', () => {
  it('takes the new cells and sends the row back to be checked', () => {
    const row = { ...rowFor('Snapdeal', { 'Return AWB': 'OLD' }), status: 'invalid' as const, errors: ['x'] }
    const next = editRow(row, { ...row.cells, 'Return AWB': ' NEW ' })

    expect(next.awb).toBe('NEW')
    expect(next.status).toBe('pending')
    expect(next.errors).toEqual([])
  })
})
