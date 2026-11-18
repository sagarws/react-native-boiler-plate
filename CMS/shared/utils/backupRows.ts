/**
 * The arithmetic behind the AJIO backup: what identifies a row, what date it
 * belongs to, and which months a range covers.
 *
 * Here rather than in the service because all three are decisions the backup
 * lives or dies by, and none of them needs a disk, a network or Electron to be
 * checked. A wrong key duplicates every row on the next re-sync; a wrong date
 * files a row in a month nobody will look in; a wrong month walk silently skips
 * a month of data. Kept pure so each is testable on its own.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** A local date as `yyyy-MM-dd` — local, because AJIO's dates are IST days. */
export const ymd = (date: Date): string =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`

/**
 * `${awb}|${ean}`, both trimmed and upper-cased.
 *
 * BOTH, because one AWB can carry several articles — keying on the AWB alone
 * would drop every line of a multi-article shipment but the first. Upper-cased
 * so a casing difference between two pages cannot split one row into two.
 */
export const recordKey = (awb: unknown, ean: unknown): string => {
  const clean = (value: unknown): string =>
    typeof value === 'string' || typeof value === 'number' ? String(value).trim().toUpperCase() : ''

  return `${clean(awb)}|${clean(ean)}`
}

/**
 * Splits a date window down the middle, or returns null when it cannot.
 *
 * WHY A BACKUP NEEDS THIS. AJIO serves at most a 10,000-row window — 100 pages
 * at its 100-row cap — and answers `totalPages: 100` whether the month holds
 * ten thousand rows or fifty. A month past that reads to the end of page 100,
 * reports itself complete, and is short: the Forward Report for January 2026
 * held only the 23rd onwards, because AJIO serves newest first and the first
 * twenty-two days fell off the end.
 *
 * The window is the only lever. Ask for half a month and the half fits.
 *
 * Null when `from` and `to` are the same day — a single day over the cap cannot
 * be narrowed any further, and the caller has to say so rather than recurse.
 *
 * Dates are `yyyy-MM-dd` and compared as strings throughout this file; UTC is
 * used deliberately so a machine east or west of the line splits identically.
 */
/**
 * How many days a window covers, inclusive of both ends. 0 if unreadable.
 *
 * The unit the backup measures itself in. Pages cannot do that job once a month
 * is read in several windows — the page number restarts with each one, so a bar
 * driven by it jumps backwards and tells an operator nothing. Days only ever go
 * up, and "24 of 31 days" is the question being asked anyway.
 */
export const windowDays = (window: { from: string; to: string }): number => {
  const from = Date.parse(`${window.from}T00:00:00Z`)
  const to = Date.parse(`${window.to}T00:00:00Z`)

  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return 0

  return Math.round((to - from) / 86_400_000) + 1
}

export const halveWindow = (
  window: { from: string; to: string }
): [{ from: string; to: string }, { from: string; to: string }] | null => {
  const from = Date.parse(`${window.from}T00:00:00Z`)
  const to = Date.parse(`${window.to}T00:00:00Z`)

  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return null

  const DAY = 86_400_000
  const days = Math.round((to - from) / DAY)
  // Round DOWN, so the first half is never the whole window — a two-day window
  // splits 1 + 1 rather than 2 + 0, which would recurse for ever.
  const half = Math.floor(days / 2)
  const mid = from + half * DAY
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

  return [
    { from: window.from, to: iso(mid) },
    { from: iso(mid + DAY), to: window.to }
  ]
}

/** First and last day of one month, as `yyyy-MM-dd`. */
export const monthWindow = (year: number, month: number): { from: string; to: string } => ({
  from: `${year}-${pad(month)}-01`,
  to: `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`
})

/**
 * The row's own date.
 *
 * Forward rows carry `orderDate`, return rows `returnCreateDate`, and both have
 * been seen as `dd-MM-yyyy` as well as ISO. Normalised so the calendar and the
 * range delete can compare dates as plain strings, and left EMPTY rather than
 * guessed when AJIO sends something else: the caller falls back to the month
 * being fetched, which is at least a month somebody would think to look in.
 */
export const rowDate = (row: Record<string, unknown>): string => {
  const raw = text(row.orderDate) || text(row.returnCreateDate) || text(row.shipmentDate)

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})/.exec(raw)

  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : ''
}

/** Months from one year/month to another, inclusive. Empty if the range runs backwards. */
export const monthsBetween = (
  fromYear: number,
  fromMonth: number,
  toYear: number,
  toMonth: number
): { year: number; month: number }[] => {
  const months: { year: number; month: number }[] = []
  let year = fromYear
  let month = fromMonth

  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push({ year, month })

    if (month === 12) {
      month = 1
      year += 1
    } else {
      month += 1
    }
  }

  return months
}

/**
 * What a backed-up row can tell a claim.
 *
 * AJIO's return report is the one that matters here: a claim is raised against
 * a RETURN AWB, and that row carries the forward leg, the seller's own code for
 * the article and the place of business it shipped from — the three blanks a
 * scanned claim arrives without. The forward report is a fallback with no
 * forward AWB of its own to give (it IS the forward leg).
 *
 * Kept to four small strings rather than the whole row: the lookup holds every
 * AWB the machine has backed up, and holding forty fields each to read three of
 * them is how a desktop app starts costing hundreds of megabytes.
 */
export interface BackupFacts {
  /** The outbound shipment this return came from. */
  forwardAwb: string
  sellerSku: string
  pobId: string
}

export const claimFacts = (row: Record<string, unknown>): BackupFacts => ({
  forwardAwb: text(row.fwdAwbNo),
  // The two reports spell it differently — `sellerSku` on returns, `sellerSKU`
  // on forwards — and a row is only ever one of them.
  sellerSku: text(row.sellerSku) || text(row.sellerSKU),
  pobId: text(row.pobId)
})

/**
 * How an exported backup is laid out inside the zip.
 *
 *   2026/09/1.xlsx          one page, as AJIO served it
 *   2026/09/2.xlsx
 *   manifest.json           which report, when, how many rows
 *
 * YEAR, THEN MONTH, THEN PAGE, because that is how the data was fetched and how
 * it is stored — a zip that mirrors the partitions can be checked by eye
 * against the Coverage calendar, and a missing page is a missing FILE rather
 * than rows that quietly are not there.
 *
 * The page number is the one on the record, so an export and a re-import put
 * every row back exactly where it was.
 */
export const pagePath = (year: number, month: number, page: number): string =>
  `${year}/${pad(month)}/${page + 1}.xlsx`

/** The other direction, for import. Null for anything not shaped like a page. */
export const parsePagePath = (path: string): { year: number; month: number; page: number } | null => {
  const match = /(?:^|\/)(\d{4})\/(\d{1,2})\/(\d+)\.xlsx$/i.exec(path.replace(/\\/g, '/'))

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const page = Number(match[3])

  if (month < 1 || month > 12 || page < 1) return null

  // Back to zero-based, the way AJIO pages and the way it is stored.
  return { year, month, page: page - 1 }
}

/** The three columns that make an exported row readable on its own. */
export const EXPORT_COLUMNS = { year: 'Year', month: 'Month', page: 'Page' } as const

/**
 * One stored record as a spreadsheet row.
 *
 * Every field AJIO returned, untouched, plus where it came from. The originals
 * come last so the identifying columns are the first thing on screen when the
 * file is opened by hand — which is most of why anyone would export it.
 */
export const recordToSheetRow = (record: {
  year: number
  month: number
  page: number
  row: Record<string, unknown>
}): Record<string, unknown> => ({
  [EXPORT_COLUMNS.year]: record.year,
  [EXPORT_COLUMNS.month]: record.month,
  [EXPORT_COLUMNS.page]: record.page + 1,
  ...record.row
})

/**
 * And back again.
 *
 * The three added columns are STRIPPED rather than kept: they describe where
 * the row sat, and putting them back into `row` would make a re-exported file
 * carry them twice. The year, month and page are taken from the file's own path
 * instead, which is the copy that cannot disagree with where the file is.
 */
export const sheetRowToRecord = (
  raw: Record<string, unknown>,
  at: { year: number; month: number; page: number }
): {
  key: string
  awb: string
  ean: string
  date: string
  year: number
  month: number
  page: number
  savedAt: string
  row: Record<string, unknown>
} => {
  const row = { ...raw }

  for (const column of Object.values(EXPORT_COLUMNS)) delete row[column]

  const awb = text(row.awbNumber) || text(row.returnAwbNo)
  const ean = text(row.ean)

  return {
    key: recordKey(awb, ean),
    awb,
    ean,
    date: rowDate(row) || `${at.year}-${pad(at.month)}-01`,
    year: at.year,
    month: at.month,
    page: at.page,
    savedAt: new Date().toISOString(),
    row
  }
}
