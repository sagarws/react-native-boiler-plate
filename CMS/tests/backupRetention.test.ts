import { describe, expect, it } from 'vitest'
import {
  clampToRetention,
  isRetainedMonth,
  retainedMonths,
  retainedMonthsIn,
  retainedYears,
  retentionStart
} from '../shared/utils/backupRetention'

const october = new Date(2026, 9, 12)
const february = new Date(2027, 1, 3)

describe('backup retention', () => {
  it('keeps five months ending with the current one', () => {
    expect(retainedMonths(october).map(entry => entry.month)).toEqual([6, 7, 8, 9, 10])
    expect(retentionStart(october)).toBe('2026-06-01')
  })

  it('drops the oldest month when a new one starts', () => {
    const november = new Date(2026, 10, 1)

    expect(isRetainedMonth(2026, 6, november)).toBe(false)
    expect(retentionStart(november)).toBe('2026-07-01')
  })

  it('spans the year boundary', () => {
    expect(retainedMonths(february)).toEqual([
      { year: 2026, month: 10 },
      { year: 2026, month: 11 },
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
      { year: 2027, month: 2 }
    ])
    expect(retainedYears(february)).toEqual([2027, 2026])
    expect(retainedMonthsIn(2026, february)).toEqual([10, 11, 12])
  })

  it('clamps a start date older than the window', () => {
    expect(clampToRetention('2026-01-15', october)).toBe('2026-06-01')
    expect(clampToRetention('2026-09-01', october)).toBe('2026-09-01')
  })
})
