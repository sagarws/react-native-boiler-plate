import type { CmsRow } from '@shared/types/cmsList'
import { BLANK } from './rowFilter'

/**
 * The Claims table's header filters — a search box and a value list under
 * every column heading.
 *
 * ON THE LOADED PAGE, like the Filter dialog (see rowFilter): it narrows what
 * is on screen, it does not query the server and it does not move the tab
 * counts. The toolbar's search box is the one that searches the backend.
 *
 * Search is case-insensitive "contains"; a value list is "one of these". A
 * column may have both, and they AND — as do the columns with each other.
 *
 * Pure, and in `shared`, so the rules are testable without a window.
 */

/** One column's narrowing. `values` undefined means every value is in play. */
export interface ColumnFilter {
  search?: string
  values?: string[]
}

/** Keyed by the column's `CmsRow` field. */
export type ColumnFilters = Partial<Record<keyof CmsRow, ColumnFilter>>

const pad = (n: number): string => String(n).padStart(2, '0')

/** Day-first, as the grid shows dates on an Indian locale — "07/10/2026". */
const dayOf = (iso: string): string => {
  const at = Date.parse(iso)

  if (Number.isNaN(at)) return ''

  const date = new Date(at)

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`
}

const DATE_FIELDS = new Set<keyof CmsRow>(['createdAt', 'forwardOrderDate'])

/**
 * What one cell holds, as text — the value the list offers and the search
 * reads. Dates are reduced to their day, so the list groups a day's claims
 * under one entry instead of one entry per minute.
 */
export const cellText = (row: CmsRow, field: keyof CmsRow): string => {
  const raw = row[field]

  if (raw === null || raw === undefined) return BLANK
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)

  const text = raw.trim()

  if (!text) return BLANK
  if (DATE_FIELDS.has(field)) return dayOf(text) || text

  return text
}

/** Does this column narrow anything? */
export const isColumnFiltered = (filter: ColumnFilter | undefined): boolean =>
  !!filter && (!!filter.search?.trim() || filter.values !== undefined)

const passes = (row: CmsRow, field: keyof CmsRow, filter: ColumnFilter): boolean => {
  const text = cellText(row, field)
  const needle = filter.search?.trim().toLowerCase()

  if (needle && (text === BLANK || !text.toLowerCase().includes(needle))) return false
  if (filter.values !== undefined && !filter.values.includes(text)) return false

  return true
}

/** Rows that pass every column's filter. `except` leaves one column out — for its own value list. */
export const applyColumnFilters = (
  rows: CmsRow[],
  filters: ColumnFilters,
  except?: keyof CmsRow
): CmsRow[] => {
  const active = (Object.keys(filters) as (keyof CmsRow)[]).filter(
    field => field !== except && isColumnFiltered(filters[field])
  )

  if (active.length === 0) return rows

  return rows.filter(row => active.every(field => passes(row, field, filters[field] as ColumnFilter)))
}

/**
 * One column's distinct values with their counts, most common first and
 * `(blank)` last — measured against the rows the OTHER columns let through, so
 * the list never offers a value that would show nothing.
 */
export const columnValues = (
  rows: CmsRow[],
  filters: ColumnFilters,
  field: keyof CmsRow
): { value: string; count: number }[] => {
  const counts = new Map<string, number>()

  for (const row of applyColumnFilters(rows, filters, field)) {
    const value = cellText(row, field)

    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => {
      if (a.value === BLANK) return 1
      if (b.value === BLANK) return -1
      if (a.count !== b.count) return b.count - a.count

      return a.value.localeCompare(b.value)
    })
}

/** The filters with one column changed; a column left narrowing nothing is dropped. */
export const withColumnFilter = (
  filters: ColumnFilters,
  field: keyof CmsRow,
  next: ColumnFilter
): ColumnFilters => {
  const copy = { ...filters }

  if (isColumnFiltered(next)) copy[field] = next
  else delete copy[field]

  return copy
}
