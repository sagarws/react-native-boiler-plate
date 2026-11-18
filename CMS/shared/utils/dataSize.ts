/**
 * How much disk a set of rows would take as JSON.
 *
 * The question behind it is capacity, not curiosity: this app keeps its records
 * in JSON files on the operator's machine, and "can we hold a year of AJIO's
 * return report locally" is answerable only by measuring a real page and
 * multiplying. So the measurement is of the ACTUAL serialised bytes — not an
 * estimate from row count — and the extrapolation is stated as an estimate.
 *
 * UTF-8 bytes, because that is what lands on disk. `JSON.stringify(...).length`
 * counts UTF-16 code units instead and under-reports every non-ASCII character
 * — product names and reasons are full of them.
 */

export interface DataSizeTally {
  /** Bytes measured so far. */
  bytes: number
  /** Rows behind those bytes. */
  rows: number
  /** Pages already counted, so clicking twice on one page cannot double it. */
  pages: string[]
}

export const EMPTY_TALLY: DataSizeTally = { bytes: 0, rows: 0, pages: [] }

/** The UTF-8 size of these rows, serialised as JSON. */
export const jsonBytes = (rows: unknown[]): number =>
  new TextEncoder().encode(JSON.stringify(rows)).length

/** "1.4 MB", "812 KB", "0 B" — two significant places, no false precision. */
export const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`

  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }

  return `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ${units[unit]}`
}

/**
 * Adds one page to the tally, unless it is already in it.
 *
 * `key` identifies the page WITHIN a query — the same page number under a
 * different month or account is a different page of data, and the same page
 * clicked twice is not.
 */
export const addPage = (tally: DataSizeTally, key: string, rows: unknown[]): DataSizeTally => {
  if (tally.pages.includes(key)) return tally

  return {
    bytes: tally.bytes + jsonBytes(rows),
    rows: tally.rows + rows.length,
    pages: [...tally.pages, key]
  }
}

/**
 * What the whole report would take, from what has been measured.
 *
 * Deliberately a projection from the average row, and deliberately null until
 * something has been measured: a number invented from no sample is worse than
 * no number. Accurate to the extent that the pages measured are typical, which
 * is why the dialog says how many rows it is based on.
 */
export const projectTotal = (tally: DataSizeTally, totalRows: number): number | null => {
  if (tally.rows === 0 || totalRows <= 0) return null

  return Math.round((tally.bytes / tally.rows) * totalRows)
}
