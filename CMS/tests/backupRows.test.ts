import { describe, expect, it } from 'vitest'
import {
  halveWindow,
  monthsBetween,
  monthWindow,
  recordKey,
  rowDate,
  windowDays,
  ymd
} from '../shared/utils/backupRows'

/**
 * The AJIO backup's arithmetic.
 *
 * Each of these is a silent failure if it is wrong: a key that does not match
 * duplicates the whole month on the next re-sync, a date that does not parse
 * hides a row from the calendar, and a month walk that stops early loses a
 * month with nothing to show for it. None of it is visible from the UI, so it
 * is checked here.
 */

describe('recordKey', () => {
  it('pairs AWB with EAN, so a multi-article shipment is not collapsed', () => {
    const first = recordKey('AWB123', '8901234567890')
    const second = recordKey('AWB123', '8909999999999')

    expect(first).not.toBe(second)
  })

  it('ignores casing and padding, so one row cannot be stored twice', () => {
    expect(recordKey(' awb123 ', ' 890abc ')).toBe(recordKey('AWB123', '890ABC'))
  })

  it('accepts a numeric AWB — AJIO sends both', () => {
    expect(recordKey(23409613897273, '890')).toBe('23409613897273|890')
  })

  it('still produces a key when a side is missing, rather than throwing', () => {
    expect(recordKey(null, undefined)).toBe('|')
  })
})

describe('rowDate', () => {
  it('reads a forward row from orderDate', () => {
    expect(rowDate({ orderDate: '2026-08-14' })).toBe('2026-08-14')
  })

  it('reads a return row from returnCreateDate', () => {
    expect(rowDate({ returnCreateDate: '2026-08-14T09:12:00.000Z' })).toBe('2026-08-14')
  })

  it('converts dd-MM-yyyy, which AJIO also sends', () => {
    expect(rowDate({ orderDate: '14-08-2026' })).toBe('2026-08-14')
    expect(rowDate({ orderDate: '14/08/2026' })).toBe('2026-08-14')
  })

  it('prefers orderDate over the later fallbacks', () => {
    expect(rowDate({ orderDate: '2026-08-01', returnCreateDate: '2026-09-01' })).toBe('2026-08-01')
  })

  it('falls through to shipmentDate when neither of the first two is there', () => {
    expect(rowDate({ shipmentDate: '02-01-2026' })).toBe('2026-01-02')
  })

  it('returns empty rather than guessing at an unrecognised date', () => {
    expect(rowDate({ orderDate: 'Aug 14 2026' })).toBe('')
    expect(rowDate({ orderDate: 42 })).toBe('')
    expect(rowDate({})).toBe('')
  })
})

describe('monthWindow', () => {
  it('spans the whole month', () => {
    expect(monthWindow(2026, 8)).toEqual({ from: '2026-08-01', to: '2026-08-31' })
  })

  it('ends on the 30th where the month is short', () => {
    expect(monthWindow(2026, 9).to).toBe('2026-09-30')
  })

  it('knows February in a leap year', () => {
    expect(monthWindow(2024, 2).to).toBe('2024-02-29')
    expect(monthWindow(2026, 2).to).toBe('2026-02-28')
  })
})

describe('monthsBetween', () => {
  it('is inclusive at both ends', () => {
    expect(monthsBetween(2026, 3, 2026, 5)).toEqual([
      { year: 2026, month: 3 },
      { year: 2026, month: 4 },
      { year: 2026, month: 5 }
    ])
  })

  it('rolls over the year boundary', () => {
    expect(monthsBetween(2025, 11, 2026, 2)).toEqual([
      { year: 2025, month: 11 },
      { year: 2025, month: 12 },
      { year: 2026, month: 1 },
      { year: 2026, month: 2 }
    ])
  })

  it('returns the single month when both ends are the same', () => {
    expect(monthsBetween(2026, 7, 2026, 7)).toEqual([{ year: 2026, month: 7 }])
  })

  it('returns nothing when the range runs backwards, rather than looping forever', () => {
    expect(monthsBetween(2026, 7, 2026, 3)).toEqual([])
  })
})

describe('ymd', () => {
  it('formats a local date, padded', () => {
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('stays on the local day near midnight, where UTC would slip a day', () => {
    expect(ymd(new Date(2026, 8, 17, 23, 30))).toBe('2026-09-17')
    expect(ymd(new Date(2026, 8, 17, 0, 30))).toBe('2026-09-17')
  })
})

describe('halveWindow', () => {
  it('splits a month into two halves that meet without overlapping', () => {
    const halves = halveWindow({ from: '2026-01-01', to: '2026-01-31' })

    expect(halves).toEqual([
      { from: '2026-01-01', to: '2026-01-16' },
      { from: '2026-01-17', to: '2026-01-31' }
    ])
  })

  it('splits a two-day window 1 + 1 rather than 2 + 0', () => {
    // Rounding UP here would return the whole window as the first half and
    // recurse for ever — the reason the midpoint rounds down.
    expect(halveWindow({ from: '2026-03-01', to: '2026-03-02' })).toEqual([
      { from: '2026-03-01', to: '2026-03-01' },
      { from: '2026-03-02', to: '2026-03-02' }
    ])
  })

  it('refuses to split a single day', () => {
    // The bottom of the recursion: a day over AJIO's cap cannot be narrowed,
    // and the caller has to report it rather than loop.
    expect(halveWindow({ from: '2026-03-01', to: '2026-03-01' })).toBeNull()
  })

  it('refuses a window whose dates are the wrong way round or unreadable', () => {
    expect(halveWindow({ from: '2026-03-10', to: '2026-03-01' })).toBeNull()
    expect(halveWindow({ from: 'not-a-date', to: '2026-03-01' })).toBeNull()
  })
})

describe('windowDays', () => {
  it('counts both ends of the window', () => {
    expect(windowDays({ from: '2026-01-01', to: '2026-01-31' })).toBe(31)
    expect(windowDays({ from: '2026-07-01', to: '2026-07-01' })).toBe(1)
    expect(windowDays({ from: '2026-02-01', to: '2026-02-28' })).toBe(28)
  })

  it('is 0 for a window that cannot be read', () => {
    // Backwards or unparseable: a progress denominator must not be negative,
    // and a bar cannot divide by a guess.
    expect(windowDays({ from: '2026-03-10', to: '2026-03-01' })).toBe(0)
    expect(windowDays({ from: 'nonsense', to: '2026-03-01' })).toBe(0)
  })

  it('counts the halves of a split back to the whole', () => {
    // The property the month bar depends on: splitting a window never changes
    // how many days it covers, so days done can never exceed days total.
    const whole = { from: '2026-01-01', to: '2026-01-31' }
    const halves = halveWindow(whole)

    expect(halves).not.toBeNull()
    expect(windowDays(halves![0]) + windowDays(halves![1])).toBe(windowDays(whole))
  })
})
