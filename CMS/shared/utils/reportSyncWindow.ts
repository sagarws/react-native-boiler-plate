/**
 * Where a scheduled report sync (AJIO or Snapdeal) starts reading, for one account and one
 * report.
 *
 * FROM THE LAST DATE ALREADY HELD, so nothing between that run and this one is
 * missed — a sync skipped for a few days picks those days up, rather than
 * reading only the last two and leaving a hole.
 *
 * NEVER LESS THAN THE LAST TWO DAYS. AJIO back-dates: a return created on the
 * 30th can appear on the 1st, and a row read the day it happened can change the
 * day after. Re-reading is cheap — the AWB + EAN skip makes a second pass over a
 * held day cost one request per page.
 *
 * BUT NOT TOO FAR BEHIND. A machine left off for months would otherwise start
 * a months-long read in the middle of the run, holding the browser while the
 * claims wait. Past `staleDays` the scheduled run reads only the last
 * `fallbackDays`, and anything older is the backup card's job — whole months,
 * read deliberately. AJIO allows 30 days of catch-up; Snapdeal a week.
 */

/** A last sync older than this is not caught up by the scheduled run (the default). */
export const REPORT_SYNC_STALE_DAYS = 7

/** The window the scheduled run reads when there is no recent sync to continue from. */
export const REPORT_SYNC_FALLBACK_DAYS = 2

const DAY_MS = 24 * 60 * 60 * 1000

const dayNumber = (ymd: string): number => {
  const [year, month, day] = ymd.split('-').map(Number)

  return Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / DAY_MS
}

const fromDayNumber = (value: number): string => new Date(value * DAY_MS).toISOString().slice(0, 10)

const isYmd = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * @param lastCoveredTo the last date a sync of this account and report covered,
 *        `yyyy-MM-dd`, or null when it has never synced
 * @param today         `yyyy-MM-dd`, in the machine's own calendar
 * @param rereadDays    the days always re-read, and the window when there is no
 *        recent sync to continue from. Two for AJIO; Snapdeal passes more.
 * @param limits.staleDays    a last sync further behind than this is not caught
 *        up. Default a week.
 * @param limits.fallbackDays the window read when there is nothing recent to
 *        continue from. Default `rereadDays`.
 * @returns the `from` date, `yyyy-MM-dd` — the window always ends today
 */
export const reportSyncFrom = (
  lastCoveredTo: string | null | undefined,
  today: string,
  rereadDays: number = REPORT_SYNC_FALLBACK_DAYS,
  limits: { staleDays?: number; fallbackDays?: number } = {}
): string => {
  const staleDays = limits.staleDays ?? REPORT_SYNC_STALE_DAYS
  const fallback = fromDayNumber(dayNumber(today) - (limits.fallbackDays ?? rereadDays))
  const reread = fromDayNumber(dayNumber(today) - rereadDays)

  if (!isYmd(lastCoveredTo)) return fallback

  const behind = dayNumber(today) - dayNumber(lastCoveredTo)

  if (behind > staleDays) return fallback

  // The earlier of the two: the last date held, and never fewer than `rereadDays`.
  return lastCoveredTo < reread ? lastCoveredTo : reread
}
