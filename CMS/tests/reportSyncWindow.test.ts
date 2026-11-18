import { describe, expect, it } from 'vitest'
import { reportSyncFrom } from '@shared/utils/reportSyncWindow'

describe('where a scheduled report sync starts', () => {
  const today = '2026-10-10'

  it('reads the last two days for an account that has never synced', () => {
    expect(reportSyncFrom(null, today)).toBe('2026-10-08')
    expect(reportSyncFrom(undefined, today)).toBe('2026-10-08')
  })

  it('continues from the last date held, so a few missed days are not lost', () => {
    expect(reportSyncFrom('2026-10-05', today)).toBe('2026-10-05')
  })

  it('still re-reads at least two days when the last sync was recent', () => {
    // AJIO back-dates rows; yesterday and the day before are read again.
    expect(reportSyncFrom('2026-10-10', today)).toBe('2026-10-08')
    expect(reportSyncFrom('2026-10-09', today)).toBe('2026-10-08')
  })

  it('catches up a gap of exactly a week', () => {
    expect(reportSyncFrom('2026-10-03', today)).toBe('2026-10-03')
  })

  it('falls back to the last two days when the last sync is more than a week old', () => {
    expect(reportSyncFrom('2026-10-02', today)).toBe('2026-10-08')
    expect(reportSyncFrom('2026-01-01', today)).toBe('2026-10-08')
  })

  it('crosses a month boundary', () => {
    expect(reportSyncFrom(null, '2026-11-01')).toBe('2026-10-30')
  })

  it('treats an unreadable stamp as never synced', () => {
    expect(reportSyncFrom('yesterday', today)).toBe('2026-10-08')
  })
})

describe('AJIO — catches up to 30 days', () => {
  const today = '2026-10-10'
  const ajio = (last: string | null): string =>
    reportSyncFrom(last, today, 2, { staleDays: 30, fallbackDays: 30 })

  it('reads the last 30 days for an account that has never synced', () => {
    expect(ajio(null)).toBe('2026-09-10')
  })

  it('continues from the last date held, up to 30 days back', () => {
    expect(ajio('2026-09-20')).toBe('2026-09-20')
    expect(ajio('2026-09-10')).toBe('2026-09-10')
  })

  it('still re-reads the last two days after a recent sync', () => {
    expect(ajio('2026-10-10')).toBe('2026-10-08')
  })

  it('reads the last 30 days when the last sync is older than that', () => {
    expect(ajio('2026-09-09')).toBe('2026-09-10')
    expect(ajio('2026-01-01')).toBe('2026-09-10')
  })
})

describe('a report that must be re-read for longer (Snapdeal)', () => {
  const today = '2026-10-10'

  it('re-reads the given number of days, and uses it when there is nothing to continue from', () => {
    expect(reportSyncFrom(null, today, 7)).toBe('2026-10-03')
    expect(reportSyncFrom('2026-10-09', today, 7)).toBe('2026-10-03')
    expect(reportSyncFrom('2026-09-01', today, 7)).toBe('2026-10-03')
  })
})
