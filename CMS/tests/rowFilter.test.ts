import { describe, expect, it } from 'vitest'
import type { CmsRow } from '@shared/types/cmsList'
import {
  activeFilterCount,
  applyFilters,
  BLANK,
  distinctValues,
  hasEmptySelection,
  isFiltered,
  previewRows,
  toFilters,
  withSelection
} from '@shared/utils/rowFilter'

/**
 * The Claims table's column filter — the spreadsheet kind.
 *
 * What these pin down is the part an operator would be misled by if it were
 * wrong: which rows survive (AND across columns, OR within one), that a column
 * ticked in full counts as no filter at all, and that "nothing ticked" is a
 * state of its own — without which both Clear buttons appear dead.
 */

const row = (over: Partial<CmsRow>): CmsRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  platform: 'Meesho',
  ticket: '',
  returnAwb: '',
  forwardAwb: '',
  sellerSku: '',
  pobId: '',
  status: 'Failed to Proceed',
  scriptStatus: 'Failed',
  attempts: 3,
  refillAttempts: 0,
  scriptError: '',
  scannedNumber: '',
  customerOrderNumber: '',
  subOrderNumber: '',
  driveStatus: '',
  brand: '',
  username: '',
  accountType: '',
  forwardOrderDate: '',
  feedName: '',
  createdAt: '',
  hasEvidence: true,
  amount: null,
  rejectReason: '',
  ...over
})

const rows = [
  row({ id: '1', returnAwb: 'AWB1', scriptError: 'TAT Expired' }),
  row({ id: '2', returnAwb: 'AWB2', scriptError: 'TAT Expired' }),
  row({ id: '3', returnAwb: 'AWB3', scriptError: 'UPLOAD_FAILED: barcode' }),
  row({ id: '4', returnAwb: 'AWB4', scriptError: '' })
]

describe('distinctValues', () => {
  it('counts each value and puts the commonest failure first', () => {
    // The reason to open this on a screen of failures is "which one is most of
    // them" — so that one is at the top.
    expect(distinctValues(rows, 'scriptError')).toEqual([
      { value: 'TAT Expired', count: 2 },
      { value: 'UPLOAD_FAILED: barcode', count: 1 },
      { value: BLANK, count: 1 }
    ])
  })

  it('sorts blanks last however many there are', () => {
    const blanks = [row({ scriptError: '' }), row({ scriptError: '' }), row({ scriptError: 'One' })]

    expect(distinctValues(blanks, 'scriptError').at(-1)?.value).toBe(BLANK)
  })
})

describe('applyFilters', () => {
  it('returns every row when nothing is filtered', () => {
    expect(applyFilters(rows, {})).toHaveLength(4)
  })

  it('ORs the values within one column', () => {
    const filtered = applyFilters(rows, { scriptError: ['TAT Expired', 'UPLOAD_FAILED: barcode'] })

    expect(filtered.map(entry => entry.id)).toEqual(['1', '2', '3'])
  })

  it('ANDs across columns', () => {
    const filtered = applyFilters(rows, { scriptError: ['TAT Expired'], returnAwb: ['AWB2'] })

    expect(filtered.map(entry => entry.id)).toEqual(['2'])
  })

  it('can select the rows with no failure reason at all', () => {
    // A blank cell is a value like any other — otherwise the rows that failed
    // silently are the ones that cannot be found.
    expect(applyFilters(rows, { scriptError: [BLANK] }).map(entry => entry.id)).toEqual(['4'])
  })
})

describe('withSelection', () => {
  const available = ['TAT Expired', 'UPLOAD_FAILED: barcode', BLANK]

  it('stores a partial selection', () => {
    const next = withSelection({}, 'scriptError', ['TAT Expired'], available)

    expect(next.scriptError).toEqual(['TAT Expired'])
    expect(activeFilterCount(next)).toBe(1)
  })

  it('treats "everything ticked" as no filter, so the count stays honest', () => {
    const next = withSelection({ scriptError: ['TAT Expired'] }, 'scriptError', available, available)

    expect(isFiltered(next, 'scriptError')).toBe(false)
    expect(activeFilterCount(next)).toBe(0)
  })

  it('leaves the other columns alone', () => {
    const next = withSelection({ returnAwb: ['AWB1'] }, 'scriptError', ['TAT Expired'], available)

    expect(next.returnAwb).toEqual(['AWB1'])
    expect(next.scriptError).toEqual(['TAT Expired'])
  })
})

describe('the dialog working copy', () => {
  // The bug this pins down: unticking a column used to collapse to "no filter",
  // which re-ticked every box, so both Clear buttons looked dead.
  it('keeps "nothing ticked" apart from "not filtered"', () => {
    expect(previewRows(rows, {})).toHaveLength(4)
    expect(previewRows(rows, { scriptError: [] })).toHaveLength(0)
    expect(hasEmptySelection({ scriptError: [] })).toBe(true)
    expect(hasEmptySelection({ scriptError: ['TAT Expired'] })).toBe(false)
    expect(hasEmptySelection({})).toBe(false)
  })

  it('counts the rows a partial selection would leave', () => {
    expect(previewRows(rows, { scriptError: ['TAT Expired'] })).toHaveLength(2)
  })

  it('drops a fully ticked column on Apply, so the button count is honest', () => {
    const everything = ['TAT Expired', 'UPLOAD_FAILED: barcode', BLANK]

    expect(toFilters({ scriptError: everything }, rows)).toEqual({})
    expect(toFilters({ scriptError: ['TAT Expired'] }, rows)).toEqual({
      scriptError: ['TAT Expired']
    })
  })

  it('applies what it previewed', () => {
    const picked = { scriptError: ['TAT Expired'], returnAwb: ['AWB1'] }

    expect(applyFilters(rows, toFilters(picked, rows)).map(entry => entry.id)).toEqual(
      previewRows(rows, picked).map(entry => entry.id)
    )
  })
})
