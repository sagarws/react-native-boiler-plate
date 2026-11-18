/**
 * How much master-data backup this machine keeps — AJIO and Snapdeal alike.
 *
 * FIVE MONTHS, THE CURRENT ONE INCLUDED. On the first day of a new month the
 * oldest month falls out of the window and is deleted, so the backup never
 * grows past what a claim can still use. One rule, read by both stores' prune,
 * both daily runs, and both Settings cards — a card that offered a month the
 * store was about to delete would be a backup that silently undoes itself.
 */
export const BACKUP_RETENTION_MONTHS = 5

export interface RetainedMonth {
  year: number
  /** 1–12. */
  month: number
}

const pad = (value: number): string => String(value).padStart(2, '0')

/** The months kept, oldest first, ending with the current one. */
export const retainedMonths = (now: Date = new Date()): RetainedMonth[] =>
  Array.from({ length: BACKUP_RETENTION_MONTHS }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (BACKUP_RETENTION_MONTHS - 1 - index), 1)

    return { year: date.getFullYear(), month: date.getMonth() + 1 }
  })

/** The first day kept, `yyyy-MM-dd`. Anything dated before it is pruned. */
export const retentionStart = (now: Date = new Date()): string => {
  const first = retainedMonths(now)[0] as RetainedMonth

  return `${first.year}-${pad(first.month)}-01`
}

/** Is this month inside the window? */
export const isRetainedMonth = (year: number, month: number, now: Date = new Date()): boolean =>
  retainedMonths(now).some(entry => entry.year === year && entry.month === month)

/** The years the window touches — one, or two across a January. */
export const retainedYears = (now: Date = new Date()): number[] =>
  [...new Set(retainedMonths(now).map(entry => entry.year))].sort((a, b) => b - a)

/** A `yyyy-MM-dd` start date, moved forward to the window if it is older. */
export const clampToRetention = (from: string, now: Date = new Date()): string => {
  const start = retentionStart(now)

  return from < start ? start : from
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The refusal for a month outside the window, naming the oldest one allowed. */
export const retentionRefusal = (now: Date = new Date()): string => {
  const first = retainedMonths(now)[0] as RetainedMonth

  return (
    `Only the last ${BACKUP_RETENTION_MONTHS} months are kept — choose ` +
    `${MONTH_NAMES[first.month - 1]} ${first.year} or later`
  )
}

/** The kept months (1–12) that fall in one year, oldest first — for a card's chips. */
export const retainedMonthsIn = (year: number, now: Date = new Date()): number[] =>
  retainedMonths(now)
    .filter(entry => entry.year === year)
    .map(entry => entry.month)
