/**
 * When the next master import is due.
 *
 * The schedule is a bare "HH:mm" in IST, because that is the timezone every
 * scheduled job in this system already reasons in. The machine running the
 * desktop app may be in any timezone, so the comparison is done in IST
 * explicitly rather than by trusting the local clock's offset.
 *
 * Pure so it can be reasoned about and tested without a clock or a database.
 */

/** IST is UTC+05:30 with no daylight saving, so a fixed offset is exact. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const DAY_MS = 24 * 60 * 60 * 1000

export const SYNC_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export const isValidSyncTime = (value: unknown): value is string =>
  typeof value === 'string' && SYNC_TIME_PATTERN.test(value.trim())

/**
 * The next moment the given IST time-of-day occurs, at or after `from`.
 *
 * Returns null for an unusable schedule rather than guessing — a company with
 * no schedule must not silently acquire one.
 */
export const nextRunAt = (syncTime: string | null, from: number = Date.now()): number | null => {
  if (!isValidSyncTime(syncTime)) return null

  const [hours, minutes] = syncTime.trim().split(':').map(Number)

  if (hours === undefined || minutes === undefined) return null

  // Work in "IST milliseconds": shift the instant so that UTC arithmetic lands
  // on IST wall-clock values, then shift the answer back.
  const ist = from + IST_OFFSET_MS
  const istMidnight = Math.floor(ist / DAY_MS) * DAY_MS
  const targetToday = istMidnight + hours * 60 * 60 * 1000 + minutes * 60 * 1000

  const target = targetToday > ist ? targetToday : targetToday + DAY_MS

  return target - IST_OFFSET_MS
}

/**
 * Whether a run is owed, given a baseline of when the clock last moved on.
 *
 * `since` is the later of the last completed run and the moment this machine
 * first saw the schedule. A run is owed when the most recent occurrence of the
 * scheduled time falls after that baseline.
 *
 * Comparing against the *scheduled* moment rather than "24 hours since the last
 * run" means an app closed at 02:00 and opened at 09:00 still runs that day's
 * import, instead of drifting later every day.
 *
 * The baseline is required, not optional. With no run recorded there is no way
 * to tell "installed an hour ago" from "has been failing to run for a week":
 * treating that as owed fires a heavy import the moment someone installs the
 * app, and treating it as not-owed means the schedule never fires at all. The
 * caller records a baseline when it first learns the schedule, which makes the
 * first run land on the first scheduled moment after install.
 */
export const isRunDue = (
  syncTime: string | null,
  since: number,
  now: number = Date.now()
): boolean => {
  if (!isValidSyncTime(syncTime)) return false

  // The most recent occurrence of the scheduled time: the next one, minus a day.
  const next = nextRunAt(syncTime, now)

  if (next === null) return false

  const mostRecent = next - DAY_MS

  if (mostRecent > now) return false

  return since < mostRecent
}
