import { describe, expect, it } from 'vitest'
import {
  MIN_INTERVAL_MINUTES,
  clockFromMinutes,
  cronFromLegacyTime,
  cronProblem,
  describeCron,
  isCronDue,
  minutesFromClock,
  nextCronRun,
  normaliseCron
} from '@shared/utils/cronSchedule'

/**
 * The two ways a scheduled task can be asked to run.
 *
 * Rotate — every N minutes — and Fix time — one or more times of day. This is
 * the arithmetic the whole schedule rests on, and it is pure precisely so it
 * can be pinned here rather than discovered at 02:00.
 */

/** 2026-09-19 at an IST hour, as an instant. */
const at = (hour: number, minute = 0, day = 19): number =>
  Date.UTC(2026, 8, day, hour - 5, minute - 30)

const MINUTE = 60_000

describe('what a schedule may say', () => {
  it('refuses an interval shorter than a task can finish in', () => {
    // A six-minute run on a one-minute interval is permanently owed: the
    // scheduler starts one the instant the last ends, forever.
    expect(cronProblem({ kind: 'interval', everyMinutes: 1 })).toBeTruthy()
    expect(cronProblem({ kind: 'interval', everyMinutes: MIN_INTERVAL_MINUTES })).toBeNull()
  })

  it('refuses an interval longer than a day, which is a fixed time badly spelled', () => {
    expect(cronProblem({ kind: 'interval', everyMinutes: 24 * 60 })).toBeNull()
    expect(cronProblem({ kind: 'interval', everyMinutes: 24 * 60 + 1 })).toBeTruthy()
  })

  it('needs at least one time, and every one of them to be a time', () => {
    expect(cronProblem({ kind: 'times', times: [] })).toBeTruthy()
    expect(cronProblem({ kind: 'times', times: ['02:00'] })).toBeNull()
    expect(cronProblem({ kind: 'times', times: ['02:00', 'half past'] })).toBeTruthy()
    expect(cronProblem({ kind: 'times', times: ['25:00'] })).toBeTruthy()
  })

  it('refuses the same time twice, which would run it twice', () => {
    expect(cronProblem({ kind: 'times', times: ['02:00', '02:00'] })).toBeTruthy()
  })

  it('says nothing is set rather than assuming one', () => {
    expect(cronProblem(null)).toBeTruthy()
  })
})

describe('rotate — every N minutes', () => {
  it('is due once the interval has elapsed, and not before', () => {
    const since = at(9)

    expect(isCronDue({ kind: 'interval', everyMinutes: 15 }, since, at(9, 14))).toBe(false)
    expect(isCronDue({ kind: 'interval', everyMinutes: 15 }, since, at(9, 15))).toBe(true)
  })

  it('counts from the last RUN, not from a wall-clock grid', () => {
    // A run that took twenty minutes does not immediately owe another: the
    // next one is fifteen minutes after it finished.
    const finishedAt = at(9, 20)

    expect(isCronDue({ kind: 'interval', everyMinutes: 15 }, finishedAt, at(9, 30))).toBe(false)
    expect(nextCronRun({ kind: 'interval', everyMinutes: 15 }, finishedAt, at(9, 30))).toBe(
      finishedAt + 15 * MINUTE
    )
  })

  it('is never due with no baseline at all', () => {
    // Measured from zero, every interval is overdue by decades — and every
    // task would fire the moment the app started.
    expect(isCronDue({ kind: 'interval', everyMinutes: 15 }, 0, at(9))).toBe(false)
  })

  it('reports an overdue run as due now, not as a moment in the past', () => {
    const since = at(9)
    const now = at(11)

    // "Next run: eleven minutes ago" reads as a schedule that has stopped.
    expect(nextCronRun({ kind: 'interval', everyMinutes: 15 }, since, now)).toBe(now)
  })
})

describe('fix time — one or more times of day', () => {
  const twice = { kind: 'times' as const, times: ['02:00', '14:00'] }

  it('is due after either time passes', () => {
    const armedAt = at(1)

    expect(isCronDue(twice, armedAt, at(1, 59))).toBe(false)
    expect(isCronDue(twice, armedAt, at(2, 1))).toBe(true)
  })

  it('runs again at the second time, having run at the first', () => {
    const ranAt = at(2, 5)

    expect(isCronDue(twice, ranAt, at(13, 59))).toBe(false)
    expect(isCronDue(twice, ranAt, at(14, 1))).toBe(true)
  })

  it('does not run the same window twice', () => {
    const ranAt = at(2, 5)

    expect(isCronDue(twice, ranAt, at(9))).toBe(false)
  })

  it('still runs a window the machine slept through', () => {
    // Closed overnight, opened at 09:00: that day's 02:00 is still owed. This
    // is the whole reason the question is "is a run owed" and not a timer.
    const ranYesterday = at(2, 5, 18)

    expect(isCronDue(twice, ranYesterday, at(9, 0, 19))).toBe(true)
  })

  it('answers with the soonest of them', () => {
    expect(nextCronRun(twice, at(9), at(9))).toBe(at(14))
    expect(nextCronRun(twice, at(15), at(15))).toBe(at(2, 0, 20))
  })
})

describe('the shapes the dialog collects', () => {
  it('reads an interval off a clock field', () => {
    expect(minutesFromClock('00:15')).toBe(15)
    expect(minutesFromClock('01:30')).toBe(90)
    // Zero is not an interval.
    expect(minutesFromClock('00:00')).toBeNull()
    expect(minutesFromClock('nonsense')).toBeNull()
  })

  it('writes one back', () => {
    expect(clockFromMinutes(15)).toBe('00:15')
    expect(clockFromMinutes(90)).toBe('01:30')
  })

  it('sorts times so two equal schedules look equal', () => {
    expect(normaliseCron({ kind: 'times', times: ['14:00', ' 02:00 '] })).toEqual({
      kind: 'times',
      times: ['02:00', '14:00']
    })
  })

  it('describes itself in one line', () => {
    expect(describeCron({ kind: 'interval', everyMinutes: 15 })).toBe('Every 15 min')
    expect(describeCron({ kind: 'interval', everyMinutes: 60 })).toBe('Every hour')
    expect(describeCron({ kind: 'interval', everyMinutes: 90 })).toBe('Every 1h 30m')
    expect(describeCron({ kind: 'times', times: ['02:00'] })).toBe('At 02:00')
    expect(describeCron({ kind: 'times', times: ['14:00', '02:00'] })).toBe('At 02:00, 14:00')
    expect(describeCron(null)).toBe('Not set')
  })
})

describe('the single time this replaces', () => {
  it('reads forward as the one fixed time it always meant', () => {
    // Nobody's 02:00 becomes "not set" on upgrade.
    expect(cronFromLegacyTime('02:00')).toEqual({ kind: 'times', times: ['02:00'] })
    expect(cronFromLegacyTime(null)).toBeNull()
    expect(cronFromLegacyTime('')).toBeNull()
  })
})
