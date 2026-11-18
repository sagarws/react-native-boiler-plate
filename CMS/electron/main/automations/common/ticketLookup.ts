import type { ClaimDocument } from './types'
import type { QueuedClaim } from '@shared/types/claimQueue'

/**
 * "Did a ticket appear anyway?" — asked after a claim has failed.
 *
 * A FAILED CLAIM IS NOT ALWAYS AN UNFILED ONE. A gateway can answer 502 after
 * the marketplace committed the case; a read-back can fail on a claim that was
 * filed a minute earlier; a run can die between filing and recording. Every one
 * of those leaves a row marked Failed against a ticket that exists, and the
 * usual next move — file it again — is the one thing that must not happen.
 *
 * So when a claim fails on a platform that can be ASKED, it is asked: is there
 * a ticket for this return now? A ticket found here is this run's, or an
 * earlier run's that was recorded the same way — either way the row has one,
 * and recording it is more honest than reporting a failure.
 *
 * WHAT IT MUST NOT DO is invent one. A lookup that cannot reach the
 * marketplace, or is not sure, answers null and the failure stands.
 */

export interface TicketLookupInput {
  claim: QueuedClaim
  doc: ClaimDocument
  /** The marketplace account the claim belongs to — already resolved. */
  username: string
}

export interface TicketFound {
  ticketId: string
  /** The CMS status read off the ticket, when the marketplace says. */
  cmsStatus: string | null
  /** The marketplace's own word, for the log. */
  marketplaceStatus: string | null
}

export type TicketLookup = (input: TicketLookupInput) => Promise<TicketFound | null>
