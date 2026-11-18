import type { CmsRow } from '@shared/types/cmsList'

/**
 * The Claims table's column filter — the spreadsheet kind, where a column is
 * narrowed by ticking the values it actually holds.
 *
 * ON THE PAGE THAT IS LOADED, and nothing else. This is not a query: it does
 * not go to the server, it does not change the counts on the tabs, and it
 * cannot show a row that is on page 3. That is the honest shape of it, and the
 * dialog says so — a filter that silently searched only part of the data would
 * be worse than no filter.
 *
 * Why two columns: an operator looking at 57 failures asks one of two
 * questions — "what happened to THIS parcel" (Return AWB) or "how many of these
 * are the same failure" (Script Error). Everything else on that row they can
 * already see.
 *
 * Pure, and in `shared`, so the rules are testable without a window.
 */

/** Columns that can be filtered. Adding one is an entry here and a label. */
export type FilterField = 'returnAwb' | 'scriptError'

export const FILTER_FIELDS: { field: FilterField; label: string }[] = [
  { field: 'returnAwb', label: 'Return AWB' },
  { field: 'scriptError', label: 'Error' }
]

/** Ticked values per column. An absent or empty set means "this column is not filtered". */
export type RowFilters = Partial<Record<FilterField, string[]>>

/** What an empty cell is called in the value list, so it can be ticked like any other. */
export const BLANK = '(blank)'

export const valueOf = (row: CmsRow, field: FilterField): string => {
  const raw = row[field]

  return typeof raw === 'string' && raw.trim() ? raw : BLANK
}

/**
 * The distinct values of one column, with how many rows hold each.
 *
 * Sorted by count, biggest first: on the Script Error column that puts the
 * failure worth acting on at the top, which is the reason to open this at all.
 * Ties are broken alphabetically so the order does not wander between renders.
 * `(blank)` sorts last whatever its count — it is the absence of an answer.
 */
export const distinctValues = (
  rows: CmsRow[],
  field: FilterField
): { value: string; count: number }[] => {
  const counts = new Map<string, number>()

  for (const row of rows) {
    const value = valueOf(row, field)

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

/** Is this column narrowed at all? An empty list is not a filter. */
export const isFiltered = (filters: RowFilters, field: FilterField): boolean =>
  (filters[field]?.length ?? 0) > 0

/** How many columns are narrowed — what the button shows. */
export const activeFilterCount = (filters: RowFilters): number =>
  FILTER_FIELDS.filter(({ field }) => isFiltered(filters, field)).length

/**
 * Rows that pass every narrowed column (AND across columns, OR within one) —
 * the same rule a spreadsheet uses.
 */
export const applyFilters = (rows: CmsRow[], filters: RowFilters): CmsRow[] => {
  const active = FILTER_FIELDS.filter(({ field }) => isFiltered(filters, field))

  if (active.length === 0) return rows

  return rows.filter(row =>
    active.every(({ field }) => (filters[field] ?? []).includes(valueOf(row, field)))
  )
}

/**
 * The filters with one column's selection replaced.
 *
 * A selection covering every value is stored as NO filter: it means the same
 * thing and it keeps the button's count honest.
 */
export const withSelection = (
  filters: RowFilters,
  field: FilterField,
  selected: string[],
  available: string[]
): RowFilters => {
  const next = { ...filters }

  if (selected.length === 0 || selected.length >= available.length) delete next[field]
  else next[field] = selected

  return next
}

/**
 * A dialog's working copy, which needs a state the applied filters do not have:
 * "nothing ticked".
 *
 *   undefined  this column is not narrowed — every value is in play
 *   []         nothing is ticked, so no row matches
 *   [values]   those values
 *
 * `RowFilters` cannot carry the middle one: an empty list there means "not
 * filtered", which is why unticking everything used to re-tick the whole column
 * and both Clear buttons looked dead. The dialog keeps this shape while it is
 * open and converts on Apply.
 */
export type FilterSelection = Partial<Record<FilterField, string[]>>

/** What the dialog's "N of M rows match" counts — empty means empty. */
export const previewRows = (rows: CmsRow[], picked: FilterSelection): CmsRow[] =>
  rows.filter(row =>
    FILTER_FIELDS.every(({ field }) => {
      const picks = picked[field]

      return picks === undefined ? true : picks.includes(valueOf(row, field))
    })
  )

/** A column with nothing ticked — Apply is refused while one exists. */
export const hasEmptySelection = (picked: FilterSelection): boolean =>
  FILTER_FIELDS.some(({ field }) => picked[field]?.length === 0)

/**
 * Working copy → applied filters. A column ticked in full is dropped: it means
 * the same as not filtering, and keeping it would inflate the button's count.
 */
export const toFilters = (picked: FilterSelection, rows: CmsRow[]): RowFilters => {
  const filters: RowFilters = {}

  for (const { field } of FILTER_FIELDS) {
    const picks = picked[field]

    if (!picks || picks.length === 0) continue

    const available = new Set(rows.map(row => valueOf(row, field)))

    if (picks.length < available.size) filters[field] = picks
  }

  return filters
}
