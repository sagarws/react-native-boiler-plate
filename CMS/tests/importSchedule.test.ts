import { describe, expect, it } from 'vitest'
import { isRunDue, isValidSyncTime, nextRunAt } from '@shared/utils/importSchedule'

/** 2026-08-31 12:00 IST — a fixed instant so nothing depends on the wall clock. */
const NOON_IST = Date.parse('2026-08-31T06:30:00.000Z')
const istString = (ms: number): string =>
  new Date(ms + 5.5 * 60 * 60 * 1000).toISOString().replace('.000Z', ' IST')

describe('isValidSyncTime', () => {
  it('accepts a zero-padded 24-hour time', () => {
    expect(isValidSyncTime('02:00')).toBe(true)
    expect(isValidSyncTime('23:59')).toBe(true)
    expect(isValidSyncTime('00:00')).toBe(true)
  })

  it('rejects an unpadded hour, an impossible time, and a non-string', () => {
    expect(isValidSyncTime('3:05')).toBe(false)
    expect(isValidSyncTime('24:00')).toBe(false)
    expect(isValidSyncTime('12:60')).toBe(false)
    expect(isValidSyncTime(null)).toBe(false)
    expect(isValidSyncTime(1200)).toBe(false)
  })
})

describe('nextRunAt', () => {
  it('returns later today when the time has not passed', () => {
    // 18:00 IST is still ahead of 12:00 IST.
    expect(istString(nextRunAt('18:00', NOON_IST) as number)).toBe('2026-08-31T18:00:00 IST')
  })

  it('rolls to tomorrow when the time has passed', () => {
    expect(istString(nextRunAt('02:00', NOON_IST) as number)).toBe('2026-09-01T02:00:00 IST')
  })

  it('rolls to tomorrow when the time is exactly now', () => {
    // Equal is treated as passed: otherwise a run triggered at exactly the
    // scheduled second would schedule itself again immediately.
    expect(istString(nextRunAt('12:00', NOON_IST) as number)).toBe('2026-09-01T12:00:00 IST')
  })

  it('is computed in IST regardless of the machine timezone', () => {
    // 02:00 IST is 20:30 UTC the previous day; the answer must not shift with
    // the host's offset.
    expect(new Date(nextRunAt('02:00', NOON_IST) as number).toISOString()).toBe(
      '2026-08-31T20:30:00.000Z'
    )
  })

  it('returns null for no schedule or a malformed one', () => {
    expect(nextRunAt(null, NOON_IST)).toBeNull()
    expect(nextRunAt('nope', NOON_IST)).toBeNull()
  })
})

describe('isRunDue', () => {
  /** Baseline: the app first saw the schedule two days ago. */
  const INSTALLED = Date.parse('2026-08-29T10:00:00.000+05:30')

  it('is due when today’s scheduled time has passed since the baseline', () => {
    expect(isRunDue('02:00', INSTALLED, NOON_IST)).toBe(true)
  })

  it('is not due when the baseline is after the last scheduled moment', () => {
    // Installed at 09:00 today; 02:00 already passed before this machine knew
    // about the schedule, so it is not owed a run it could never have made.
    const installedThisMorning = Date.parse('2026-08-31T09:00:00.000+05:30')

    expect(isRunDue('02:00', installedThisMorning, NOON_IST)).toBe(false)
  })

  it('is not due when today’s run already happened', () => {
    const ranAt = Date.parse('2026-08-31T02:30:00.000+05:30')

    expect(isRunDue('02:00', ranAt, NOON_IST)).toBe(false)
  })

  it('is due again the next day', () => {
    const ranYesterday = Date.parse('2026-08-30T02:30:00.000+05:30')

    expect(isRunDue('02:00', ranYesterday, NOON_IST)).toBe(true)
  })

  it('is not due when the scheduled time is still ahead today', () => {
    const ranYesterdayEvening = Date.parse('2026-08-30T18:30:00.000+05:30')

    expect(isRunDue('18:00', ranYesterdayEvening, NOON_IST)).toBe(false)
  })

  it('catches up rather than drifting', () => {
    // Closed at 02:00, opened at 12:00: the run is still owed, and running it
    // late must not push tomorrow's to 12:00.
    expect(isRunDue('02:00', INSTALLED, NOON_IST)).toBe(true)

    expect(istString(nextRunAt('02:00', NOON_IST) as number)).toBe('2026-09-01T02:00:00 IST')
  })

  it('is never due without a schedule', () => {
    expect(isRunDue(null, INSTALLED, NOON_IST)).toBe(false)
  })
})
