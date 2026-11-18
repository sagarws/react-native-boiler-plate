import type { RefillField } from '@shared/types/refill'
import type { ClaimDocument } from '../common/types'

/**
 * What a platform's Refill resolver is asked, and what it answers.
 *
 * ONE CALL WHERE THE MARKETPLACE MAKES ONE. Meesho's Returns search answers the
 * account and the sub-order number together; Myntra's claim lookup answers the
 * account and the forward AWB together. So the resolver is handed every field
 * the operator ticked and decides how many calls that actually costs, rather
 * than being invoked once per field and asking the same endpoint three times.
 *
 * The account is resolved by the run itself (it needs the multi-login sweep and
 * the session pool), so a resolver is given the account it belongs to and never
 * has to find it.
 */

export interface RefillInput {
  doc: ClaimDocument
  awb: string
  /** The marketplace account this claim belongs to — already established. */
  username: string
  /** The ticket, when the row has one. `statusChange` needs it. */
  ticketNumber: string | null
  /** Exactly the fields the operator ticked, minus `accountMapping`. */
  fields: RefillField[]
  /** Sessions opened by this run, keyed by username. Reuse one, or put yours in. */
  contexts: Map<string, unknown>
}

/**
 * What the marketplace answered. Every field optional: a resolver returns what
 * it learned and says nothing about the rest.
 */
export interface RefillValues {
  /**
   * Nobody has this AWB — said, not thrown.
   *
   * The difference matters in the report: FAILED means something broke and is
   * worth investigating (a dead session, a relay that is down); NOT FOUND means
   * the question was asked and answered, and the answer was no. An AWB that is
   * not in this machine's AJIO backup is the second, and reporting it as the
   * first sends somebody looking for a bug instead of at the row.
   *
   * The text is the reason, and it is shown as-is.
   */
  missing?: string | null
  subOrderNumber?: string | null
  forwardAWB?: string | null
  sellerSku?: string | null
  pobId?: string | null
  /**
   * The account, when the platform resolves it ITSELF.
   *
   * Only for a resolver registered with `answersAccount` — everywhere else the
   * run establishes the account by probing each login, and a resolver is handed
   * the answer rather than producing one.
   */
  username?: string | null
  /**
   * The row's ticket number, CORRECTED — the marketplace's public number for a
   * row that holds an internal one. Delhivery claims found already filed were
   * once recorded with the internal UUID from its claims list instead of the
   * "J…" number; the status pass replaces it when it meets one. Set only when
   * it differs from what the row holds.
   */
  ticketNumber?: string | null
  /** The CMS status, already mapped from the marketplace's own word. */
  status?: string | null
  /** The marketplace's own word, for the log and the report. */
  marketplaceStatus?: string | null
  /** Only ever alongside an Approved/Paid status. */
  compensationAmount?: number | null
  /**
   * Why the marketplace rejected it, in its own words. Only meaningful beside a
   * Rejected status — the backend stores it there and ignores it anywhere else,
   * so a resolver may return whatever remark the marketplace gave.
   */
  rejectReason?: string | null
}

export type RefillResolver = (input: RefillInput) => Promise<RefillValues>

/**
 * How a platform's refill behaves, beyond what it answers.
 *
 * Both flags exist for AJIO, and both are statements about where the answer
 * lives rather than switches on a platform name: its data is on this machine,
 * so there is no browser to start and no login to ask which account owns an AWB.
 */
/**
 * What this machine's own report backup holds for a return AWB — no login, no
 * network. Null when the backup has no row for it.
 */
export type LocalRefill = (awb: string) => Promise<{
  forwardAWB?: string | null
  subOrderNumber?: string | null
  sku?: string | null
  pobId?: string | null
  username?: string | null
} | null>

export interface RefillPlatform {
  resolve: RefillResolver
  /**
   * The local backup's answer, for a row that is not a claim yet (Normal Bulk
   * Claim). Absent for a platform this machine keeps no report backup of.
   */
  local?: LocalRefill
  /** Answers `accountMapping` itself — the run does not probe the logins. */
  answersAccount?: boolean
  /** Needs no marketplace session, so no browser is prepared. */
  offline?: boolean
  /** Dropped between runs, for a resolver that caches within one. */
  reset?: () => void
}
