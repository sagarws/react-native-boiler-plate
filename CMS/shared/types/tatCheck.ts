/**
 * "Check TAT" — asking the marketplace whether a claim can still be filed at
 * all, before an operator spends a batch finding out one row at a time.
 *
 * Meesho answers this directly (validateTicketField: "The dispute can only be
 * claimed within 7 days of return delivery"). A claim past that window can
 * never be filed, so it is moved to Failed to Proceed with "TAT Expired" as its
 * script error rather than left on Pending to burn its three attempts.
 */

/** What the marketplace said about one claim. */
export type TatOutcome =
  /** Past the claim window — filed away as Failed to Proceed. */
  | 'expired'
  /**
   * Refused for something that will not change on its own — today, a sub-order
   * number Meesho does not recognise. Filed away like `expired`, under its own
   * code, because the fix is different: this one Refill Data can repair, and a
   * row hidden under "TAT expired" would never be offered to it.
   */
  | 'blocked'
  /** Still claimable as far as the marketplace is concerned. */
  | 'within'
  /**
   * Could not be established: no session, no sub-order number, the call failed,
   * or the marketplace refused the row for a reason that is NOT the window.
   * Deliberately distinct from `within` — nothing is written for these.
   */
  | 'unknown'

export interface TatRowResult {
  cmsId: string
  awb: string
  outcome: TatOutcome
  /** The marketplace's own words, or why the check could not run. */
  message: string | null
  /** The code written onto the row — "ME1: TAT expired", "ME2: …". */
  error?: string | null
  /** Whether the claim was actually moved to Failed to Proceed. */
  movedToFailed: boolean
}

export interface TatCheckSummary {
  checked: number
  expired: number
  /** Refused for a reason that is not the window — see `blocked`. */
  blocked: number
  within: number
  unknown: number
  /** Claims moved to Failed to Proceed by this run. */
  moved: number
  rows: TatRowResult[]
}

/**
 * How far a run has got, pushed while it runs.
 *
 * A check is one marketplace round trip per claim — twenty-five rows take long
 * enough that an operator needs to see it moving, and needs the counts as they
 * land rather than only in a toast at the end.
 */
export interface TatCheckProgress {
  platform: string
  /** Claims in this run. */
  total: number
  /** Claims answered so far. */
  done: number
  expired: number
  /** Refused for something that is not the window — a bad sub-order number. */
  blocked: number
  within: number
  unknown: number
  /** Moved to Failed to Proceed so far. */
  moved: number
  /** The AWB being asked about right now; null once the run is over. */
  current: string | null
  /** The last few answers, newest first — what the dialog lists as it goes. */
  recent: TatRowResult[]
  finished: boolean
}
