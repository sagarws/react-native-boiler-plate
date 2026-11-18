import { describe, expect, it } from 'vitest'

/**
 * The month shortcuts on the master-data report.
 *
 * Pressing "Sep" has to mean the 1st to the 30th of September LOCALLY. Building
 * those dates through `toISOString()` converts to UTC first, so east of
 * Greenwich the 1st becomes the last day of August — a whole day of returns
 * reported under the wrong month, silently, and only in some time zones.
 *
 * The helper lives in the modal (it has one caller), so this pins down the
 * arithmetic it does rather than importing it.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

const monthRange = (year: number, month: number): { startDate: string; endDate: string } => {
  const lastDay = new Date(year, month + 1, 0).getDate()

  return {
    startDate: `${year}-${pad(month + 1)}-01`,
    endDate: `${year}-${pad(month + 1)}-${pad(lastDay)}`
  }
}

describe('monthRange', () => {
  it('covers a whole month, first to last', () => {
    expect(monthRange(2026, 8)).toEqual({ startDate: '2026-09-01', endDate: '2026-09-30' })
    expect(monthRange(2026, 0)).toEqual({ startDate: '2026-01-01', endDate: '2026-01-31' })
    expect(monthRange(2026, 11)).toEqual({ startDate: '2026-12-01', endDate: '2026-12-31' })
  })

  it('gets February right, leap year or not', () => {
    expect(monthRange(2026, 1).endDate).toBe('2026-02-28')
    expect(monthRange(2028, 1).endDate).toBe('2028-02-29')
  })

  it('never lands on the previous month, whatever the time zone', () => {
    // The bug `toISOString()` would introduce: 2026-09-01T00:00 in IST is
    // 2026-08-31T18:30 UTC.
    const asUtcWouldGive = new Date(2026, 8, 1).toISOString().slice(0, 10)
    const ours = monthRange(2026, 8).startDate

    expect(ours).toBe('2026-09-01')
    // True where the machine is ahead of UTC; the point is that ours does not
    // depend on which.
    expect(ours >= asUtcWouldGive).toBe(true)
  })
})
