/**
 * Account mapping — filling in which marketplace login a claim belongs to.
 *
 * A claim that arrives from a scan or a feed carries an AWB and nothing else,
 * and the account is what everything downstream keys on. Only the marketplace
 * can say which of a company's logins holds a given return, so the app asks
 * them: for each credential, does this account hold this AWB? First yes wins.
 */

/** One claim the run will try to place. */
export interface AccountMapCandidate {
  cmsId: string
  awbNumber: string
  platform: string
  status: string
  /**
   * The account the row ALREADY names, when it names one.
   *
   * A row can be a candidate on the strength of a missing POB alone, so this
   * is often filled. The run then asks ONLY this account rather than sweeping
   * every login — an account put there by an operator or by master data is a
   * decision, and two of a company's accounts can both see the same AWB, so
   * re-deriving it risks quietly moving the claim to a different seller.
   */
  username: string
  /** AJIO only — already-known place of business, if the row has one. */
  pobId: string
  /** Meesho only — already-known sub-order number, if the row has one. */
  subOrderNumber: string
  /** The row names no account. */
  needsAccount: boolean
  /**
   * The row is missing the second identifier its platform needs — AJIO's place
   * of business, Meesho's sub-order number. Either one on its own makes the
   * claim unfileable, so either one on its own makes the row worth asking about.
   */
  needsCompanion: boolean
}

/** What happened to one claim. */
export interface AccountMapOutcome {
  cmsId: string
  awbNumber: string
  /** The account that claimed it, or null when none did. */
  username: string | null
  /** AJIO: the place of business resolved alongside the account. */
  pobId: string | null
  /**
   * AJIO: the return order the AWB belongs to, resolved by the same search.
   * Null on every other platform — no other probe answers with one.
   */
  returnOrderId: string | null
  /** Meesho: the sub-order number read off the returns row. */
  subOrderNumber: string | null
  /**
   * `mapped` wrote something; `unmapped` means no account owned the AWB;
   * `conflict` means the account was found but its sub-order number disagrees
   * with the one already on the row, and Auto-mapping was off — so nothing was
   * overwritten and the operator decides.
   */
  result: 'mapped' | 'unmapped' | 'skipped' | 'failed' | 'conflict'
  message: string
}

/**
 * The marketplace and the CMS row disagree about a value the row already has.
 *
 * Only the sub-order number, and only Meesho and Snapdeal have one. It matters
 * because Meesho's claim form is filled BY the sub-order number: a row carrying
 * the ORDER number, or one imported against the wrong order, fails at filing
 * time with an error that names neither.
 *
 * Not resolved automatically unless the operator said so: the stored value may
 * be their own correction, and the marketplace's may be a neighbouring row's.
 */
export interface AccountMapConflict {
  cmsId: string
  awbNumber: string
  /**
   * WHICH value disagrees.
   *
   *   account   the AWB is on a different login than the row names — the claim
   *             can never be filed as it stands, because the login it names
   *             does not hold the parcel
   *   subOrder  the account is right, its sub-order number is not
   */
  field: 'account' | 'subOrder'
  /** The account that owns the AWB, per the marketplace. */
  username: string
  /** What the CMS row holds today for `field`. */
  existing: string
  /** What the marketplace says for `field`. */
  fetched: string
  /**
   * The sub-order number from the account that owns the AWB.
   *
   * Carried on an ACCOUNT conflict too: replacing the account without it would
   * pair a new login with the old login's sub-order number, which is a worse
   * row than either mistake alone.
   */
  subOrderNumber: string | null
  /** AJIO: the place of business under which that account holds the return. */
  pobId: string | null
}

/** How far a run has got. Pushed, not polled — a sweep takes minutes. */
export interface AccountMapProgress {
  platform: string
  /** Attempted so far — mapped, unmapped and failed alike. */
  done: number
  total: number
  mapped: number
  unmapped: number
  failed: number
  /**
   * Found, and there was nothing to write — the row already holds what the
   * marketplace says.
   *
   * Counted apart from `unmapped` because it is the opposite verdict. Lumping
   * the two together reported four rows that were ALREADY CORRECT as "No match
   * 4", which reads as a broken lookup and sends someone hunting a bug in the
   * API.
   */
  skipped: number
  /** Found, but something disagrees and nothing was written — see conflicts. */
  conflicts: number
  /** The AWB being asked about right now; empty on the final tick. */
  awbNumber: string
  running: boolean
  /** The claims no account owned, and the ones that broke. */
  misses: { awbNumber: string; message: string }[]
}

/** The finished run. */
export interface AccountMapSummary {
  platform: string
  total: number
  mapped: number
  unmapped: number
  failed: number
  /** Found, with nothing left to write. Not a miss — see AccountMapProgress. */
  skipped: number
  outcomes: AccountMapOutcome[]
  /**
   * Rows whose stored sub-order number disagrees with the marketplace's.
   * Empty when Auto-mapping was on — those were replaced as they were found.
   */
  conflicts: AccountMapConflict[]
  /** Sub-order numbers this run overwrote (Auto-mapping on). */
  replaced: number
}

/** One operator decision about a conflict — what to write, or nothing. */
export interface ConflictResolution {
  cmsId: string
  /** Which value the operator chose to replace. */
  field: 'account' | 'subOrder'
  /** The account to store — an account conflict writes this and its companions. */
  username: string
  /** The sub-order number to store, when there is one. */
  subOrderNumber: string | null
  /** AJIO: the POB belonging to the account being written. */
  pobId: string | null
}

/** What `account-map:resolve` reports back. */
export interface ConflictResolutionResult {
  applied: number
  failed: { cmsId: string; message: string }[]
}

/** How much work one platform has waiting. */
export interface AccountMapPending {
  platform: string
  /**
   * Claims missing an account, or missing the second identifier their platform
   * needs. Capped at the same limit a run takes, so a company with more than
   * that sees the cap and gets the rest on the next press.
   */
  count: number
  /** True when `count` hit the cap and there are more behind it. */
  capped: boolean
  /**
   * Every eligible claim's id.
   *
   * Carried so the operator can tick all of them at once: the grid pages at 25
   * and the count is company-wide, so without these "select every eligible
   * claim" would mean paging through the company and running a separate pass
   * per page.
   */
  cmsIds: string[]
}

/**
 * A finished Map Username run, kept on this machine so the Jobs page can show
 * it afterwards.
 *
 * THIS IS THE ONLY RECORD. A mapping run writes its answers onto the claims
 * themselves and tells TrackVid nothing about the run, so without this there is
 * no way to answer "what did that sweep actually change" once the window is
 * closed — which is exactly the question asked when a row looks wrong the next
 * day.
 */
export interface AccountMapJobArchive {
  jobId: string
  platform: string
  startedAt: string
  finishedAt: string
  status: 'done' | 'failed'
  total: number
  mapped: number
  /** Found, with nothing left to write. */
  skipped: number
  unmapped: number
  failed: number
  /** Values overwritten because Auto-mapping was on. */
  replaced: number
  /** Whether the run was allowed to overwrite as it went. */
  autoMap: boolean
  /** The logins it could ask. */
  accounts: string[]
  error: string | null
  /** Every claim it touched, with what was written. */
  rows: AccountMapOutcome[]
}
