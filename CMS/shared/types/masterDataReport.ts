/**
 * AJIO's own dropship reports, read live.
 *
 * The seller portal's "View Reports" screen, brought into the app so an
 * operator can check what AJIO actually holds for a date range against the
 * claims in front of them — without leaving for the portal or waiting on a
 * workbook download.
 *
 * A READ, end to end. Nothing here writes to AJIO or to TrackVid.
 */

export type ReportType = 'forward' | 'return'

/** One column of the report, as the core describes it. */
export interface ReportColumn {
  key: string
  label: string
}

export interface ReportPage {
  reportType: ReportType
  /** The account the report was read from. */
  username: string
  columns: ReportColumn[]
  /** Raw rows — every field AJIO returned, not just the ones with columns. */
  rows: Record<string, unknown>[]
  /** Zero-based, as AJIO counts. */
  pageNumber: number
  totalPages: number
  /**
   * How many rows AJIO says the window holds. Null when it does not say.
   *
   * `totalPages` alone cannot tell a finished read from a capped one: AJIO
   * answers 100 for every month, which at 100 rows a page is exactly the
   * 10,000-row result window.
   */
  totalElements: number | null
  /** How many places of business the query covered. */
  pobCount: number
  /** Which ones — echoed so the table can say what it is showing. */
  pobIds: string[]
}

/** An AJIO account a report can be read from. */
export interface ReportAccount {
  username: string
  pobCount: number
  /**
   * The account's places of business, so the operator can narrow the report to
   * some of them. Sent back on the query; all of them when none is chosen.
   */
  pobIds: string[]
}

/**
 * One line of an AJIO return order, as the Create Claim form fills from it.
 *
 * Only the fields the form writes, plus enough to tell two lines apart in the
 * picker. Nulls are AJIO's own — `fwdAwbNo` is often null on an RTO.
 */
export interface AjioReturnOrderLine {
  returnOrderNo: string
  returnAwbNo: string | null
  fwdAwbNo: string | null
  ean: string | null
  pobId: string | null
  sellerSku: string | null
  jioCode: string | null
  custOrderNo: string | null
  returnCreateDate: string | null
  returnStatus: string | null
  returnType: string | null
  brand: string | null
}

export interface AjioReturnOrderLookup {
  lines: AjioReturnOrderLine[]
  /**
   * The AJIO account the order was actually found under.
   *
   * Carried because the lookup sweeps every account when the chosen one does
   * not have it, and the form must FOLLOW that: data from account B shown
   * against account A selected is a claim filed with the wrong login, which
   * the marketplace rejects and nobody can explain afterwards.
   */
  username: string
  /** The window the order was found in, or null when none had it. */
  window: { from: string; to: string } | null
  /** How many 31-day windows were asked. */
  searched: number
  /**
   * Which source actually answered.
   *
   * Reported because the two are indistinguishable from the filled form, and
   * that ambiguity has already cost an afternoon: an empty backup left the
   * previous API answer on screen and it read as a Report result. The toast
   * says which one, so the question is never a matter of inference.
   */
  source?: 'api' | 'report'
  /**
   * What the local backup covers, when the REPORT source answered with nothing.
   *
   * Carried so "no record found" can say which days were actually searched. The
   * two reasons a backup misses an order — the sync has not reached that month,
   * or the order is genuinely not AJIO's — look identical without it, and only
   * one of them is the operator's to fix.
   *
   * Null for the API source, and when the backup holds nothing at all.
   */
  coverage?: { from: string; to: string } | null
}
