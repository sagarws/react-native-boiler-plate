/**
 * The Nykaa DDR bulk claim.
 *
 * DDR — Delivery Disputes Returns: Nykaa shows the return (RTO or DTO) as
 * delivered back to the seller, and the seller never received it. On Nykaa's
 * dispute portal that is the issue "Delivered but Not Received".
 *
 * An operator uploads one spreadsheet. Each row carries the Vendor Code, SKU
 * ID, Return AWB and Return Type (RTO / DTO); the issue is always "Delivered
 * but Not Received" and the subject is the same as AJIO's DDR claim. No
 * evidence URL is sent. One Nykaa session per account, not one per claim.
 */

/** The Nykaa portal's "Issue" dropdown value every row is raised with. */
export const NYKAA_DDR_ISSUE = 'Delivered but Not Received'

export const NYKAA_RETURN_TYPES = ['RTO', 'DTO'] as const

export type NykaaReturnType = (typeof NYKAA_RETURN_TYPES)[number]

export interface NykaaDdrUpload {
  /** Absolute path on this machine — chosen through a native dialog. */
  filePath: string
  fileName: string
  /** Rows read from the sheet, for the modal's "12 rows" line before submitting. */
  rowCount: number
}

/**
 * What happened to one row.
 *
 * `Already Filed`: Nykaa already has a ticket for that return AWB, so none was
 * raised — the existing ticket's number is reported instead.
 */
export type NykaaDdrOutcome = 'Success' | 'Already Filed' | 'Failed' | 'Dry Run' | 'Skipped' | 'Pending'

export interface NykaaDdrResultRow {
  /** 1-based row number in the uploaded sheet. */
  sheetRow: number
  awb: string
  sku: string
  vendorCode: string
  returnType: string
  /** The Nykaa login that filed (or would have filed) it. Empty when none. */
  account: string
  result: NykaaDdrOutcome
  /** Why it was skipped, or how it failed. */
  reason: string
  ticketNumber: string
  timestamp: string
  /** Which filing of this row: 1 for the first run, +1 per Retry. */
  attempt: number
  /**
   * A skip no retry can change — a repeat of an earlier sheet row. Retry
   * leaves it alone.
   */
  final?: boolean
}

/** Why rows will not be filed — shown before anything runs. */
export interface NykaaDdrBucketCounts {
  claimable: number
  missingAwb: number
  missingSku: number
  /** Return Type is not RTO or DTO. */
  badReturnType: number
  /** No Nykaa login on this machine matches the row's vendor code. */
  noAccount: number
  /** The same AWB and SKU as an earlier sheet row. */
  duplicate: number
}

export interface NykaaDdrSummary {
  total: number
  success: number
  alreadyFiled: number
  failed: number
  dryRun: number
  skipped: number
  pending: number
}

export type NykaaDdrStatus = 'running' | 'done' | 'failed'

export interface NykaaDdrRun {
  id: string
  status: NykaaDdrStatus
  startedAt: string
  finishedAt: string | null
  upload: NykaaDdrUpload
  buckets: NykaaDdrBucketCounts
  /** Rows being filed in this pass — progress is measured against it. */
  claimable: number
  /** Rows of this pass that have an outcome. */
  done: number
  summary: NykaaDdrSummary
  rows: NykaaDdrResultRow[]
  /** The results workbook, rewritten after every row. */
  reportPath: string | null
  accounts: string[]
  error: string | null
  /** 1 for the first pass, +1 per Retry — rows and summary are always the combined result. */
  attempts: number
}

/**
 * Rows a Retry files again: anything without a ticket that a retry could
 * change — failed, skipped for a fixable reason, or held by a disabled submit.
 */
export const isNykaaDdrRetryable = (row: NykaaDdrResultRow): boolean =>
  !row.final && (row.result === 'Failed' || row.result === 'Skipped' || row.result === 'Dry Run')
