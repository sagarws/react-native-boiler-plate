import { describe, expect, it } from 'vitest'
import {
  addPage,
  EMPTY_TALLY,
  formatBytes,
  jsonBytes,
  projectTotal
} from '@shared/utils/dataSize'

/**
 * Measuring what a report would cost to keep as JSON on the operator's machine.
 *
 * The numbers are acted on — "can we hold a year of this locally" — so the two
 * things that must hold are that it counts the bytes that actually land on disk
 * (UTF-8, not UTF-16 code units) and that paging back and forth cannot inflate
 * the total.
 */

const rows = [
  { awb: 'R2514485437AJI', sku: '8905834541809', status: 'RETURN_CREATED' },
  { awb: 'R2521185177AJI', sku: '8905834324037', status: 'RETURN_CREATED' }
]

describe('jsonBytes', () => {
  it('measures the serialised bytes', () => {
    expect(jsonBytes(rows)).toBe(new TextEncoder().encode(JSON.stringify(rows)).length)
    expect(jsonBytes([])).toBe(2) // "[]"
  })

  it('counts a non-ASCII character as the bytes it takes on disk', () => {
    // ₹ is three UTF-8 bytes and one UTF-16 code unit — the gap that makes
    // `JSON.stringify(...).length` under-report a report full of prices.
    const utf16 = JSON.stringify([{ price: '₹175' }]).length

    expect(jsonBytes([{ price: '₹175' }])).toBe(utf16 + 2)
  })
})

describe('addPage', () => {
  it('adds a page once, however many times it is pressed', () => {
    const once = addPage(EMPTY_TALLY, 'p1', rows)
    const twice = addPage(once, 'p1', rows)

    expect(twice).toBe(once)
    expect(twice.rows).toBe(2)
  })

  it('accumulates across pages', () => {
    const tally = addPage(addPage(EMPTY_TALLY, 'p1', rows), 'p2', rows)

    expect(tally.rows).toBe(4)
    expect(tally.bytes).toBe(jsonBytes(rows) * 2)
    expect(tally.pages).toEqual(['p1', 'p2'])
  })
})

describe('projectTotal', () => {
  it('projects the whole report from the average row', () => {
    const tally = addPage(EMPTY_TALLY, 'p1', rows)
    const perRow = tally.bytes / tally.rows

    expect(projectTotal(tally, 1000)).toBe(Math.round(perRow * 1000))
  })

  it('refuses to guess with nothing measured', () => {
    // A number invented from no sample is worse than no number.
    expect(projectTotal(EMPTY_TALLY, 1000)).toBeNull()
    expect(projectTotal(addPage(EMPTY_TALLY, 'p1', rows), 0)).toBeNull()
  })
})

describe('formatBytes', () => {
  it('reads the way a person would say it', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(1024 * 1024 * 3.5)).toBe('3.50 MB')
    // Past 10 the second decimal is noise, so it drops to one place.
    expect(formatBytes(1024 * 1024 * 15.25)).toBe('15.3 MB')
  })
})
