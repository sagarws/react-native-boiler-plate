/**
 * Re-claim — disputing a Myntra claim that has already been decided.
 *
 * A rejected SPF claim can be reopened with an argument and the same proofs,
 * and Myntra re-validates it. The operator brings a rejection export; each row
 * is an instruction to reopen one ticket.
 */

/**
 * One row, as read from the sheet or typed by hand.
 *
 * Three fields are the instruction; everything else an operator's export
 * happened to carry stays on `raw` for them to read. `status`,
 * `rejectionReason` and the dates used to be typed here — they were never
 * required, and declaring them made a row from a 3-column template look like it
 * had lost them.
 */
export interface ReClaimRow {
  /** 1-based, counting the header — the spreadsheet's own row number. */
  rowNumber: number
  ticketId: string
  /**
   * The argument for reopening THIS ticket — the sheet's "RR Remarks" column,
   * sent to Myntra as the dispute's description. Mandatory: Myntra refuses a
   * dispute without one.
   */
  description: string
  /** Optional. Blank keeps the category the ticket already has. */
  issueCategory: string
  /** Every cell of their sheet, including columns this app does not know. */
  raw: Record<string, unknown>
}

export interface ReClaimSheet {
  /** The file it was read from, or null for rows typed into the app. */
  path: string | null
  /** Where the rows came from, so the job's history can say. */
  source: 'file' | 'manual'
  rows: ReClaimRow[]
  /**
   * Required headers the file did not have — `ticketId` or `RR Remarks`. A
   * sheet with either missing cannot be disputed, so this is a refusal rather
   * than the warning it was when fourteen columns were "expected".
   */
  missing: string[]
}

/** What Myntra currently holds for a ticket. */
export interface ReClaimTicket {
  found: boolean
  status: string | null
  originalStatus: string | null
  validationReason: string | null
  /** The whole row, shown verbatim in the detail view. */
  row: Record<string, unknown> | null
}

/** The outcome of reopening one ticket. */
export interface ReClaimResult {
  ticketId: string
  ok: boolean
  message: string
  /** Read back AFTER the dispute, so the panel shows what Myntra now says. */
  ticket: ReClaimTicket | null
  /**
   * Exactly what was sent to Myntra — or would have been, when the failure
   * happened before the request.
   *
   * Carried because a refused dispute is nearly always a payload question: the
   * wrong issue category, an attachment Myntra will not accept, a ticket that
   * belongs to another account. Without it the operator gets a sentence and no
   * way to see which of those it was.
   */
  payload: Record<string, unknown> | null
  /** The failure, when there was one. Null on success. */
  error: string | null
}

/** How far a bulk re-claim has got. Pushed — a run of 700 tickets takes hours. */
export interface ReClaimProgress {
  /**
   * The job these ticks belong to, and the key its archive is stored under.
   *
   * Carried on every tick because the run outlives the window that started it:
   * a panel that mounts mid-run, or after one finished, has to be able to tell
   * whether this is the same job it was already watching.
   */
  jobId: string
  done: number
  total: number
  raised: number
  refused: number
  /** The ticket being disputed right now; empty on the final tick. */
  ticketId: string
  running: boolean
  /** Seconds until the next one, so the wait is visible rather than a freeze. */
  waitingMs: number
  /**
   * Which batch of `RE_CLAIM_BATCH_SIZE` is being worked, 1-based; 0 before the
   * first ticket.
   *
   * The run has always been one ticket at a time — this does not change the
   * pacing or the order, it names where the run has got to in the units the
   * operator is already looking at. The modal shows the same fifty rows on a
   * page, so "batch 7 of 61" and the page under it are the same thing.
   */
  batch: number
  batchCount: number
  /** Tickets finished inside the current batch, 0..RE_CLAIM_BATCH_SIZE. */
  batchDone: number
  /** The tickets Myntra would not reopen, with its reason. */
  refusals: { ticketId: string; message: string }[]
  /**
   * The ticket that just finished, so its row can fill in while the run
   * carries on.
   *
   * Only the last one, not the whole set: a run of several hundred would
   * otherwise send every result it has ever produced through IPC on every tick,
   * and the rows already have the earlier ones.
   */
  last: {
    ticketId: string
    ok: boolean
    message: string
    /**
     * What Myntra calls the ticket now, read back straight after the dispute —
     * AWAITING_AGENT_RESPONSE and the like.
     *
     * On the tick rather than left to the end, because it is what the row's
     * pill shows: "Raised" is this app's word for having sent something, and
     * the operator is watching for Myntra's. The status on its own and not the
     * ticket it came from — the whole claim row on every tick is the traffic
     * this field was kept small to avoid.
     */
    status: string | null
  } | null
}

export interface ReClaimSummary {
  total: number
  raised: number
  refused: number
  results: ReClaimResult[]
}

/* -------------------------------------------------------------------------
 * The job, once it is over
 * ------------------------------------------------------------------------- */

/** A ticket Myntra reopened, and what it called it afterwards. */
export interface ReClaimJobTicket {
  ticketId: string
  /** Read back straight after the dispute — AWAITING_AGENT_RESPONSE and the like. */
  status: string | null
}

/** A ticket that was not reopened, and Myntra's own reason. */
export interface ReClaimJobFailure {
  ticketId: string
  reason: string
}

/**
 * One finished re-claim run, kept on this machine.
 *
 * TrackVid holds nothing about a re-claim — the dispute is raised straight at
 * Myntra — so this is the only record that the run happened at all. Which is
 * why it is written even when the run failed or was stopped: "what did we
 * dispute last Tuesday" has no other answer.
 */
export interface ReClaimJobArchive {
  jobId: string
  /**
   * `running` is written before the first dispute, so a crash mid-run leaves a
   * job on disk to recover rather than nothing at all.
   */
  status: 'running' | 'done' | 'stopped' | 'failed'
  startedAt: string
  finishedAt: string | null
  /** The run itself failing, as opposed to individual tickets being refused. */
  error: string | null
  /** The Myntra login the disputes were sent from. */
  username: string
  source: ReClaimSheet['source']
  /** The uploaded file's name, or null for rows typed in. */
  fileName: string | null
  total: number
  raised: number
  refused: number
  tickets: ReClaimJobTicket[]
  failures: ReClaimJobFailure[]
}
