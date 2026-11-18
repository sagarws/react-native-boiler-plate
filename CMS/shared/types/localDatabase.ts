/**
 * The Local Database page: every JSON collection this machine keeps under
 * `userData/data`, listed and editable row by row.
 */

export interface LocalTable {
  /** Collection name — the file is `<name>.json`. */
  name: string
  /** Records in it; null when the file is not a list (and so not editable). */
  rows: number | null
  bytes: number
  /** ISO. */
  modifiedAt: string
}

export interface LocalTableQuery {
  table: string
  /** Zero-based. */
  page: number
  pageSize: number
  /** Case-insensitive text match against each record's JSON. */
  search?: string
}

export interface LocalTableRow {
  /** Position in the collection — the key every edit is addressed by. */
  index: number
  record: unknown
}

export interface LocalTablePage {
  table: string
  /** Records in the whole collection. */
  total: number
  /** Records matching the search. */
  matched: number
  page: number
  pageSize: number
  /** Top-level keys across this page's records, in first-seen order. */
  columns: string[]
  rows: LocalTableRow[]
}

/**
 * `expected` is the record as the page read it. The write is refused when the
 * row has changed since, so an edit never lands on a record that moved under it.
 */
export interface LocalRowUpdate {
  table: string
  index: number
  expected: unknown
  record: unknown
}

export interface LocalRowDelete {
  table: string
  index: number
  expected: unknown
}

export interface LocalRowInsert {
  table: string
  record: unknown
}
