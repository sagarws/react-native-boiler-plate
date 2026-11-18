/**
 * Refill for Normal Bulk Claim — the blanks on a sheet row that is not a claim
 * yet.
 *
 * Refill Data works on claims that EXIST: it reads them from TrackVid and
 * writes its answers back there. A bulk row has only what the operator typed —
 * often just the return AWB — and nothing is written anywhere until the
 * operator presses Proceed. So this asks the same questions and hands the
 * answers back to the renderer, which fills them into the row before it is
 * verified.
 *
 * LOCAL FIRST, THEN THE MARKETPLACE. The report backups on this machine answer
 * instantly and without a login; whatever they cannot answer is asked of the
 * marketplace through the same resolvers Refill Data uses, on sessions that are
 * already live — never a fresh sign-in.
 */

/** One sheet row, as far as refill cares. Empty string means blank. */
export interface BulkRefillRow {
  /** The renderer's row id, echoed back. */
  id: string
  awb: string
  /** The Seller Account cell, when the sheet named one. */
  account: string
  forwardAWB: string
  subOrderNumber: string
  sku: string
  pobId: string
}

/** What was learned for one row. Only blanks are ever answered. */
export interface BulkRefillValues {
  account?: string
  forwardAWB?: string
  subOrderNumber?: string
  sku?: string
  pobId?: string
}

export interface BulkRefillResult {
  id: string
  values: BulkRefillValues
  /** Which source answered something: the local backup, the marketplace, both, or neither. */
  source: 'local' | 'marketplace' | 'both' | null
  /** Why something is still blank — shown on the row. Null when nothing is. */
  message: string | null
}

export interface BulkRefillRequest {
  /** Echoed on every progress event so a stale run's events can be ignored. */
  runId: string
  platform: string
  rows: BulkRefillRow[]
}

export interface BulkRefillProgress {
  runId: string
  platform: string
  /** `local` reads the backups; `marketplace` asks the portal. */
  step: 'local' | 'marketplace'
  done: number
  total: number
  current: string | null
}
