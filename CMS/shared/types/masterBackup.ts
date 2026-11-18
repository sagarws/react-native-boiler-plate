import type { ReportType } from '@shared/types/masterDataReport'

/**
 * AJIO master data, kept on this machine.
 *
 * AJIO's reports are a live window: ask for August and you get August, ask
 * again in six months and you may not. The claims this app files are argued
 * from those rows — a POB, an EAN, the date a return was created — so once a
 * month has passed, the only durable copy is the one taken here.
 *
 * STORED MONTH BY MONTH, PAGE BY PAGE. Each record carries the year, month and
 * page it arrived in, so what is held locally can be read back in exactly the
 * shape AJIO served it, and a gap is visible as a missing page rather than as
 * rows that quietly are not there.
 *
 * IDENTITY IS AWB + EAN. One AWB can carry several articles, so neither alone
 * identifies a row; together they do, and that pair is what a re-sync skips on.
 */

export type BackupReport = ReportType

/** One stored row: everything AJIO returned, plus where it came from. */
export interface BackupRecord {
  /** `${awb}|${ean}` — what a re-sync deduplicates on. */
  key: string
  awb: string
  ean: string
  /** The row's own date (order date, or return create date), `yyyy-MM-dd`. */
  date: string
  year: number
  /** 1–12, as a person says it. */
  month: number
  /** Zero-based, as AJIO pages. */
  page: number
  savedAt: string
  /** Every field AJIO returned, untouched. */
  row: Record<string, unknown>
}

/** What is held for one month. */
export interface MonthCoverage {
  year: number
  month: number
  rows: number
  pages: number
  lastSyncedAt: string
  /**
   * The size of this month's file on disk.
   *
   * Measured, not estimated from a row count: the question behind it is whether
   * a year of AJIO fits on an operator's laptop, and the answer is the bytes
   * the JSON actually takes. 0 when the file cannot be read.
   */
  bytes: number
}

/** What is held for one day — the calendar's green. */
export interface DayCoverage {
  date: string
  rows: number
}

export interface BackupCoverage {
  report: BackupReport
  months: MonthCoverage[]
  days: DayCoverage[]
  rows: number
  /** Every month's file added up — what this report costs on this machine. */
  bytes: number
}

/**
 * How far a backup has got. Pushed while it runs.
 *
 * TWO SCALES, because a backup has two. One month is a walk through pages and
 * the page count is the whole story; four months is a walk through months, and
 * a bar that only moved with pages would restart four times and never say how
 * much of the RUN was left. So both are here, and the card shows the months
 * only when there is more than one.
 */
/**
 * One month of a running backup, as the card draws it.
 *
 * Every selected month is read at the same time, so there is no single "current
 * month" to report — and an aggregate bar over all of them hides the one thing
 * an operator wants to see, which is whether a particular month is moving. So
 * each gets its own line.
 */
export interface BackupMonthProgress {
  /** "January 2026". */
  label: string
  /** 1-based; 0 before its first page comes back. */
  page: number
  /** 0 until AJIO says how many there are. Restarts with each window. */
  totalPages: number
  /**
   * Days of this month already read, and how many it has.
   *
   * THE ONLY HONEST PROGRESS ONCE A MONTH IS READ IN PIECES. AJIO caps a window
   * at 100 pages, so a busy month is split and re-split — and the page number
   * restarts every time, which made the bar jump backwards repeatedly and left
   * an operator unable to tell a run that was progressing from one that was
   * looping. Days only ever increase, and they are what the coverage calendar
   * shows anyway.
   */
  daysDone: number
  daysTotal: number
  added: number
  skipped: number
  failed: number
  done: boolean
  /**
   * What AJIO says the month holds, when it says at all.
   *
   * Null means the field was absent — "unknown", which is not "none".
   */
  totalElements: number | null
  /**
   * The month stopped because AJIO would serve no more, not because it ran out.
   *
   * AJIO answers `totalPages: 100` for every month, and 100 pages of 100 rows is
   * exactly the 10,000-row result window. A month with more than that reads to
   * the end of page 100, reports itself complete, and is short — silently, with
   * a full green bar. Set when the rows served fall short of `totalElements`.
   */
  truncated: boolean
}

export interface BackupProgress {
  /** The run this belongs to — the same id the Jobs page lists it under. */
  jobId: string | null
  /** Every month in the run, in calendar order, each with its own progress. */
  months: BackupMonthProgress[]
  report: BackupReport
  /** The window being read, in words: "September 2026", or a date range. */
  label: string
  /** 1-based position of the month being read; 0 before the first one starts. */
  month: number
  totalMonths: number
  page: number
  totalPages: number
  added: number
  skipped: number
  failed: number
  running: boolean
  message: string | null
}

/**
 * A run that has ended, pushed once.
 *
 * Separate from progress because the card has to say so whether or not anyone
 * was watching: the backup runs in the background, and the window that started
 * it may have moved on to another page by the time it finishes.
 */
export interface BackupFinished extends BackupSummary {
  jobId: string
  /** What was backed up, in words — for the toast and the card's last line. */
  label: string
  /**
   * How the run started.
   *
   * The card announces the runs nobody is waiting on — the background backup
   * and the nightly re-sync — and stays quiet for a calendar range, which the
   * dialog that started it reports itself. Two toasts for one press reads as a
   * bug even when both are true.
   */
  kind: BackupJobArchive['kind']
}

/** What starting a backup hands back: it runs on, the operator does not wait. */
export interface BackupStart {
  jobId: string
  months: number
  label: string
}

/** One month of a finished run, as the Jobs page shows it. */
export interface BackupJobMonth {
  year: number
  month: number
  added: number
  skipped: number
  failed: number
}

/**
 * A finished backup, kept on this machine.
 *
 * The rows themselves are the point of the run and they are already stored, so
 * this holds only what the rows cannot answer afterwards: which report, which
 * range, how much arrived and how much was already held. That is deliberately
 * all the Jobs page shows for this kind — there is no spreadsheet to download,
 * because the data went into the backup rather than into a report.
 */
export interface BackupJobArchive {
  jobId: string
  report: BackupReport
  username: string
  /** How the range was asked for: whole months, a calendar range, or the daily job. */
  kind: 'months' | 'range' | 'daily'
  /** The dates actually read, `yyyy-MM-dd`. */
  from: string
  to: string
  startedAt: string
  finishedAt: string
  status: 'done' | 'failed'
  months: BackupJobMonth[]
  added: number
  skipped: number
  failed: number
  error: string | null
}

export interface BackupSummary {
  report: BackupReport
  /** The AJIO account it read as — set by the scheduled run, which reads every account. */
  username?: string
  added: number
  /** Rows AJIO returned that were already held, by AWB + EAN. */
  skipped: number
  failed: number
  months: number
  error: string | null
}

/**
 * When one report last landed rows on this machine.
 *
 * PER REPORT, because forward and return are separate runs against separate
 * endpoints and either can fail on its own. `lastSyncedDate` is whichever of
 * the two wrote last, so it cannot say that the return report has not synced
 * for a week while the forward one ran an hour ago — which is the one thing
 * the Automation schedule row has to be able to say.
 */
export interface ReportSyncStamp {
  /** When the sync finished, ISO. */
  at: string
  /** The last date its window covered, `yyyy-MM-dd`. */
  coveredTo: string
}

/** The card's own settings, kept on this machine. */
export interface BackupSettings {
  /** The AJIO account the backup reads from. */
  username: string
  /** `HH:mm`, or null when the daily re-sync is off. */
  dailyTime: string | null
  /** When the daily re-sync last ran, whatever it found. */
  lastRunAt: string | null
  /** The last date covered by any sync — where "sync since last" starts. */
  lastSyncedDate: string | null
  /**
   * The same, per report. Empty on a machine that has never synced, and
   * missing one key on a machine that has only ever synced the other.
   */
  lastSyncByReport: Partial<Record<BackupReport, ReportSyncStamp>>
  /**
   * The same again, per AJIO ACCOUNT — where the scheduled run, which reads
   * every account, continues each one from. Missing on a machine that has
   * not run it yet.
   */
  lastSyncByAccount?: Record<string, Partial<Record<BackupReport, ReportSyncStamp>>>
  /** Set once the one-time repair of rows filed under the wrong month has run (`refileLaterRows`). */
  laterRowsRefiled?: boolean
}

/**
 * Taking the backup off this machine, and putting it back.
 *
 * One zip, laid out the way the data is: `{year}/{month}/{page}.xlsx`, a
 * hundred rows a file, plus a manifest naming the report. Import merges through
 * the same AWB + EAN skip a sync uses, so a zip that overlaps what is held
 * costs nothing and duplicates nothing.
 */
export interface BackupExportSummary {
  report: BackupReport
  /** Where it was written — named in the toast, so it can be found. */
  path: string
  /** Spreadsheets in the zip: one per page, per month. */
  files: number
  rows: number
  months: number
  bytes: number
}

export interface BackupImportSummary {
  report: BackupReport
  path: string
  added: number
  /** Rows the machine already held, by AWB + EAN. */
  skipped: number
  /** Files that could not be read. The rest still imported. */
  failed: number
  months: number
}

/** Everything held for one report, deleted. */
export interface BackupEraseSummary {
  report: BackupReport
  removed: number
}

/** One row the search found, and which report it was in. */
export interface BackupSearchHit extends BackupRecord {
  report: BackupReport
}

export interface BackupSearchResult {
  term: string
  hits: BackupSearchHit[]
  /** True when the cap was reached and there may be more. */
  capped: boolean
}

/**
 * A list of AWBs looked up at once — what was found, and what was not.
 *
 * The MISSING half is the point. Checking fifteen numbers against the backup
 * one at a time is fifteen searches and a memory of which ones came back empty;
 * asked together, the answer to "which of these do we not hold" is a list
 * rather than a recollection.
 */
export interface BackupLookupResult {
  hits: BackupSearchHit[]
  /** The numbers as pasted, upper-cased, that matched a stored row. */
  found: string[]
  /** The ones nothing is held for. */
  missing: string[]
}
