/**
 * Snapdeal master data, kept on this machine.
 *
 * SAME PURPOSE AS THE AJIO BACKUP, A DIFFERENT SHAPE OF PORTAL. AJIO answers a
 * report request with the rows; Snapdeal answers with a PROMISE — a requestId
 * and a report that builds server-side for minutes. So the thing this feature
 * tracks is not one list but two:
 *
 *   1. WHAT WAS ASKED FOR  — the requests, their windows and their state.
 *   2. WHAT CAME BACK      — the rows, stored month by month.
 *
 * They are separate because they fail separately. A night where no request was
 * sent and a night where every request was sent and none has finished building
 * look identical from the rows alone, and only one of them is a problem that
 * fixes itself. That is why there are two coverage views.
 *
 * IDENTITY IS SUB-ORDER + REVERSE AWB. Snapdeal serves the same sub-order more
 * than once — one row as the return was raised, carrying no forward AWB, and
 * another once it was delivered, carrying one. 422 rows of a real report were
 * 331 returns. The pair is what a re-download deduplicates on, and the row that
 * carries a forward AWB is the one that wins (see `mergeRecord`).
 */

/**
 * Which Snapdeal report. One today — "Return Acknowledged", the dropship
 * return report the claims are argued from — named rather than assumed so a
 * second one is an entry here and not a new store.
 */
export type SnapdealReport = 'return'

/** How a request to Snapdeal is going. */
export type SnapdealRequestStatus =
  /** Sent; Snapdeal is building it. */
  | 'requested'
  /** The reports list shows it complete — there is a file to fetch. */
  | 'ready'
  /** Downloaded, parsed and stored. The only status that means rows are held. */
  | 'stored'
  /** Snapdeal refused it, or it could not be fetched. `error` says which. */
  | 'failed'

/**
 * One window asked of Snapdeal.
 *
 * THE REQUEST IS THE RECORD, not the file. A report that was asked for and
 * never arrived has to be visible as exactly that — otherwise the only trace
 * of a week of failed nights is an absence of rows, which reads as a week with
 * no returns.
 */
export interface SnapdealRequest {
  /** Ours, stable for the row's life. */
  id: string
  /**
   * Snapdeal's own id, from `generateReport`.
   *
   * KEPT, BUT IT CANNOT FETCH THE FILE. The reports list carries no id of any
   * kind — see `resolveRequest` — so this is a receipt an operator can quote
   * to Snapdeal, not a handle this app can download with. Null when the portal
   * did not return one.
   */
  requestId: string | null
  username: string
  report: SnapdealReport
  /** The window asked for, inclusive, `yyyy-MM-dd`. */
  from: string
  to: string
  status: SnapdealRequestStatus
  requestedAt: string
  /** When the list first showed it complete. */
  readyAt: string | null
  /** When its rows landed on this machine. */
  storedAt: string | null
  /**
   * The download token off the completed list row.
   *
   * Snapdeal builds the URL as `/report/download/{subArea}/{code}`, and `code`
   * is null until the report finishes — which is how "ready" is told from
   * "still building".
   */
  code: string | null
  subArea: string | null
  /**
   * What Snapdeal called the file — and the only thing that says which window
   * it holds. `S7aea7_DROPSHIP_RTN_CREATED_05092026_03102026.csv` is the 5th of
   * September to the 3rd of October, which is what makes a download matchable
   * to the request that asked for it.
   */
  filename: string | null
  /** Rows in the file. */
  rows: number
  /** Rows that were new to this machine. */
  added: number
  /** How many times this window has been asked for. */
  attempts: number
  error: string | null
}

/**
 * One stored return.
 *
 * FOUR FIELDS AND A DATE, not the whole row. Snapdeal's report is 41 columns
 * wide and most of them are product copy and image URLs; the claims are argued
 * from the sub-order, the two AWBs and the SKU. AJIO's backup keeps every
 * column because its rows are the claim evidence itself — these are a lookup
 * table, and keeping the other 36 columns would cost an operator's disk for
 * nothing.
 */
export interface SnapdealRecord {
  /** `${subOrderCode}|${reverseAwb}` — what a re-download deduplicates on. */
  key: string
  subOrderCode: string
  /** The FORWARD AWB. Empty when Snapdeal served "NA" on every row for it. */
  awb: string
  reverseAwb: string
  sku: string
  /** `RETURNINITIATEDON`, as `yyyy-MM-dd` — the day this return was raised. */
  date: string
  year: number
  /**
   * 1–12, as a person says it.
   *
   * CARRIED ON THE ROW, not expressed as the file it lives in. Every return is
   * in one table; the year and month are what the coverage calendar is built
   * from and what the viewer filters on.
   */
  month: number
  savedAt: string
  /**
   * The `id` of the row in `snapdeal-backup-requests` that brought this one —
   * a foreign key, not Snapdeal's portal number.
   *
   * THIS IS WHAT REPLACED THE MONTH IN THE FILENAME. "Which window did this
   * come from" used to be answered by which file a row sat in; it is now a
   * join against a table that also knows the window, the portal `requestId`,
   * the account and whether the download succeeded. Snapdeal's own number is
   * deliberately not stored here: it is one hop away, and it is null whenever
   * the portal did not return one, so a row keyed on it could not be traced.
   *
   * Null only for a row written before this reference existed.
   */
  requestId: string | null
}

/** What is held for one month. */
export interface SnapdealMonthCoverage {
  year: number
  month: number
  rows: number
  lastStoredAt: string
  /** The month file's real size on disk. 0 when it cannot be read. */
  bytes: number
}

/** What is held for one day — the data calendar's green. */
export interface SnapdealDayCoverage {
  date: string
  rows: number
}

export interface SnapdealCoverage {
  report: SnapdealReport
  months: SnapdealMonthCoverage[]
  days: SnapdealDayCoverage[]
  rows: number
  bytes: number
}

/**
 * What was ASKED FOR, day by day — the request calendar.
 *
 * A day is coloured by the furthest its requests got, not by the last one
 * recorded: a day covered by a stored request and a failed one is covered, and
 * showing it red because a retry failed would send somebody re-requesting data
 * they already hold.
 */
export interface SnapdealRequestDay {
  date: string
  status: SnapdealRequestStatus
}

export interface SnapdealRequestCoverage {
  report: SnapdealReport
  days: SnapdealRequestDay[]
  requests: SnapdealRequest[]
  /** Requests sent and not yet stored — what a collect pass would chase. */
  outstanding: number
}

/** The card's own settings. */
export interface SnapdealBackupSettings {
  /** The Snapdeal account reports are asked of. */
  username: string
  /** When the scheduled task last ran, whatever it did. */
  lastRunAt: string | null
  /** The last day any stored request covered, `yyyy-MM-dd`. */
  coveredTo: string | null
  /**
   * The same, per Snapdeal ACCOUNT — where the scheduled run, which reads every
   * account, continues each one from. Missing until it has stored something.
   */
  coveredToByAccount?: Record<string, string>
  /**
   * Per account, the download tokens (`code`) of every file already fetched
   * from Snapdeal's reports list — stored, or opened and found to be nobody's.
   * The list keeps old files for weeks; without this every pass downloaded all
   * of them again only to discard them.
   */
  downloadedByAccount?: Record<string, string[]>
  lastStoredAt: string | null
}

/** What a request pass did. */
export interface SnapdealRequestSummary {
  report: SnapdealReport
  /** Windows sent to Snapdeal. */
  sent: number
  /** Windows skipped because a request already covers them. */
  skipped: number
  failed: number
  /** Human labels for what was sent, for the toast. */
  windows: string[]
  error: string | null
}

/** What a collect pass did. */
export interface SnapdealCollectSummary {
  report: SnapdealReport
  /** Requests that were downloaded and stored this pass. */
  stored: number
  /** Rows written that this machine did not already hold. */
  added: number
  /** Rows already held. */
  skipped: number
  /** Requests Snapdeal is still building. */
  pending: number
  failed: number
  error: string | null
}

/** One collect or request run, as it goes. */
export interface SnapdealProgress {
  jobId: string
  report: SnapdealReport
  /** What it is doing right now, in words. */
  message: string
  /** Requests handled, of how many. */
  done: number
  total: number
  running: boolean
}

/** Pushed once when a run ends. */
export interface SnapdealFinished {
  jobId: string
  report: SnapdealReport
  kind: SnapdealJobKind
  label: string
  sent: number
  stored: number
  added: number
  pending: number
  failed: number
  error: string | null
}

/** How a run was started. */
export type SnapdealJobKind =
  /** Whole months, chosen on the card. */
  | 'months'
  /** A date range, from the request calendar. */
  | 'range'
  /** The scheduled pass: request what is missing, collect what is ready. */
  | 'daily'
  /** Collect only — chasing requests already sent. */
  | 'collect'

/** One finished run, kept on this machine so Jobs can show it. */
export interface SnapdealJobArchive {
  jobId: string
  report: SnapdealReport
  username: string
  kind: SnapdealJobKind
  from: string
  to: string
  startedAt: string
  finishedAt: string
  status: 'done' | 'failed'
  sent: number
  stored: number
  added: number
  skipped: number
  pending: number
  failed: number
  error: string | null
}
