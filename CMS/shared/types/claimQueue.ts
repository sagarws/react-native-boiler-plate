/**
 * Claims pushed to this machine for processing.
 *
 * The backend routes a claim here when the company has
 * `settings.desktopExecution.<platform>.claim` on. It arrives over the socket
 * as ids only — the app fetches whatever it needs over the authenticated API,
 * so a socket frame never carries claim contents, and the payload cannot drift
 * from the CMS schema.
 */

/** Exactly what the server emits on `cms:claim:dispatch`. */
export interface ClaimDispatch {
  cmsId: string
  companyId: string
  platform: string
  awbNumber?: string
  dispatchedAt: string
  /**
   * The backend decided this machine owns the claim.
   *
   * It always did — a claim is only pushed here because the dispatch routed it
   * here — but this app used to check `desktopExecution` again on arrival and
   * refuse when it read differently. It can read differently for two ordinary
   * reasons: a platform whose claim exists only on the desktop (the dispatch
   * defaults it here, whatever is stored) and a row with no seller account
   * (the dispatch sends it to the side that can find one).
   *
   * The result was a claim nobody filed. The server had handed it over, this
   * app declined it, and the row sat on "Queued" with nothing to say why.
   *
   * Absent on a build of the backend that predates this, which is why the
   * check it replaces is still there for pulled claims.
   */
  routedHere?: boolean
  /** The dispatch's own words, for the log. */
  routedReason?: string
}

/**
 * Where a queued claim has got to on this machine.
 *
 * `received` is deliberately distinct from `queued`: the first means the socket
 * frame landed and was written to disk, the second that it is eligible to run.
 * Collapsing them would hide a claim that arrived and was never picked up.
 */
export type QueuedClaimStatus = 'received' | 'queued' | 'running' | 'succeeded' | 'failed'

export interface QueuedClaim extends ClaimDispatch {
  status: QueuedClaimStatus
  /** When this machine first stored it. */
  receivedAt: string
  /** Last status change, so a stuck row is visible. */
  updatedAt: string
  /**
   * Ticked every 30s while this claim is actually being worked.
   *
   * Local only — it is never sent anywhere. It answers "started 6 minutes ago,
   * still going" for the operator, which `updatedAt` cannot: that stops moving
   * the moment the status is set to running.
   *
   * NOT what recovery is based on. See claimLiveness.service.
   */
  lastBeatAt?: string
  /** Why it failed, when it did. */
  error?: string
  /** Server-side ticket id once the claim is filed. */
  ticketId?: string
}

/** Live view of the socket connection, for the UI. */
export interface ClaimSocketState {
  connected: boolean
  /** Absent until a first connection succeeds. */
  connectedAt?: string
  lastError?: string
}

/** Outcome of filing one claim from this machine. */
export interface ProcessResult {
  cmsId: string
  ticketId: string | null
  message: string
  /**
   * The CMS status the marketplace's own ticket state maps to, when the runner
   * learned one — Delhivery, Meesho, Nykaa and Xbees read it back off an
   * existing ticket and map it (`mapTicketStatus`).
   *
   * The server writes this alongside the ticket; this app dropped it, so a
   * claim whose ticket was already "approved" at the marketplace came back and
   * sat on "Pending" here until a status-sync job happened to correct it.
   */
  cmsStatus?: string | null
}

/** One status tab, as the admin panel renders it. */
export interface ClaimStatusTab {
  value: string
  label: string
  /** The dot colour, matched to TrackVid-FE so the two panels look alike. */
  dot: string
}

/**
 * Whether this machine may file a claim for a platform, and enough context to
 * say WHY when it may not.
 *
 * `supported` is the answer the button needs; the other three exist so the
 * operator gets an accurate reason rather than the one guess that used to be
 * shown for every case. An empty `routedHere` with `routingKnown: false` means
 * the lookup failed — not that the company routed nothing here.
 */
export interface ClaimSupport {
  /** False when the routing lookup failed; everything below is then unknown. */
  routingKnown: boolean
  /** Platforms this build has a desktop runner for. */
  runners: string[]
  /** Platforms this company routed to desktop execution. */
  routedHere: string[]
  /** The intersection — what can actually be filed here. */
  supported: string[]
}

/** One tick of a Create Ticket batch. `running: false` means it is over. */
/**
 * One marketplace's share of a batch.
 *
 * WHY A BATCH IS COUNTED PER PLATFORM AT ALL. "14 of 30 filed" is the progress
 * of the run; it is not the progress of anything an operator can act on. The
 * question the Auto claim row has to answer is "is Myntra finished" — and a
 * batch that has filed every Myntra claim and not started on Snapdeal looks
 * identical, in the totals, to one halfway through both.
 *
 * `total` is fixed when the batch starts, so a platform's chip can be drawn
 * before its first claim runs.
 */
export interface ClaimBatchPlatform {
  /** As the CMS row spells it — "Myntra", "Tata CliQ". */
  platform: string
  /** Claims this batch will ATTEMPT for it. Skipped ones are not in here. */
  total: number
  /** Attempted — succeeded plus failed, so it matches the batch's own `done`. */
  done: number
  /** Filed AND the ticket number came back. See `ticketless`. */
  succeeded: number
  failed: number
  /**
   * The runner reported success and the marketplace gave back NO ticket id.
   *
   * Counted apart from `succeeded` because the two need different things done
   * about them. A claim with a ticket is finished; one without may have been
   * raised at the marketplace with nothing recorded here — the expensive case,
   * because a retry cannot tell and would raise a second ticket for one return.
   *
   * Folding these into "filed" is what let a run report 46 filed over a list
   * holding 6 tickets: the write-back to TrackVid is guarded on the ticket id,
   * so a ticket-less success writes nothing and still counted as filed.
   */
  ticketless: number
  /**
   * Passed over without being tried, because the account they need has no
   * usable session.
   *
   * Counted apart from `failed` because it is a different sentence and a
   * different fix: nothing went wrong with these claims, and the thing to do
   * about them is re-capture a session, not debug a claim.
   */
  skipped: number
}

export interface ClaimBatchProgress {
  /** Attempted so far — successes AND failures, so the bar tracks work, not luck. */
  done: number
  total: number
  /** Filed AND the ticket number came back. */
  succeeded: number
  failed: number
  /** Filed with no ticket id — see ClaimBatchPlatform.ticketless. */
  ticketless: number
  /**
   * The claims that failed, with the reason. Carried on every tick so the panel
   * can show the tally as it grows rather than only at the end — a batch of
   * twenty that is quietly failing all of them should say so on the third.
   */
  failures: { awbNumber: string; error: string }[]
  /** The claim being filed right now — empty on the final tick. */
  cmsId: string
  platform: string
  awbNumber: string
  running: boolean
  /**
   * The same batch, broken down by marketplace. Every platform in the batch is
   * present from the first tick, whether or not it has been reached yet.
   */
  platforms: ClaimBatchPlatform[]
  /** Claims passed over for want of a session. Never part of `total`. */
  skipped: number
  /**
   * What the batch is doing when it is not filing a particular claim.
   *
   * There is real work before the first claim — checking every account's
   * session, and possibly waiting for an operator to sign one in — and while it
   * happened the batch announced nothing at all. The panel was empty, the
   * button spun, and the only honest reading was that nothing had started.
   */
  phase?: string
}

/**
 * An account the run passed over, and what it cost.
 *
 * The count is the point. "Myntra has no session" is a fact about an account;
 * "Myntra has no session and eight claims went unfiled because of it" is the
 * one somebody decides whether to act on tonight.
 */
export interface SkippedAccount {
  platform: string
  username: string
  /** Claims left unfiled because of this account. */
  claims: number
  /** What the session probe said, for the Jobs row. */
  detail: string
}

/**
 * An account whose session cannot file a claim, as the live probe found it.
 *
 * Crosses the IPC boundary (claim-queue:session-check), so it lives here
 * rather than being declared on both sides: the Claims page turns these into
 * the same re-capture dialog it shows for an expired session, and a drifting
 * copy would silently stop matching.
 *
 * Distinct from `InactiveAccount` in shared/utils/sessionPreflight, which is
 * what the STORED record can tell you. `dead` is the verdict that record
 * cannot give — the marketplace refusing a jar that has not run out yet.
 */
export interface BlockedAccount {
  platform: string
  username: string
  /** One line an operator can act on. */
  detail: string
  /** Needed to offer a re-capture. Null when this machine holds no such login. */
  credentialId: string | null
  state: 'dead' | 'none'
}
