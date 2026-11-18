import { describe, expect, it } from 'vitest'
import { pageWindow, rowMatches, type PageToken } from '@shared/constants/reportTable'

/**
 * Paging and searching a live AJIO report.
 *
 * The report runs to two hundred pages. Previous/Next alone cannot reach page
 * 137, and two hundred numbers cannot be drawn — so the window has to be right,
 * because an off-by-one here sends an operator to the wrong page of a report
 * they are checking a claim against.
 */

const numbers = (tokens: PageToken[]): PageToken[] => tokens

describe('pageWindow', () => {
  it('lists every page when they all fit', () => {
    expect(pageWindow(1, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('always shows the first and last page', () => {
    const tokens = pageWindow(100, 200)

    expect(tokens[0]).toBe(1)
    expect(tokens.at(-1)).toBe(200)
  })

  it('breaks the run where numbers were left out', () => {
    expect(pageWindow(100, 200)).toEqual([1, 'gap', 99, 100, 101, 'gap', 200])
  })

  it('keeps a constant width at the ends', () => {
    // A window that shrank near the ends would move the buttons under the
    // cursor as someone pages through, which is how a click lands on the wrong
    // number.
    const first = pageWindow(1, 200)
    const middle = pageWindow(100, 200)
    const last = pageWindow(200, 200)

    expect(first.length).toBe(middle.length)
    expect(last.length).toBe(middle.length)
  })

  it('extends the window away from whichever end it is against', () => {
    expect(pageWindow(1, 200)).toEqual([1, 2, 3, 4, 5, 'gap', 200])
    expect(pageWindow(200, 200)).toEqual([1, 'gap', 196, 197, 198, 199, 200])
  })

  it('never emits a page outside the report', () => {
    const cases: [number, number][] = [
      [1, 1],
      [5, 3],
      [0, 10],
      [-4, 10]
    ]

    for (const [current, total] of cases) {
      for (const token of numbers(pageWindow(current, total))) {
        if (token === 'gap') continue

        expect(token).toBeGreaterThanOrEqual(1)
        expect(token).toBeLessThanOrEqual(total)
      }
    }
  })

  it('has nothing to show for an empty report', () => {
    expect(pageWindow(1, 0)).toEqual([])
  })
})

const COLUMNS = [
  { key: 'returnOrderNo' },
  { key: 'returnAwbNo' },
  { key: 'sellerSku' },
  { key: 'returnQty' }
]

const row = {
  returnOrderNo: 'RT228555874',
  returnAwbNo: 'R2485233567AJI',
  sellerSku: null,
  returnQty: 1,
  // Present on the row, absent from the columns — see the last test.
  creditNoteNo: 'CN-9911'
}

describe('rowMatches', () => {
  it('finds a row by any column on screen', () => {
    expect(rowMatches(row, COLUMNS, 'RT2285')).toBe(true)
    expect(rowMatches(row, COLUMNS, 'R2485233567AJI')).toBe(true)
  })

  it('ignores case and surrounding space', () => {
    expect(rowMatches(row, COLUMNS, '  r2485233567aji ')).toBe(true)
  })

  it('matches a number as typed', () => {
    // Qty and value columns are numbers; stringifying is what makes them
    // searchable at all.
    expect(rowMatches(row, COLUMNS, '1')).toBe(true)
  })

  it('keeps every row when nothing is typed', () => {
    expect(rowMatches(row, COLUMNS, '')).toBe(true)
    expect(rowMatches(row, COLUMNS, '   ')).toBe(true)
  })

  it('does not match a null cell', () => {
    // "null" must never be a search term that finds the rows missing a SKU.
    expect(rowMatches(row, COLUMNS, 'null')).toBe(false)
  })

  it('searches only what is on screen', () => {
    // A row found for a reason the operator cannot see reads as a bug in the
    // filter.
    expect(rowMatches(row, COLUMNS, 'CN-9911')).toBe(false)
  })
})
