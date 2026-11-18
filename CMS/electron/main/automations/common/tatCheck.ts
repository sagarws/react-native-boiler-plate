import type { TatOutcome } from '@shared/types/tatCheck'
import type { ClaimDocument } from './types'

/**
 * The contract a platform's TAT check implements.
 *
 * One claim in, one verdict out. Everything around it — which rows, which
 * account, what to write when the window has closed — belongs to
 * services/tatCheck.service.ts, so a platform added later only has to answer
 * the marketplace's own question.
 */

export interface TatCheckInput {
  doc: ClaimDocument
  awb: string
  /** The marketplace account this claim belongs to. */
  username: string
  /**
   * Sessions already opened by this run, keyed by username. A checker must
   * reuse one when it is there and put its own in — a check over fifty claims
   * on one account is one sign-in, not fifty.
   */
  contexts: Map<string, unknown>
}

export interface TatCheckVerdict {
  outcome: TatOutcome
  /** The marketplace's own words, or why no verdict could be reached. */
  message: string | null
  /**
   * What to write in Script Error, for an outcome that files the row away.
   *
   * The checker decides, because only it knows which of the marketplace's
   * refusals this was — the window, or the sub-order number. Absent for
   * `expired`, which has one answer everywhere (see common/claimErrors).
   */
  error?: string | null
}

export type TatChecker = (input: TatCheckInput) => Promise<TatCheckVerdict>
