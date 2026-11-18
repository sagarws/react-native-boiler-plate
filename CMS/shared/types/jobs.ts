/**
 * Jobs — the batch runs this machine has done, in one list.
 *
 * A job is work an operator STARTED and came back to: it takes minutes to
 * hours, it runs in the background, and its outcome is a list of things that
 * worked and things that did not. That is the AJIO NDR/DDR bulk claim, the
 * Myntra re-claim and Map Username; it is not a single claim off the queue, and
 * not the master import, which nobody starts.
 *
 * WHY A SHARED SHAPE. Each job type keeps its own archive in its own store,
 * because what a bulk claim records (AWBs, SKUs, ticket numbers) and what a
 * re-claim records (ticket ids, Myntra's refusals) are not the same rows. The
 * Jobs page should not know either of them — so both are mapped onto this, and
 * adding a third job type is a mapper plus an entry in the registry, with no
 * change to the page.
 *
 * `ref` is deliberately vague: it is the thing the row is ABOUT, and what that
 * is depends on the job — a return AWB for a bulk claim, a ticket id for a
 * re-claim. `refLabel` on the job says what to call the column so the header
 * matches the data, rather than a generic "Reference" over two different things.
 */

export type JobKind =
  | 'ajio-bulk-claim'
  | 'myntra-re-claim'
  | 'account-map'
  | 'refill-data'
  | 'ajio-master-backup'
  | 'snapdeal-master-backup'
  /**
   * A scheduled window opening — the record of the CRON, not of the work.
   *
   * The odd one out, and deliberately so: nobody started it. A scheduled Refill
   * Data run still writes its own `refill-data` job with every AWB it touched;
   * this row says the 03:00 window opened, what it ran, and how it ended. That
   * is the question an unattended machine actually raises in the morning, and it
   * cannot be answered by reading four other job types and inferring it from
   * timestamps.
   */
  | 'scheduled-run'

/** How a job ended. `stopped` is an operator's decision, not a failure. */
export type JobStatus = 'running' | 'done' | 'stopped' | 'failed'

/** One job, as the list shows it. */
export interface JobRow {
  jobId: string
  kind: JobKind
  /** The marketplace this job filed at — "Ajio", "Myntra". */
  platform: string
  /** What this kind of job is called, in the words the app already uses. */
  label: string
  status: JobStatus
  startedAt: string
  finishedAt: string | null
  /** Rows the job set out to do. */
  total: number
  succeeded: number
  failed: number
  /** The run failing as a whole. Individual failures are counted, not this. */
  error: string | null
  /** The account(s) it ran as, and the file it came from — one line, for the list. */
  detail: string
}

/** One job, opened. The two lists the operator came for. */
export interface JobDetail extends JobRow {
  /** What to call the `ref` column for this kind of job. */
  refLabel: string
  succeededRows: JobSucceededRow[]
  failedRows: JobFailedRow[]
  /**
   * True when this machine holds only part of the story — a job run elsewhere,
   * or one whose archive was pruned. The page says so rather than showing an
   * empty list as though nothing succeeded.
   */
  partial: boolean
  /**
   * Facts about the run itself, for a job whose outcome is not a list of rows.
   *
   * A backup's answer is "the return report, September, 1,555 rows" — there is
   * no per-AWB story to tell and no spreadsheet to download, and two empty
   * tables headed Succeeded and Failed would say the opposite of the truth. So
   * a job that has this is shown as these lines; one that does not is shown as
   * its two lists, exactly as before.
   */
  summary?: JobSummaryLine[]
}

/** One stated fact about a run — "Records synced", "1,555". */
export interface JobSummaryLine {
  label: string
  value: string
}

export interface JobSucceededRow {
  /** The AWB, or the ticket id — see `refLabel`. */
  ref: string
  /** The ticket this produced, where the job produces one. */
  ticketId: string | null
  /** Anything else worth a column — the SKU, the status Myntra reported back. */
  note: string | null
  /** Which filing produced it — a bulk claim's attempt. Absent where a job has none. */
  attempt?: number | null
}

export interface JobFailedRow {
  ref: string
  /** Verbatim from the marketplace or the script. The reason, not a category. */
  reason: string
  /** How the job classified it — "Failed", "Not Claimable", "Refused". */
  result: string | null
  /**
   * The article, where one return can fail per article — a bulk claim's SKU/EAN.
   * Absent for jobs whose ref already names one thing.
   */
  sku?: string | null
  /** Which filing ended this way — a bulk claim's attempt. Absent where a job has none. */
  attempt?: number | null
}
