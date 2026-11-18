import type { SnapdealRecord, SnapdealRequestStatus } from '@shared/types/snapdealBackup'

/**
 * The arithmetic behind the Snapdeal backup: what identifies a return, what
 * date it belongs to, how a month is cut into windows Snapdeal will serve, and
 * how a downloaded file is matched to the request that asked for it.
 *
 * Pure, and here rather than in the service, for the same reason as
 * `backupRows`: every one of these is a decision the backup lives or dies by,
 * and none of them needs a disk, a network or Electron to be checked. A wrong
 * key doubles every row on the next download; a wrong window split asks
 * Snapdeal for something it answers with silence; a wrong filename parse files
 * October's rows against September's request.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

/**
 * Snapdeal writes "NA" where it means nothing.
 *
 * Treated as empty everywhere, because a forward AWB of "NA" that is stored as
 * the string "NA" is a lookup that answers a claim with a courier number no
 * courier has.
 */
export const snapdealValue = (value: unknown): string => {
  const raw = text(value)

  return raw.toUpperCase() === 'NA' ? '' : raw
}

/**
 * `${subOrderCode}|${reverseAwb}`, trimmed and upper-cased.
 *
 * BOTH, and in this order, because Snapdeal serves the same sub-order twice —
 * once as the return was raised and again once the forward leg was delivered.
 * The sub-order alone would make those two one row and lose whichever arrived
 * second; the reverse AWB alone would merge two returns of one shipment.
 *
 * Upper-cased because the reverse AWB is sometimes a courier's own string
 * (`SDLR5006999324`) and casing has been seen to differ between downloads.
 */
export const snapdealKey = (subOrderCode: unknown, reverseAwb: unknown): string =>
  `${snapdealValue(subOrderCode).toUpperCase()}|${snapdealValue(reverseAwb).toUpperCase()}`

/**
 * Snapdeal's timestamps, as `yyyy-MM-dd`.
 *
 * The report writes `HH:mm:ss dd-MM-yyyy` — time FIRST, which is the trap: a
 * naive `dd-MM-yyyy` match against "13:37:33 04-09-2026" finds "33 04-09" and
 * files the row in the year 9. Anchored on the date half explicitly.
 *
 * Empty rather than guessed when the shape is anything else: a row filed in a
 * month nobody would look in is worse than a row with no date.
 */
export const snapdealDate = (value: unknown): string => {
  const raw = snapdealValue(value)

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  const dmy = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(raw)

  if (!dmy) return ''

  const [, day, month, year] = dmy

  return `${year}-${pad(Number(month))}-${pad(Number(day))}`
}

/**
 * The most days Snapdeal will put in one report.
 *
 * Mirrors `lookbackDaysCap` in the core's `IMPORT_TYPE_API_CONFIG`, and
 * confirmed by a real file: `..._05092026_03102026` is 29 days inclusive, the
 * widest window observed. A month is therefore never one request.
 */
export const SNAPDEAL_WINDOW_DAYS = 28

const DAY_MS = 86_400_000

const parseDay = (date: string): number => Date.parse(`${date}T00:00:00Z`)

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** Days in a window, inclusive. 0 when it runs backwards or will not parse. */
export const snapdealWindowDays = (window: { from: string; to: string }): number => {
  const from = parseDay(window.from)
  const to = parseDay(window.to)

  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0

  return Math.round((to - from) / DAY_MS) + 1
}

/**
 * A range cut into windows Snapdeal will actually answer.
 *
 * FORWARD, FROM THE START, IN EQUAL-SIZED PIECES — not "28 days back from
 * today" the way the import does it. The import only ever wants the recent
 * past; this is a backup, so the window it is given is the window it must
 * cover, and the pieces have to tile it exactly with no gap and no overlap.
 *
 * A tail shorter than the cap is left short rather than stretched backwards
 * into the previous piece: overlapping windows would re-download rows that are
 * then skipped, which costs a report build on Snapdeal's side for nothing.
 */
export const snapdealWindows = (
  from: string,
  to: string
): { from: string; to: string }[] => {
  const start = parseDay(from)
  const end = parseDay(to)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []

  const windows: { from: string; to: string }[] = []

  for (let cursor = start; cursor <= end; cursor += SNAPDEAL_WINDOW_DAYS * DAY_MS) {
    const last = Math.min(cursor + (SNAPDEAL_WINDOW_DAYS - 1) * DAY_MS, end)

    windows.push({ from: isoDay(cursor), to: isoDay(last) })
  }

  return windows
}

/** First and last day of one month, as `yyyy-MM-dd`. */
export const snapdealMonthWindow = (
  year: number,
  month: number
): { from: string; to: string } => ({
  from: `${year}-${pad(month)}-01`,
  to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
})

/** Every day in a window, inclusive — what paints the request calendar. */
export const snapdealDaysIn = (window: { from: string; to: string }): string[] => {
  const start = parseDay(window.from)
  const end = parseDay(window.to)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []

  const days: string[] = []

  for (let cursor = start; cursor <= end; cursor += DAY_MS) days.push(isoDay(cursor))

  return days
}

/**
 * The format `generateReport` takes: `DD-MM-YYYY`, zero-padded.
 *
 * Exactly what Snapdeal's own portal sends — "01-10-2026", captured 14 Oct
 * 2026. An older capture recorded "21-8-2026" unpadded; the portal's own form
 * is the one used, so this app asks exactly as the portal does.
 */
export const snapdealApiDate = (date: string): string => {
  const [year = '', month = '', day = ''] = date.split('-')

  return `${day.padStart(2, '0')}-${month.padStart(2, '0')}-${year}`
}

/**
 * The window a downloaded file holds, read out of its own name.
 *
 * THIS IS WHAT MAKES A DOWNLOAD MATCHABLE. Snapdeal's reports list carries no
 * requestId and every row of it is called "Dropship Return Acknowledged", so
 * with several windows in flight there is nothing on the row that says which
 * one it is. The FILE says: `S7aea7_DROPSHIP_RTN_CREATED_05092026_03102026.csv`
 * is the 5th of September to the 3rd of October.
 *
 * Null when the name does not carry a pair of dates — a renamed or
 * unrecognised file is matched by recency instead, and saying "I do not know"
 * is what lets the caller make that choice rather than acting on a wrong guess.
 */
export const snapdealFileWindow = (
  filename: unknown
): { from: string; to: string } | null => {
  const name = text(filename)
  const match = /(\d{2})(\d{2})(\d{4})[_-](\d{2})(\d{2})(\d{4})/.exec(name)

  if (!match) return null

  const [, fromDay, fromMonth, fromYear, toDay, toMonth, toYear] = match
  const from = `${fromYear}-${fromMonth}-${fromDay}`
  const to = `${toYear}-${toMonth}-${toDay}`

  // A pair of numbers that are not dates parses as happily as a pair that are.
  if (!Number.isFinite(parseDay(from)) || !Number.isFinite(parseDay(to))) return null

  return { from, to }
}

/**
 * One parsed CSV row, or null when it carries nothing worth keeping.
 *
 * A row with no sub-order code is not a return — it is a trailing blank line or
 * a totals row, and storing it would put a keyless entry in the lookup.
 */
export const toSnapdealRecord = (
  row: Record<string, unknown>,
  requestId: string | null
): SnapdealRecord | null => {
  const subOrderCode = snapdealValue(row.SUBORDERCODE)

  if (!subOrderCode) return null

  const reverseAwb = snapdealValue(row.REVERSEAWBNO)
  const date = snapdealDate(row.RETURNINITIATEDON) || snapdealDate(row.ORDERCREATEDDATE)
  const [year, month] = date.split('-')

  return {
    key: snapdealKey(subOrderCode, reverseAwb),
    subOrderCode,
    awb: snapdealValue(row.AWBNO),
    reverseAwb,
    sku: snapdealValue(row.SKUCODE),
    date,
    year: Number(year) || 0,
    month: Number(month) || 0,
    savedAt: new Date().toISOString(),
    requestId
  }
}

/**
 * Two rows for the same return, resolved into one.
 *
 * THE FORWARD AWB IS THE WHOLE POINT OF THE SECOND ROW. Snapdeal serves the
 * return twice: the first row has `AWBNO: "NA"` because the forward leg had not
 * been settled when the return was raised, the second carries it. Keeping
 * whichever arrived first would throw away the one field a claim needs most —
 * in a real report that was 85 of 331 returns.
 *
 * So a field is filled, never overwritten by a blank, and the earlier `savedAt`
 * is kept: the record's age is when this machine first held the return, not
 * when a later download touched it.
 */
export const mergeSnapdealRecord = (
  held: SnapdealRecord,
  incoming: SnapdealRecord
): SnapdealRecord => ({
  ...held,
  awb: held.awb || incoming.awb,
  sku: held.sku || incoming.sku,
  // The earliest date seen wins: the return was raised once, and a row that
  // reports it a day later must not move the day the calendar paints.
  date: held.date && incoming.date ? (held.date < incoming.date ? held.date : incoming.date) : held.date || incoming.date,
  requestId: held.requestId ?? incoming.requestId
})

/** Did merging actually change anything? Only then is a rewrite worth it. */
export const snapdealRecordDiffers = (held: SnapdealRecord, merged: SnapdealRecord): boolean =>
  held.awb !== merged.awb || held.sku !== merged.sku || held.date !== merged.date

/**
 * Which status a day should be painted, given every request covering it.
 *
 * FURTHEST WINS. A day covered by a stored request and a failed retry is
 * stored: the rows are on the machine, and painting it red would send somebody
 * re-requesting what they already hold. "Failed" only survives when nothing
 * better ever covered that day, which is precisely when it is worth acting on.
 */
const RANK: Record<SnapdealRequestStatus, number> = {
  failed: 0,
  requested: 1,
  ready: 2,
  stored: 3
}

export const bestRequestStatus = (
  statuses: SnapdealRequestStatus[]
): SnapdealRequestStatus | null =>
  statuses.reduce<SnapdealRequestStatus | null>(
    (best, status) => (best === null || RANK[status] > RANK[best] ? status : best),
    null
  )
