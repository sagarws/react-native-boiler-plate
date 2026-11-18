/**
 * The AJIO NDR/DDR bulk claim.
 *
 * An operator uploads one spreadsheet per claim type — AJIO's own return report
 * works as-is — and every row is filed from this machine straight from the
 * sheet: its Return AWB, SKU and POB ID, with the claim type the slot it came
 * in. One AJIO sign-in per account, not one per claim.
 */

/**
 * NDR — Not Delivered Returns: the return never arrived, and the ask is a
 * status update then an SPF payout if it is confirmed lost.
 *
 * DDR — Delivery Disputes Returns: AJIO says the return was delivered and the
 * seller never received it, and the ask is the POD.
 *
 * The upload slot a file arrives in IS the claim type, and it picks the email
 * template and the AJIO sub-issue the claim is raised with.
 */
export type BulkClaimType = 'NDR' | 'DDR'

export const BULK_CLAIM_TYPES: BulkClaimType[] = ['NDR', 'DDR']

export interface BulkSpfUpload {
  claimType: BulkClaimType
  /** Absolute path on this machine — chosen through a native dialog. */
  filePath: string
  fileName: string
  /** Rows read from the sheet, for the modal's "12 rows" line before submitting. */
  rowCount: number
}

/** What happened to one article. One return can produce several of these. */
export type BulkSpfOutcome =
  | 'Success'
  | 'Failed'
  | 'Help Center Failed'
  | 'Not Claimable'
  | 'Dry Run'
  | 'Skipped'
  | 'Pending'

export interface BulkSpfResultRow {
  awb: string
  sku: string
  claimType: string
  /** The row's POB, kept for the job history. Absent on rows from before it existed. */
  pobid?: string
  orderStatus: string
  result: BulkSpfOutcome
  reason: string
  ticketNumber: string
  error: string
  timestamp: string
  /**
   * A skip no retry can change, so "Retry failed" leaves it alone: a repeat of
   * an earlier sheet row (it shares that row's key, and is filed under it), a
   * row with no return number, a row the sheet says is already claimed, and one
   * the operator left unticked on purpose. Absent on every other row.
   */
  final?: boolean
  /**
   * Which filing of this row this result came from: 1 for the first run, +1 on
   * every Retry that re-files it. Absent on rows from before it was counted,
   * which read as 1 (see `attemptOf`).
   */
  attempt?: number
}

/** A row's filing attempt — absent counts as the first. */
export const attemptOf = (row: { attempt?: number | null }): number =>
  typeof row.attempt === 'number' && row.attempt > 0 ? row.attempt : 1

/** Why rows will not be claimed — shown before anything runs. */
export interface BulkSpfBucketCounts {
  /** Rows that will be filed. */
  claimable: number
  /** The sheet's own "Ticket No" column already names a ticket. */
  alreadyClaimed: number
  /** No POB ID on the row — AJIO searches a return under its POB. */
  missingPob: number
  /** The upload slot is neither NDR nor DDR. */
  unknownType: number
  /** No AJIO login on this machine lists the row's POB (Monitor → Sync POBs). */
  noAccount: number
  /** Claimable, but left unticked in the Selected Proceed review. */
  notSelected: number
  /** The same return and article as an earlier sheet row — filed once, under that row. */
  duplicate: number
  /** A sheet row with something in it but no return number or return AWB. */
  noReturnNumber: number
}

/**
 * One sheet row, sorted, for the Selected Proceed review — before anything is
 * filed. Claimable rows can be ticked; the rest carry why they would be skipped.
 */
export interface BulkSpfPlanRow {
  /**
   * `claimType::awb::sku` — what Submit sends back to say "file these". The
   * claim type is part of it because the same article can be in both sheets.
   */
  key: string
  awb: string
  sku: string
  claimType: string
  pobid: string
  /** The AJIO login that will file it. Empty when it will not be filed. */
  account: string
  claimable: boolean
  /** Why it will not be filed. Empty when claimable. */
  reason: string
}

export interface BulkSpfPlan {
  rows: BulkSpfPlanRow[]
  buckets: BulkSpfBucketCounts
}

/** A bulk-claim job as TrackVid keeps it (`scriptjobs`, jobType AJIO_BULK_CLAIM). */
export interface BulkJobSummary {
  jobId: string
  /** STALE: TrackVid stopped hearing from the run — the app was closed or asleep. */
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'STALE'
  startedAt: string
  finishedAt: string | null
  totalAwbs: number
  processedAwbs: number
  successCount: number
  failedCount: number
  skippedCount: number
  fileNames: string[]
  accounts: string[]
  error: string | null
}

export interface BulkJobPage {
  jobs: BulkJobSummary[]
  total: number
  page: number
  limit: number
}

/** An AWB a job did not file — failed, not claimable, or skipped before filing. */
export interface BulkJobFailedAwb {
  awb: string
  sku: string
  claimType: string
  pobid: string
  result: string
  error: string
  ticketNumber: string
  /** Which filing of the row — see BulkSpfResultRow.attempt. Absent on jobs TrackVid recorded before it. */
  attempt?: number
}

export interface BulkJobDetail extends BulkJobSummary {
  failedAwbs: BulkJobFailedAwb[]
}

/** A filed claim, as this machine keeps it. */
export interface BulkJobTicket {
  awb: string
  sku: string
  ticketId: string
  /** The filing that raised it — absent on archives from before it was kept. */
  attempt?: number
}

/** An article that was not filed, as this machine keeps it. */
export interface BulkJobUnfiled {
  awb: string
  sku: string
  result: string
  reason: string
  /** The filing that ended this way — absent on archives from before it was kept. */
  attempt?: number
}

/**
 * A finished job's tickets, kept on THIS machine (userData) — the ticket data
 * TrackVid does not hold. A job run on another operator's machine has none here.
 */
export interface BulkJobArchive {
  jobId: string
  status: 'done' | 'failed'
  startedAt: string
  finishedAt: string | null
  error: string | null
  accounts: string[]
  fileNames: string[]
  inputAwbs: number
  claimRows: number
  summary: BulkSpfSummary
  tickets: BulkJobTicket[]
  unfiled: BulkJobUnfiled[]
}

/**
 * One job's report, as History shows it — the same message the bulk claim posts:
 * input and row counts, the outcome line, and the Failed / Help Center Failed list.
 */
export interface BulkJobReport {
  jobId: string
  status: BulkJobSummary['status']
  startedAt: string
  finishedAt: string | null
  /** Distinct return numbers in the uploads. Null when only TrackVid's copy was available. */
  inputAwbs: number | null
  claimRows: number
  success: number
  failed: number
  notClaimable: number
  skipped: number
  pending: number
  /** Failed and Help Center Failed rows, first 20 — the rest are in the .xlsx. */
  failedLines: { awb: string; sku: string; result: string; reason: string }[]
  failedTotal: number
  /**
   * Where the ticket data came from. `trackvid`: this machine did not run the
   * job, so the report's Success sheet cannot list tickets.
   */
  source: 'local' | 'trackvid'
}

export interface BulkSpfSummary {
  total: number
  success: number
  failed: number
  helpCenterFailed: number
  notClaimable: number
  dryRun: number
  skipped: number
  pending: number
}

export type BulkSpfStatus = 'preparing' | 'running' | 'done' | 'failed'

export interface BulkSpfRun {
  /** Also the job id TrackVid keeps this run's history under. */
  id: string
  /**
   * Whether TrackVid has the job. False when the create call failed — the run
   * still files, it just will not appear in History.
   */
  jobRecorded: boolean
  status: BulkSpfStatus
  startedAt: string
  finishedAt: string | null
  uploads: BulkSpfUpload[]
  buckets: BulkSpfBucketCounts
  /** How many articles will actually be attempted. */
  claimable: number
  /** How many have been attempted so far. */
  done: number
  summary: BulkSpfSummary
  rows: BulkSpfResultRow[]
  /** The results workbook, rewritten after every article. */
  reportPath: string | null
  accounts: string[]
  error: string | null
  /**
   * How many times this run has filed: 1 for the first pass, +1 per "Retry
   * failed". A retry re-files into THIS run, so `rows` and `summary` are always
   * the combined outcome of every attempt. Absent on runs saved before retries.
   */
  attempts?: number
  /** Rows the current (or last) retry re-filed. Absent until the first retry. */
  retrying?: number
}

/**
 * What a POB fill did to one sheet.
 *
 * `fromBackup` and `fromAjio` are reported separately because they mean
 * different things to an operator: a sheet answered entirely from the backup
 * cost nothing and took a second, while one that needed AJIO opened a browser
 * per account — and a run that found everything live is a hint that the report
 * sync has not been running.
 */
export interface PobFillSummary {
  total: number
  filled: number
  fromBackup: number
  fromAjio: number
  missing: number
  /** The filled copy, written beside the original. */
  outputPath: string
}
