import { SYNC_TIME_PATTERN, isValidSyncTime, nextRunAt as nextDailyRun } from './importSchedule'

/**
 * When a scheduled task is next due — the two ways an operator can say it.
 *
 * ROTATE: every N minutes, forever. For work that is cheap and wants to be
 * current rather than punctual — a session check, a refill sweep. It counts
 * from the last run, not from a wall-clock grid, so a run that takes twenty
 * minutes does not immediately owe another.
 *
 * FIX TIME: one or more times of day, in IST. For work that belongs at a
 * particular hour — the AJIO report sync at 02:30, the claims after it. More
 * than one because "morning and evening" is a real requirement and the
 * alternative was two tasks doing the same thing.
 *
 * PURE, and deliberately so. Everything here is arithmetic on numbers a caller
 * supplies: no clock it reads for itself, no store, no timers. The scheduler is
 * a loop around these functions, which is what makes the part most likely to be
 * wrong the part that can be tested exhaustively.
 *
 * IST throughout, via `importSchedule`, because that is what every other
 * schedule in this system means by a time of day — and the machine running this
 * may be anywhere.
 */

/** Every N minutes, measured from the last completed run. */
export interface IntervalCron {
  kind: 'interval'
  /** How long between runs. Minutes, because that is the unit the dialog collects. */
  everyMinutes: number
}

/** At these times of day, IST. One or more, in "HH:mm". */
export interface TimesCron {
  kind: 'times'
  times: string[]
}

export type CronSchedule = IntervalCron | TimesCron

/**
 * The shortest interval that may be set.
 *
 * Five minutes, not one. Every one of these tasks opens a browser or sweeps a
 * marketplace, and a run that takes six minutes on a one-minute interval is
 * permanently owed — the scheduler would start one the instant the last
 * finished, forever, which is a loop rather than a schedule.
 */
export const MIN_INTERVAL_MINUTES = 5

/** A day, which is also the longest interval worth expressing this way. */
export const MAX_INTERVAL_MINUTES = 24 * 60

const MINUTE_MS = 60_000

/** "00:15" → 15. Returns null for anything that is not a duration. */
export const minutesFromClock = (value: string): number | null => {
  if (!SYNC_TIME_PATTERN.test(String(value ?? '').trim())) return null

  const [hours, minutes] = value.trim().split(':').map(Number)

  if (hours === undefined || minutes === undefined) return null

  const total = hours * 60 + minutes

  return total > 0 ? total : null
}

/** 15 → "00:15", for the dialog to show back what was stored. */
export const clockFromMinutes = (minutes: number): string => {
  const safe = Math.max(0, Math.round(minutes))

  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * Whether a schedule is usable, and what is wrong when it is not.
 *
 * Returns the operator's sentence, or null. Validation lives here rather than
 * in the dialog so the main process refuses the same things the form does — a
 * schedule that only the UI checks is one an IPC call can still write.
 */
export const cronProblem = (cron: CronSchedule | null | undefined): string | null => {
  if (!cron) return 'Choose how often this should run'

  if (cron.kind === 'interval') {
    const every = Number(cron.everyMinutes)

    if (!Number.isFinite(every) || every <= 0) return 'Enter how often this should run'
    if (every < MIN_INTERVAL_MINUTES) {
      return `Five minutes is the shortest interval — anything less never finishes before it is due again`
    }
    if (every > MAX_INTERVAL_MINUTES) return 'A day is the longest interval — use a fixed time instead'

    return null
  }

  if (cron.kind === 'times') {
    const times = Array.isArray(cron.times) ? cron.times : []

    if (times.length === 0) return 'Add at least one time'
    if (times.some(time => !isValidSyncTime(time))) return 'Enter each time as HH:mm, for example 02:00'
    if (new Set(times.map(time => time.trim())).size !== times.length) {
      return 'The same time is listed twice'
    }

    return null
  }

  return 'Choose how often this should run'
}

export const isValidCron = (cron: CronSchedule | null | undefined): boolean =>
  cronProblem(cron) === null

/** The times, trimmed and in order, so two equal schedules look equal. */
export const normaliseCron = (cron: CronSchedule): CronSchedule =>
  cron.kind === 'times'
    ? { kind: 'times', times: [...cron.times].map(time => time.trim()).sort() }
    : { kind: 'interval', everyMinutes: Math.round(cron.everyMinutes) }

/**
 * The next moment this schedule comes round, at or after `from`.
 *
 * `since` is when it last ran, which only an interval needs: a fixed time comes
 * round whether or not anything ran, while "every 15 minutes" is measured from
 * something.
 */
export const nextCronRun = (
  cron: CronSchedule | null | undefined,
  since: number,
  from: number = Date.now()
): number | null => {
  if (!cron || !isValidCron(cron)) return null

  if (cron.kind === 'interval') {
    const next = (since || from) + cron.everyMinutes * MINUTE_MS

    // Never in the past: a task that is overdue is due NOW, and saying "eleven
    // minutes ago" in a UI reads as a schedule that has stopped working.
    return Math.max(next, from)
  }

  // The soonest of them. Each is the next occurrence of that time of day, so
  // the earliest is the one that comes round first.
  const candidates = cron.times
    .map(time => nextDailyRun(time, from))
    .filter((at): at is number => at !== null)

  return candidates.length > 0 ? Math.min(...candidates) : null
}

/**
 * Is a run owed?
 *
 * `since` is the later of the last completed run and the moment this machine
 * armed the task — the baseline that stops a task switched on at 09:00 from
 * immediately firing the 02:00 window it missed this morning.
 *
 * FOR A FIXED TIME this asks whether the most recent occurrence falls after
 * that baseline, which is what makes a missed window run when the app opens
 * rather than being skipped, and what stops it drifting later each day.
 *
 * FOR AN INTERVAL it is simply elapsed time. With no baseline at all the task
 * is NOT due: an interval measured from zero is overdue by fifty-six years, and
 * every task would fire the moment the app started.
 */
export const isCronDue = (
  cron: CronSchedule | null | undefined,
  since: number,
  now: number = Date.now()
): boolean => {
  if (!cron || !isValidCron(cron)) return false
  if (!since) return false

  if (cron.kind === 'interval') return now - since >= cron.everyMinutes * MINUTE_MS

  return cron.times.some(time => {
    const next = nextDailyRun(time, now)

    if (next === null) return false

    // The most recent occurrence: the next one, minus a day.
    const mostRecent = next - 24 * 60 * MINUTE_MS

    return mostRecent <= now && since < mostRecent
  })
}

/**
 * The fixed-time slot this schedule most recently passed, or null.
 *
 * WHAT IT IS FOR: telling one occurrence from the next. "The 10:00 run" has to
 * be a thing the scheduler can name and record as handled, because a run that
 * takes twenty minutes finishes at 10:20 — still after 10:00, still matching
 * "the most recent occurrence has passed" — and without an identity for the slot
 * itself the same 10:00 window fires again the moment the first one lands.
 *
 * Returns the occurrence's own timestamp, which is stable: every check between
 * 10:00 and the next slot gets the same number back, so "have I already run
 * this one" is a comparison rather than a guess.
 *
 * Null for an interval schedule, which has no slots — its spacing is measured
 * from the last completion instead.
 */
export const mostRecentOccurrence = (
  cron: CronSchedule | null | undefined,
  now: number = Date.now()
): number | null => {
  if (!cron || !isValidCron(cron) || cron.kind !== 'times') return null

  const passed = cron.times
    .map(time => nextDailyRun(time, now))
    .filter((at): at is number => at !== null)
    // The next occurrence minus a day IS the most recent one, the same
    // arithmetic `isCronDue` uses — kept identical on purpose, because two
    // different ways of naming the same moment is how they drift apart.
    .map(next => next - 24 * 60 * MINUTE_MS)
    .filter(at => at <= now)

  return passed.length > 0 ? Math.max(...passed) : null
}

/** What the card says a schedule is, in one line. */
export const describeCron = (cron: CronSchedule | null | undefined): string => {
  if (!cron || !isValidCron(cron)) return 'Not set'

  if (cron.kind === 'interval') {
    const every = cron.everyMinutes

    if (every % 60 === 0) {
      const hours = every / 60

      return hours === 1 ? 'Every hour' : `Every ${hours} hours`
    }

    if (every < 60) return `Every ${every} min`

    return `Every ${Math.floor(every / 60)}h ${every % 60}m`
  }

  const times = [...cron.times].sort()

  return times.length === 1 ? `At ${times[0]}` : `At ${times.join(', ')}`
}

/**
 * The old single-time shape, read forward.
 *
 * Every task stored before this existed carries `time: "HH:mm"`. Returned as a
 * one-entry fixed-time schedule, which is exactly what it meant — so nobody's
 * 02:00 becomes "not set" on upgrade.
 */
export const cronFromLegacyTime = (time: string | null | undefined): CronSchedule | null =>
  isValidSyncTime(time) ? { kind: 'times', times: [time.trim()] } : null
