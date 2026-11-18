import type { FlipkartRecord, FlipkartReport } from '@shared/types/flipkartBackup'

/**
 * The arithmetic behind the Flipkart backup: what a row is, which date it
 * belongs to, how a range is cut into requests, and how a return AWB finds its
 * forward AWB. Pure, so each decision can be checked without a disk or a portal.
 */

const pad = (value: number): string => String(value).padStart(2, '0')

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

/** Flipkart writes "NA", "-" or nothing where it means nothing. */
export const flipkartValue = (value: unknown): string => {
  const raw = text(value)

  return /^(NA|N\/A|-|null)$/i.test(raw) ? '' : raw
}

/**
 * An identifier from a Flipkart report, without the tag Flipkart wraps it in.
 *
 * The Report Centre's export prefixes every id so Excel keeps it as text
 * instead of turning a 20-digit number into `4.38E+20`: `OI:438512650864022100`
 * for an order item, `DTr:FMPC6455977337` for a forward AWB, `R:1225…` for a
 * return. Stored as served, a typed AWB would never match its own row, so the
 * quotes and the short letter tag are taken off. Only for columns that never
 * carry a colon of their own — ids and tracking numbers — never for free text.
 */
export const flipkartId = (value: unknown): string => {
  const bare = flipkartValue(value)
    .replace(/^"+|"+$/g, '')
    .replace(/^[A-Za-z]{1,4}:/, '')
    .trim()

  return flipkartValue(bare)
}

/**
 * A SKU from a Flipkart report: served as `"""SKU:8905834070408"""`. Only the
 * quotes and the literal `SKU:` tag come off — a seller's own SKU may contain a
 * colon, so no other prefix is touched.
 */
export const flipkartSku = (value: unknown): string =>
  flipkartValue(
    flipkartValue(value)
      .replace(/^"+|"+$/g, '')
      .replace(/^SKU:/i, '')
      .trim()
  )

/**
 * A Flipkart report date, as `yyyy-MM-dd`.
 *
 * The workbook is parsed with date cells formatted `yyyy-mm-dd`, so that is
 * the usual shape; `dd-MM-yyyy` and `dd/MM/yyyy` are read as well in case a
 * column arrives as text. Empty rather than guessed for anything else.
 */
export const flipkartDate = (value: unknown): string => {
  const raw = flipkartValue(value)

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10)

  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(raw)

  if (!dmy) return ''

  const [, day, month, year] = dmy

  return `${year}-${pad(Number(month))}-${pad(Number(day))}`
}

/**
 * What a re-download deduplicates on, upper-cased.
 *
 * A forward row is one order item. A return row is one return of an order
 * item — keyed on Flipkart's `return_id`, NOT on the AWB, because a return is
 * often listed before its pickup has a tracking id and must be filled in when
 * it gets one rather than stored a second time.
 */
export const flipkartKey = (report: FlipkartReport, orderItemId: unknown, returnRef: unknown = ''): string =>
  report === 'forward'
    ? flipkartValue(orderItemId).toUpperCase()
    : `${flipkartValue(orderItemId).toUpperCase()}|${flipkartValue(returnRef).toUpperCase()}`

/**
 * The most days one request asks for.
 *
 * Flipkart has served a five-month window in one file, so this is a cap for
 * file size and build time rather than a portal limit.
 */
export const FLIPKART_WINDOW_DAYS = 60

const DAY_MS = 86_400_000

const parseDay = (date: string): number => Date.parse(`${date}T00:00:00Z`)

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

/** A range cut into back-to-back windows of at most FLIPKART_WINDOW_DAYS. */
export const flipkartWindows = (from: string, to: string): { from: string; to: string }[] => {
  const start = parseDay(from)
  const end = parseDay(to)

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return []

  const windows: { from: string; to: string }[] = []

  for (let cursor = start; cursor <= end; cursor += FLIPKART_WINDOW_DAYS * DAY_MS) {
    windows.push({ from: isoDay(cursor), to: isoDay(Math.min(cursor + (FLIPKART_WINDOW_DAYS - 1) * DAY_MS, end)) })
  }

  return windows
}

/** The report's columns, by our report key. */
const COLUMNS: Record<FlipkartReport, { awb: string; date: string }> = {
  // Orders report.
  forward: { awb: 'delivery_tracking_id', date: 'order_date' },
  // Returns report.
  return: { awb: 'reverse_logistics_tracking_id', date: 'return_requested_date' }
}

/**
 * One parsed sheet row, or null when it carries no order item id — a blank or
 * totals line, which would put a keyless entry in the lookup.
 *
 * `fallbackDate` is the request's own window start, for a row whose date
 * column will not parse: it still belongs to that window.
 */
export const toFlipkartRecord = (
  report: FlipkartReport,
  row: Record<string, unknown>,
  context: { username: string; requestId: string | null; fallbackDate: string }
): FlipkartRecord | null => {
  const orderItemId = flipkartId(row.order_item_id)

  if (!orderItemId) return null

  const columns = COLUMNS[report]
  const awb = flipkartId(row[columns.awb])

  return {
    key: flipkartKey(report, orderItemId, flipkartId(row.return_id) || awb),
    username: context.username,
    orderItemId,
    sku: flipkartSku(row.sku),
    awb,
    date: flipkartDate(row[columns.date]) || context.fallbackDate,
    savedAt: new Date().toISOString(),
    requestId: context.requestId
  }
}

/** Two rows for the same key: fill blanks, never overwrite with one. Earliest date wins. */
export const mergeFlipkartRecord = (held: FlipkartRecord, incoming: FlipkartRecord): FlipkartRecord => ({
  ...held,
  sku: held.sku || incoming.sku,
  awb: held.awb || incoming.awb,
  date: held.date && incoming.date ? (held.date < incoming.date ? held.date : incoming.date) : held.date || incoming.date,
  requestId: held.requestId ?? incoming.requestId
})

export const flipkartRecordDiffers = (held: FlipkartRecord, merged: FlipkartRecord): boolean =>
  held.sku !== merged.sku || held.awb !== merged.awb || held.date !== merged.date
