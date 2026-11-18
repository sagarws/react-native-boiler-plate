/**
 * Flipkart master data, kept on this machine.
 *
 * TWO REPORTS, ASKED FOR AND COLLECTED LATER — Snapdeal's shape, AJIO's pair.
 * Flipkart's Report Centre answers `submitReport` with a request id and an ETA,
 * builds the file server-side, and lists it as `FILE_STORED` once it can be
 * downloaded. So, like the Snapdeal backup, this tracks two things:
 *
 *   1. WHAT WAS ASKED FOR  — the requests, their windows and their state.
 *   2. WHAT CAME BACK      — the rows, one table per report.
 *
 * ONLY THE COLUMNS A CLAIM NEEDS. The Orders report is 39 columns and the
 * Returns report 30; Create Claim needs four facts from them — the order item
 * id, the SKU, the forward AWB and the return AWB. Everything else is left in
 * the downloaded file, which is not kept.
 *
 * THE ORDER ITEM ID JOINS THE TWO. A return row carries the return AWB, the
 * order item id and the SKU; the forward AWB is on the Orders row with the same
 * order item id. That join is what turns a typed return AWB into the rest of
 * the claim.
 */

/** Which Flipkart report: Orders (forward) or Returns. */
export type FlipkartReport = 'forward' | 'return'

export const FLIPKART_REPORTS: readonly FlipkartReport[] = ['forward', 'return']

/** How a request to Flipkart is going. */
export type FlipkartRequestStatus =
  /** Sent; Flipkart is building it. */
  | 'requested'
  /** Downloaded, parsed and stored. */
  | 'stored'
  /** Refused, failed at Flipkart, or never appeared on the list. `error` says which. */
  | 'failed'

/** One window asked of Flipkart for one report and one account. */
export interface FlipkartRequest {
  /** Ours, stable for the row's life. */
  id: string
  /** Flipkart's `request_id` — what the list row is matched on. Null if refused. */
  requestId: string | null
  username: string
  report: FlipkartReport
  /** The window asked for, inclusive, `yyyy-MM-dd`. */
  from: string
  to: string
  status: FlipkartRequestStatus
  requestedAt: string
  storedAt: string | null
  /** Rows in the file that carried an order item id. */
  rows: number
  /** Rows that were new to, or filled in on, this machine. */
  added: number
  error: string | null
  /**
   * How many times this window has been asked for. Absent on rows written
   * before it was counted, which read as one — see `attemptsOf`.
   */
  attempts?: number
}

/**
 * One stored row of either report.
 *
 * `awb` is the forward AWB (`delivery_tracking_id`) on a forward row and the
 * return AWB (`reverse_logistics_tracking_id`) on a return row.
 */
export interface FlipkartRecord {
  /** See `flipkartKey` in shared/utils/flipkartRows — what a re-download deduplicates on. */
  key: string
  username: string
  orderItemId: string
  sku: string
  awb: string
  /** Order date (forward) or return requested date (return), `yyyy-MM-dd`. */
  date: string
  savedAt: string
  /** The `id` of the request row that brought this one. */
  requestId: string | null
}

/** What the backup holds for one report. */
export interface FlipkartReportCoverage {
  report: FlipkartReport
  rows: number
  /** Earliest and latest row date held, `yyyy-MM-dd`. */
  from: string | null
  to: string | null
}

/** The status line under the schedule task. */
export interface FlipkartBackupState {
  reports: FlipkartReportCoverage[]
  /** Requests sent and not yet stored. */
  outstanding: number
  lastRunAt: string | null
  lastStoredAt: string | null
}

/** The card's own settings. */
export interface FlipkartBackupSettings {
  /** When the scheduled task last ran, whatever it did. */
  lastRunAt: string | null
  lastStoredAt: string | null
  /** The account the Settings card requests for. */
  username?: string
  /** Per account and report, the last day any stored request covered. */
  coveredToByAccount?: Record<string, Partial<Record<FlipkartReport, string>>>
}

/** What one account's pass did, both reports together. */
export interface FlipkartAccountResult {
  username: string
  /** Windows sent to Flipkart. */
  sent: number
  /** Windows skipped because a request already covers them. */
  skipped: number
  /** Requests downloaded and stored this pass. */
  stored: number
  /** Rows new to this machine, or filled in. */
  added: number
  /** Requests Flipkart is still building. */
  pending: number
  failed: number
  error: string | null
}

/** One month a report holds rows for. */
export interface FlipkartMonthCoverage {
  year: number
  /** 1–12. */
  month: number
  rows: number
}

/** What one report HOLDS — the card's green chips, the coverage calendar and the viewer's months. */
export interface FlipkartCoverage {
  report: FlipkartReport
  /** Newest first. */
  months: FlipkartMonthCoverage[]
  days: { date: string; rows: number }[]
  rows: number
  /** The stored rows' size on disk, roughly. */
  bytes: number
}

/** One day on the request calendar, painted by the furthest any request covering it got. */
export interface FlipkartRequestDay {
  date: string
  status: FlipkartRequestStatus
}

/** The request calendar for one report: the days asked for, and the requests themselves. */
export interface FlipkartRequestCoverage {
  report: FlipkartReport
  days: FlipkartRequestDay[]
  /** Newest first. */
  requests: FlipkartRequest[]
  /** Requests sent and not yet stored — what a collect would chase. */
  outstanding: number
}

/** The card's own settings, as the renderer sees them. */
export interface FlipkartCardState {
  /** The account the card requests for. Empty until one is chosen. */
  username: string
  lastRunAt: string | null
  lastStoredAt: string | null
}

/** Create Claim's answer for one AWB, both reports joined. */
export interface FlipkartAwbMatch {
  returnAwb: string | null
  forwardAwb: string | null
  orderItemId: string
  sku: string | null
  /** The account whose report held it. */
  username: string
}
