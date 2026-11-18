import { randomUUID } from 'node:crypto'
import { MASTER_BACKUP_EVENTS } from '@shared/constants/channels'
import type {
  BackupCoverage,
  BackupLookupResult,
  BackupSearchResult,
  BackupFinished,
  BackupMonthProgress,
  BackupJobArchive,
  BackupJobMonth,
  BackupProgress,
  BackupRecord,
  BackupReport,
  BackupSettings,
  BackupStart,
  BackupSummary
} from '@shared/types/masterBackup'
import type { ReportPage } from '@shared/types/masterDataReport'
import { fail, ok, type Result } from '@shared/types/result'
import {
  monthsBetween,
  halveWindow,
  monthWindow,
  windowDays,
  recordKey,
  rowDate,
  ymd
} from '@shared/utils/backupRows'
import { broadcast } from '../ipc/broadcast'
import { readReportPage } from './masterDataReport.service'
import { closeClaimLease, openClaimLease } from './browserLease.service'
import { withAutomationLock } from './automationLock'
import {
  deleteRange,
  heldKeys,
  lookupRecords,
  searchRecords,
  readBackupSettings,
  recordReportSync,
  readCoverage,
  readMonth,
  saveRecords,
  writeBackupSettings,
  refileLaterRows
} from './masterBackup.store'
import { saveBackupJob } from './masterBackupArchive.store'
import { sessionAccounts } from './liveAccounts'
import { reportSyncFrom } from '@shared/utils/reportSyncWindow'
import { clampToRetention, isRetainedMonth, retentionRefusal } from '@shared/utils/backupRetention'
import { pruneAjioBackup } from './backupRetention.service'
import { logger } from './logger'
import { throwIfStopped } from './automationStop'

/**
 * Backing AJIO's master data up locally.
 *
 * AJIO's reports are a live window, not an archive: ask for August today and
 * you get August; ask in six months and you may get nothing. Every claim this
 * app files is argued from those rows — the POB, the EAN, the date a return was
 * created — so once a month has passed, the only durable copy is the one taken
 * here.
 *
 * READ, SAVE, NOTHING ELSE. It writes to this machine and never back to AJIO,
 * which is why it needs no confirmation step.
 *
 * PAGE BY PAGE, 100 AT A TIME, and each record keeps the year, month and page
 * it arrived in. That is not bookkeeping for its own sake: it is what lets the
 * stored copy be read back in the shape AJIO served it, and what makes a gap
 * visible as a missing page rather than as rows that quietly are not there.
 */

/** How many numbers one paste may carry. Beyond this it is a report, not a look-up. */
const MAX_LOOKUP = 500

/** AJIO's page size for a backup. Its own reports page at a hundred. */
const PAGE_SIZE = 100

/**
 * The most pages AJIO will serve for ONE window, whatever the window holds.
 *
 * Observed: every month asked for whole answers exactly 100, while a five-day
 * window answers 40. 100 pages at PAGE_SIZE is the 10,000-row result window
 * these APIs usually carry. Treated as a ceiling to split at, not a limit to
 * respect — see `backupMonthInWindows`.
 */
const MAX_WINDOW_PAGES = 100

/** How far back the daily re-sync reaches. */
const DAILY_LOOKBACK_DAYS = 2

const pad = (value: number): string => String(value).padStart(2, '0')
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const toRecord = (
  row: Record<string, unknown>,
  year: number,
  month: number,
  page: number
): BackupRecord => {
  const awb = text(row.awbNumber) || text(row.returnAwbNo)
  const ean = text(row.ean)

  return {
    key: recordKey(awb, ean),
    awb,
    ean,
    date: rowDate(row) || `${year}-${pad(month)}-01`,
    year,
    month,
    page,
    savedAt: new Date().toISOString(),
    row
  }
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December'
]

/** "September 2026" — how a person says the month being read. */
const monthLabel = (year: number, month: number): string =>
  `${MONTH_NAMES[month - 1] ?? pad(month)} ${year}`

let running = false

/**
 * One run, as it goes.
 *
 * Totals are on the RUN, not the month: an operator watching four months wants
 * "9,300 saved so far", not a counter that resets every time a month ends.
 */
interface RunState {
  jobId: string
  report: BackupReport
  totalMonths: number
  /** Months finished, whatever order they finished in. */
  done: number
  /**
   * EVERY month of the run, in calendar order, each tracking itself.
   *
   * Not just the ones in flight: a month that has finished still belongs on
   * screen, and one that has not started yet is information too. They are all
   * read at the same time, so there is no "current month" to report and no
   * single bar that would say anything useful about nine of them at once.
   */
  months: BackupMonthProgress[]
  added: number
  skipped: number
  failed: number
}

const publish = (progress: BackupProgress): void => {
  broadcast(MASTER_BACKUP_EVENTS.progress, progress)
}

const publishRun = (state: RunState, running: boolean, message: string | null = null): void => {
  const flying = state.months.filter(month => !month.done && month.page > 0)
  // The aggregate is kept for anything that reads one number — the card draws
  // the months themselves.
  const page = flying.reduce((total, month) => total + month.page, 0)
  const totalPages = flying.reduce((total, month) => total + month.totalPages, 0)
  const label =
    flying.length === 0
      ? ''
      : flying.length === 1
        ? (flying[0]?.label ?? '')
        : `${flying[0]?.label ?? ''} + ${flying.length - 1} more`

  publish({
    jobId: state.jobId,
    report: state.report,
    // A copy: the card holds onto what it is given, and these are mutated in
    // place as the run goes.
    months: state.months.map(month => ({ ...month })),
    label,
    month: state.done,
    totalMonths: state.totalMonths,
    page,
    totalPages,
    added: state.added,
    skipped: state.skipped,
    failed: state.failed,
    running,
    message
  })
}

/** Pushed once when a run ends, so the card can say so even if nobody watched. */
const publishFinished = (finished: BackupFinished): void => {
  broadcast(MASTER_BACKUP_EVENTS.finished, finished)
}

/**
 * Reads one window page by page and saves what is new.
 *
 * Every page is attempted even when one fails: AJIO times a page out often
 * enough that abandoning the month would mean losing the eleven pages that did
 * come back. A failed page is counted and reported, and re-running fills it —
 * which is the whole point of skipping on AWB + EAN rather than on page.
 */
const backupWindow = async (
  state: RunState,
  username: string,
  year: number,
  month: number,
  window: { from: string; to: string },
  label: string
): Promise<{ added: number; skipped: number; failed: number; truncated: boolean }> => {
  const report = state.report
  const before = { added: state.added, skipped: state.skipped, failed: state.failed }
  // This month's own row, created when the run was set up. The run's totals
  // stay on `state` as well — the summary line counts the RUN, the row counts
  // the month.
  const mine = state.months.find(month => month.label === label) ?? {
    label,
    page: 0,
    totalPages: 0,
    added: 0,
    skipped: 0,
    failed: 0,
    done: false,
    totalElements: null,
    truncated: false,
    daysDone: 0,
    daysTotal: windowDays(window)
  }
  /**
   * 0 means NOT YET KNOWN, and it is published as 0.
   *
   * AJIO reports its page count in the body of the first response, so before
   * that there is no total. Starting this at 1 was a lie the bar believed: the
   * first tick said "page 1 of 1", drew 100%, and then jumped back to 6% when
   * the real count arrived.
   */
  let totalPages = 0
  /**
   * Rows AJIO actually SERVED, which is not the same as rows saved.
   *
   * `added` drops anything this machine already held, so it cannot be compared
   * with `totalElements` to tell a truncated month from a re-run of one already
   * backed up.
   */
  let served = 0

  // Read once per month rather than per page: the partition is rewritten by
  // each save, and re-reading it 80 times is the difference between a minute
  // and several.
  const held = await heldKeys(report, year, month)

  for (let page = 0; page === 0 || page < totalPages; page += 1) {
    // Automations switched off: stop before the next page rather than reading
    // the rest of the month unwatched. Thrown, so the run is recorded as stopped
    // and its "synced up to" date is NOT advanced past what was read.
    throwIfStopped(`AJIO ${label}, page ${page + 1}`)

    mine.page = page + 1
    mine.totalPages = totalPages
    publishRun(state, true)

    const answer: Result<ReportPage> = await readReportPage({
      reportType: report,
      username,
      from: window.from,
      to: window.to,
      page,
      size: PAGE_SIZE
    })

    if (!answer.success) {
      mine.failed += 1
      state.failed += 1
      logger.warn(`[ajio-backup] ${label} page ${page + 1}: ${answer.error.message}`)

      // A first page that fails means the window could not be read at all —
      // there is no total to iterate towards, so stop rather than spin.
      if (page === 0) break

      continue
    }

    totalPages = Math.max(1, answer.data.totalPages)
    mine.totalPages = totalPages
    // What AJIO says the window holds. Recorded on the first page that answers
    // and not overwritten with null by a later one that does not.
    if (answer.data.totalElements !== null) mine.totalElements = answer.data.totalElements
    served += answer.data.rows.length

    const records = answer.data.rows
      .map(row => toRecord(row, year, month, page))
      .filter(record => {
        if (held.has(record.key)) {
          mine.skipped += 1
          state.skipped += 1

          return false
        }

        held.add(record.key)

        return true
      })

    const saved = await saveRecords(report, year, month, records)

    mine.added += saved.added
    mine.skipped += saved.skipped
    state.added += saved.added
    state.skipped += saved.skipped
  }

  /**
   * DID AJIO RUN OUT, OR DID IT STOP SERVING?
   *
   * The whole month reads as a success either way: the loop walks to the last
   * page AJIO admits to and the bar fills. But AJIO answers `totalPages: 100`
   * for every month, and 100 pages of 100 rows is exactly the 10,000-row
   * result window — so a month with more than that is short, silently, with
   * nothing on screen to say which days are missing.
   *
   * Only claimed when AJIO gave a count to compare against. Without one this
   * stays false rather than guessing from the page number, because a month that
   * genuinely holds 10,000 rows would be libelled by the guess.
   */
  /**
   * DID AJIO RUN OUT, OR DID IT STOP SERVING?
   *
   * THE PAGE COUNT IS THE ONLY SIGNAL AJIO GIVES. The response carries
   * `pageNumber` and `totalPages` and nothing else — no `totalElements` — so a
   * check against a row total could never fire, which is exactly what happened:
   * the split was written, shipped, and never ran once.
   *
   * `totalPages` is REAL for a window AJIO can serve — a five-day window
   * answers 40 — and pinned at MAX_WINDOW_PAGES for one it cannot. At the
   * 100-row page size above that ceiling is 10,000 rows, and this seller runs
   * about 800 orders a day, so any window wider than about twelve days hits it.
   *
   * So: a window that comes back AT the ceiling is assumed truncated and gets
   * halved. A window genuinely holding exactly 10,000 rows is split once for
   * nothing, which costs a re-read of rows that are then skipped on AWB + EAN.
   * Cheap, and the alternative is the silent hole this is here to close.
   */
  const atCeiling = totalPages >= MAX_WINDOW_PAGES
  const shortOfCount = mine.totalElements !== null && served < mine.totalElements
  const truncated = atCeiling || shortOfCount

  if (truncated) {
    logger.warn(
      `[ajio-backup] ${label} ${window.from}→${window.to}: ` +
        (atCeiling
          ? `AJIO stopped at ${totalPages} pages, its ceiling — the window holds more than it will serve`
          : `AJIO holds ${mine.totalElements?.toLocaleString()} row(s) and served ${served.toLocaleString()}`) +
        ' — narrowing the window.'
    )
  }

  // NOT `mine.done` here. The month is only finished when every window it was
  // split into has been read — see `backupMonthInWindows`, which owns that decision.
  publishRun(state, true)

  return {
    added: state.added - before.added,
    skipped: state.skipped - before.skipped,
    failed: state.failed - before.failed,
    truncated
  }
}

/**
 * One month, read in as many windows as AJIO will actually serve.
 *
 * THE MONTH IS NOT THE UNIT AJIO CAN ANSWER. It serves at most 10,000 rows per
 * window and says `totalPages: 100` regardless, so a busy month reads to the
 * end of page 100 and stops — complete, green, and short. The Forward Report
 * for January 2026 held the 23rd onwards and nothing before it, because AJIO
 * serves newest first and twenty-two days fell off the end.
 *
 * So a window that comes back truncated is halved and both halves are read.
 * Recursion bottoms out at a single day, which cannot be narrowed further — and
 * THAT is the only case still reported as incomplete, because it is the only
 * one this can do nothing about.
 *
 * Duplicates across windows cost nothing: rows are skipped on AWB + EAN, which
 * is what makes re-reading an overlapping range safe.
 */
const backupMonthInWindows = async (
  state: RunState,
  username: string,
  year: number,
  month: number,
  window: { from: string; to: string },
  label: string
): Promise<{ added: number; skipped: number; failed: number }> => {
  const mine = state.months.find(entry => entry.label === label)
  const totals = { added: 0, skipped: 0, failed: 0 }

  const read = async (part: { from: string; to: string }): Promise<void> => {
    const result = await backupWindow(state, username, year, month, part, label)

    totals.added += result.added
    totals.skipped += result.skipped
    totals.failed += result.failed

    // A LEAF, so its days are done. Counted here and not when a window is
    // split, or a month would report the same days twice over — once for the
    // whole window and again for each half of it.
    if (!result.truncated) {
      if (mine) {
        mine.daysDone = Math.min(mine.daysTotal, mine.daysDone + windowDays(part))
        publishRun(state, true)
      }

      return
    }

    const halves = halveWindow(part)

    if (!halves) {
      // A single day AJIO will not finish serving. Nothing here can narrow it
      // further, so it is the one case the operator has to know about.
      if (mine) {
        mine.truncated = true
        // As done as this can get: nothing will read it more completely, and
        // leaving it uncounted would hold the bar short of 100% for ever.
        mine.daysDone = Math.min(mine.daysTotal, mine.daysDone + windowDays(part))
      }

      logger.error(
        `[ajio-backup] ${label}: ${part.from} alone exceeds what AJIO will serve — that day is ` +
          'INCOMPLETE and cannot be split any smaller.'
      )

      return
    }

    logger.info(`[ajio-backup] ${label}: splitting ${part.from}→${part.to} into two`)

    for (const half of halves) await read(half)
  }

  await read(window)

  if (mine) {
    mine.done = true
    mine.daysDone = mine.daysTotal
  }
  state.done += 1
  publishRun(state, true)

  return totals
}

/**
 * Runs a list of windows as ONE job: progress, archive, finished event.
 *
 * Shared by all three ways a backup starts — chosen months, a calendar range,
 * the nightly re-sync — so every run leaves the same record and reports itself
 * the same way. The difference between them is only which windows they hand in.
 */
const runWindows = async (args: {
  jobId: string
  report: BackupReport
  username: string
  kind: BackupJobArchive['kind']
  label: string
  from: string
  to: string
  windows: { year: number; month: number; window: { from: string; to: string }; label: string }[]
}): Promise<BackupSummary> =>
  /**
   * THE LOCK, ONCE, FOR THE WHOLE RUN.
   *
   * It was taken per PAGE before — `reportPage` wraps every read — so nine
   * months reading in parallel queued behind one mutex and came out one request
   * at a time: page 1 of January, page 1 of February, … page 2 of January.
   * Parallel in the code and sequential in the wire, which is exactly what an
   * operator saw.
   *
   * A backup is ONE automation, so it takes the lock once and reads freely
   * inside it. The lease keeps the signed-in page open for the duration rather
   * than opening and closing one per page.
   *
   * The cost is honest: a long backup now holds the browser for its length, and
   * a claim dispatched meanwhile waits. That is what "one automation drives the
   * browser at a time" has always meant — the per-page version only pretended
   * otherwise, by letting other work slip between pages of a run it had already
   * committed to.
   */
  withAutomationLock('ajio-backup', async () => {
    openClaimLease()

    try {
      return await runMonths(args)
    } finally {
      await closeClaimLease()
    }
  })

const runMonths = async (args: {
  jobId: string
  report: BackupReport
  username: string
  kind: BackupJobArchive['kind']
  label: string
  from: string
  to: string
  windows: { year: number; month: number; window: { from: string; to: string }; label: string }[]
}): Promise<BackupSummary> => {
  const startedAt = new Date().toISOString()
  const months: BackupJobMonth[] = []
  const state: RunState = {
    jobId: args.jobId,
    report: args.report,
    totalMonths: args.windows.length,
    done: 0,
    // One row per selected month, in the order they were chosen — which is
    // calendar order, and the order the card draws them in.
    months: args.windows.map(entry => ({
      label: entry.label,
      page: 0,
      totalPages: 0,
      totalElements: null,
      truncated: false,
      daysDone: 0,
      daysTotal: windowDays(entry.window),
      added: 0,
      skipped: 0,
      failed: 0,
      done: false
    })),
    added: 0,
    skipped: 0,
    failed: 0
  }
  let error: string | null = null

  try {
    publishRun(state, true)

    /**
     * ONE BROWSER, OPENED ONCE, BEFORE THE MONTHS START.
     *
     * The months share a signed-in AJIO page, and the lease that holds it is
     * not safe to race: nine callers arriving together with nothing open would
     * each start a browser. So the first page of the first month is read on its
     * own — that opens the session — and everything else then reuses it.
     */
    const first = args.windows[0]

    if (first) {
      await readReportPage({
        reportType: args.report,
        username: args.username,
        from: first.window.from,
        to: first.window.to,
        page: 0,
        size: 1
      })
    }

    /**
     * EVERY MONTH AT ONCE — n months selected is n requests in flight.
     *
     * They are independent: each reads its own date window and writes its own
     * file, so nothing a month does can be undone by its neighbour. Run one
     * after another, seven months of the return report is seven times the wait
     * for no reason — the network sits idle between pages of one month while
     * the next has not started.
     *
     * So they all start together: five months means five page-1 requests at the
     * same moment, then five page-2s, and the backup takes about as long as its
     * slowest month rather than as long as all of them added up.
     *
     * A page AJIO refuses is counted and the month carries on (see
     * `backupWindow`), so if a portal ever objects to the volume it shows up as
     * failed pages to re-run rather than as a lost backup.
     */
    await Promise.all(
      args.windows.map(async entry => {
        const result = await backupMonthInWindows(
          state,
          args.username,
          entry.year,
          entry.month,
          entry.window,
          entry.label
        )

        months.push({ year: entry.year, month: entry.month, ...result })
      })
    )

    // Sorted because they finished in whatever order they finished: the job
    // record reads as a calendar, not as a race result.
    months.sort((a, b) => a.year - b.year || a.month - b.month)

    // Per report as well as overall: the Settings row shows the two separately,
    // because the forward and return reports are separate runs and either can
    // come back empty on its own.
    await recordReportSync({
      report: args.report,
      username: args.username,
      coveredTo: args.to,
      // The scheduled run goes through every account; the card's choice stays.
      keepChosenAccount: args.kind === 'daily'
    })
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'The backup stopped unexpectedly'
    logger.warn(`[ajio-backup] ${args.label} stopped`, caught)
  } finally {
    running = false
  }

  const summary: BackupSummary = {
    report: args.report,
    added: state.added,
    skipped: state.skipped,
    failed: state.failed,
    months: months.length,
    error
  }

  // The record first, then the events: a window that reacts by opening Jobs
  // must find the run already there.
  await saveBackupJob({
    jobId: args.jobId,
    report: args.report,
    username: args.username,
    kind: args.kind,
    from: args.from,
    to: args.to,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: error ? 'failed' : 'done',
    months,
    added: state.added,
    skipped: state.skipped,
    failed: state.failed,
    error
  })

  publishRun(state, false)
  publishFinished({ ...summary, jobId: args.jobId, label: args.label, kind: args.kind })

  logger.info(
    `[ajio-backup] ${args.report} ${args.label}: ${state.added} added, ` +
      `${state.skipped} already held, ${state.failed} page(s) failed`
  )

  return summary
}

/**
 * "Backup" — whole months, chosen on the card.
 *
 * STARTS THE RUN AND HANDS BACK ITS ID. A year of the return report is an hour
 * of requests; waiting on it would hold the IPC call open for that hour and put
 * the whole thing behind one window staying open. So it runs on, reports itself
 * through progress events, and lands in Jobs under this id.
 */
const startBackup = (payload: unknown): Result<BackupStart> => {
  const request = (payload ?? {}) as Record<string, unknown>
  const report = text(request.report) as BackupReport
  const username = text(request.username)
  const fromYear = Number(request.fromYear)
  const fromMonth = Number(request.fromMonth)
  const toYear = Number(request.toYear)
  const toMonth = Number(request.toMonth)

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to back up')
  }
  if (!username) return fail('VALIDATION_ERROR', 'Choose the AJIO account to read from')
  if (!fromYear || !fromMonth || !toYear || !toMonth) {
    return fail('VALIDATION_ERROR', 'Choose the months to back up')
  }
  if (running) return fail('VALIDATION_ERROR', 'A backup is already running')

  const months = monthsBetween(fromYear, fromMonth, toYear, toMonth)

  if (months.length === 0) return fail('VALIDATION_ERROR', 'That range ends before it starts')
  // The prune would delete it again on the next run — refuse rather than
  // spend an hour fetching what will not be kept.
  if (months.some(({ year, month }) => !isRetainedMonth(year, month))) {
    return fail('VALIDATION_ERROR', retentionRefusal())
  }

  const windows = months.map(({ year, month }) => ({
    year,
    month,
    window: monthWindow(year, month),
    label: monthLabel(year, month)
  }))

  const first = windows[0]
  const last = windows[windows.length - 1]
  const label =
    windows.length === 1 || !first || !last
      ? (first?.label ?? '')
      : `${first.label} → ${last.label}`

  // Claimed before returning, so a second click is refused rather than racing.
  running = true

  const jobId = randomUUID()

  void runWindows({
    jobId,
    report,
    username,
    kind: 'months',
    label,
    from: first?.window.from ?? '',
    to: last?.window.to ?? '',
    windows
  }).catch(error => {
    // runWindows handles its own failures; this is the belt for anything the
    // bookkeeping after them could throw, so a background run can never take
    // the process down.
    running = false
    logger.warn(`[ajio-backup] job ${jobId} ended badly`, error)
  })

  return ok({ jobId, months: windows.length, label })
}

/**
 * The IPC entry point. Resolves as soon as the run has been accepted — the run
 * itself is deliberately not awaited, which is what makes it a background job.
 */
export const backupMonths = (payload: unknown): Promise<Result<BackupStart>> =>
  Promise.resolve(startBackup(payload))

/**
 * "Sync" — an arbitrary date range, from the calendar.
 *
 * The same read and the same skip rule; it exists because a gap is rarely a
 * whole month. Awaited rather than backgrounded: a range is short by nature,
 * and the calendar redraws from what it returns.
 *
 * Rows are filed under the month their own date falls in, so a range crossing a
 * boundary lands in both partitions rather than one.
 */
export const syncRange = async (payload: unknown): Promise<Result<BackupSummary>> => {
  const request = (payload ?? {}) as Record<string, unknown>
  const report = text(request.report) as BackupReport
  const username = text(request.username) || (await readBackupSettings()).username
  const from = text(request.from)
  const to = text(request.to)
  const kind = request.kind === 'daily' ? 'daily' : 'range'

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to sync')
  }
  if (!username) return fail('VALIDATION_ERROR', 'Choose the AJIO account to read from')
  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')
  if (running) return fail('VALIDATION_ERROR', 'A backup is already running')

  running = true

  const label = from === to ? from : `${from} → ${to}`

  return ok(
    await runWindows({
      jobId: randomUUID(),
      report,
      username,
      kind,
      label,
      from,
      to,
      windows: rangeByMonth(from, to)
    })
  )
}

/**
 * A date range cut at month ends, one window per calendar month.
 *
 * ONE PER MONTH, because each month is its own file and its own coverage
 * chip. Sent as a single window, 30 Sep → 10 Oct was filed under September
 * and October showed as never synced.
 */
const rangeByMonth = (
  from: string,
  to: string
): { year: number; month: number; window: { from: string; to: string }; label: string }[] => {
  const windows: { year: number; month: number; window: { from: string; to: string }; label: string }[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))

  while (`${year}-${String(month).padStart(2, '0')}` <= to.slice(0, 7)) {
    const whole = monthWindow(year, month)
    const window = {
      from: whole.from > from ? whole.from : from,
      to: whole.to < to ? whole.to : to
    }

    windows.push({
      year,
      month,
      window,
      label: window.from === window.to ? window.from : `${window.from} → ${window.to}`
    })

    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }

  return windows
}

/** What is held, for the calendar and the month chips. */
export const backupCoverage = async (payload: unknown): Promise<Result<BackupCoverage>> => {
  const report = text((payload as { report?: unknown })?.report) as BackupReport

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to look at')
  }

  return ok(await readCoverage(report))
}

/** One month's stored rows, for the viewer. */
export const backupMonth = async (
  payload: unknown
): Promise<Result<{ rows: BackupRecord[] }>> => {
  const request = (payload ?? {}) as Record<string, unknown>
  const report = text(request.report) as BackupReport
  const year = Number(request.year)
  const month = Number(request.month)

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to look at')
  }
  if (!year || !month) return fail('VALIDATION_ERROR', 'Choose a month')

  return ok({ rows: await readMonth(report, year, month) })
}

/**
 * Every stored row whose AWB or EAN contains the term — both reports, every
 * month.
 *
 * Case and padding are ignored on both sides: an AWB copied out of a
 * spreadsheet arrives with whatever casing and spaces it had, and none of that
 * says anything about whether the row is held.
 */
export const searchBackup = async (payload: unknown): Promise<Result<BackupSearchResult>> => {
  const term = text((payload as { term?: unknown })?.term)

  if (term.length < 3) {
    // Two characters match most of a year's rows. Refused rather than answered
    // with a cap's worth of noise.
    return fail('VALIDATION_ERROR', 'Type at least three characters to search')
  }

  const { hits, capped } = await searchRecords(term)

  logger.info(`[ajio-backup] search "${term}": ${hits.length}${capped ? '+' : ''} row(s)`)

  return ok({ term, hits, capped })
}

/**
 * A pasted list of AWBs, answered in one pass.
 *
 * Split on commas, spaces and newlines, because a list arrives from wherever it
 * arrives — a spreadsheet column, a chat message, a claims export — and
 * demanding one separator would mean cleaning the list by hand first.
 */
export const lookupBackup = async (payload: unknown): Promise<Result<BackupLookupResult>> => {
  const raw = text((payload as { awbs?: unknown })?.awbs)
  const keys = [...new Set(raw.split(/[\s,;]+/).map(entry => entry.trim().toUpperCase()).filter(Boolean))]

  if (keys.length === 0) return fail('VALIDATION_ERROR', 'Paste at least one AWB number')
  if (keys.length > MAX_LOOKUP) {
    return fail('VALIDATION_ERROR', `That is ${keys.length} numbers — ${MAX_LOOKUP} at a time`)
  }

  const { hits, found } = await lookupRecords(keys)

  logger.info(`[ajio-backup] looked up ${keys.length} AWB(s): ${found.size} held`)

  return ok({
    hits,
    found: [...found],
    // In the order they were pasted, so the list can be read against the one it
    // came from rather than sorted into something unrecognisable.
    missing: keys.filter(key => !found.has(key))
  })
}

/** Removes what is held for a date range — the calendar's delete. */
export const deleteBackupRange = async (
  payload: unknown
): Promise<Result<{ removed: number }>> => {
  const request = (payload ?? {}) as Record<string, unknown>
  const report = text(request.report) as BackupReport
  const from = text(request.from)
  const to = text(request.to)

  if (report !== 'forward' && report !== 'return') {
    return fail('VALIDATION_ERROR', 'Choose which report to delete from')
  }
  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const removed = await deleteRange(report, from, to)

  logger.info(`[ajio-backup] ${report} ${from}..${to}: ${removed} row(s) deleted`)

  return ok({ removed })
}

/**
 * "Sync since last" — from the last date any sync covered, up to today.
 *
 * Falls back to the daily look-back when nothing has been synced yet, so the
 * button always does something sensible rather than refusing.
 */
export const syncSinceLast = async (payload: unknown): Promise<Result<BackupSummary>> => {
  const report = text((payload as { report?: unknown })?.report) as BackupReport
  const settings = await readBackupSettings()
  const today = new Date()
  const fallback = new Date(today)

  fallback.setDate(fallback.getDate() - DAILY_LOOKBACK_DAYS)

  return syncRange({
    report,
    username: settings.username,
    from: settings.lastSyncedDate ?? ymd(fallback),
    to: ymd(today)
  })
}

/* ---------------------------------------------------------------------------
 * The daily re-sync.
 *
 * AJIO back-dates: a return created on the 30th can appear on the 1st, and a
 * row read the day it happened can change the day after. So the daily job
 * re-reads the LAST TWO DAYS rather than only yesterday, and leans on the AWB +
 * EAN skip to make re-reading cheap — a second pass over a day already held
 * adds nothing and costs one request per page.
 *
 * WHEN this runs is no longer decided here. It used to be a self-rearming
 * `setTimeout` on `dailyTime`, armed at startup and from `saveBackupState`; it
 * is now one task on the nightly schedule (Settings → Automation schedule),
 * along with sessions, Refill Data and the claims.
 *
 * That is not tidying. A `setTimeout` hours long does not survive a laptop
 * sleeping — the machine wakes with the timer unfired and the day's sync simply
 * never happens, silently — and it had no idea the automation lock existed, so
 * it could start a browser run on top of a bulk claim. The scheduler asks "is a
 * run owed?" once a minute instead, which is the same question a closed lid
 * cannot make it forget, and it waits for the browser. Keeping both would have
 * been worse than either: two timers, both able to start an AJIO sync, neither
 * aware of the other.
 * ------------------------------------------------------------------------ */

/**
 * Both reports, for EVERY AJIO account, from where each last left off.
 *
 * EVERY ACCOUNT WITH AN ACTIVE SESSION, not the one chosen on the card: a
 * company with three AJIO
 * logins has three sets of returns, and a backup of one was a backup with two
 * thirds missing. The card's choice is for its own buttons.
 *
 * FROM THE LAST DATE HELD, per account and report, so a missed night leaves no
 * hole — never less than the last two days. A last sync more than
 * AJIO_SYNC_CATCH_UP_DAYS behind, or none at all, reads the last
 * AJIO_SYNC_CATCH_UP_DAYS (see `reportSyncFrom`).
 *
 * Returns what each account's report did rather than logging and moving on, so
 * the scheduled run can say "Forward 412 · Return 388" on the Jobs page.
 *
 * An empty array means there was nothing to run as — no AJIO account at all —
 * which the caller reports as a failure. It is not a quiet success: a backup
 * that syncs nothing every night while claiming to work is the exact failure
 * this backup exists to prevent.
 *
 * @param shouldStop asked between account-reports — Automations switched off
 *        stops the run there.
 */
/**
 * How far back the scheduled run catches up an account: a last sync within this
 * many days continues from that date; older, or never, reads this many days.
 */
const AJIO_SYNC_CATCH_UP_DAYS = 44

export const runDailyBackup = async (
  shouldStop: () => boolean = () => false
): Promise<BackupSummary[]> => {
  // First, so a new month drops the oldest one before anything is fetched.
  await pruneAjioBackup()

  const { all: accounts, live } = await sessionAccounts('ajio')

  if (accounts.length === 0) {
    logger.info('[ajio-backup] daily re-sync skipped — this company has no AJIO account')

    return []
  }

  const today = ymd(new Date())
  const summaries: BackupSummary[] = []

  // ONCE: rows an earlier build filed under the wrong month go back to their
  // own, so the month they belong to shows as synced.
  if ((await readBackupSettings()).laterRowsRefiled !== true) {
    for (const report of ['forward', 'return'] as BackupReport[]) await refileLaterRows(report)
    await writeBackupSettings({ laterRowsRefiled: true })
  }

  for (const username of accounts) {
    // ONLY ACCOUNTS WITH A LIVE SESSION. Without one the read would stop to
    // sign in — a browser window in the middle of the run, or an OTP — so the
    // account is listed as skipped instead, and picked up from its last synced
    // date once its session is back.
    if (!live.has(username.toLowerCase())) {
      logger.info(`[ajio-backup] daily sync for ${username} skipped — no active session`)

      for (const report of ['forward', 'return'] as BackupReport[]) {
        summaries.push({
          report,
          username,
          added: 0,
          skipped: 0,
          failed: 0,
          months: 0,
          error: 'Skipped — no active session (update it on the Login page)'
        })
      }

      continue
    }

    for (const report of ['forward', 'return'] as BackupReport[]) {
      if (shouldStop()) return summaries

      // Read fresh each time: the run before this one has just stamped its own.
      const settings = await readBackupSettings()
      const last =
        settings.lastSyncByAccount?.[username]?.[report]?.coveredTo ??
        // A machine from before per-account stamps: the card's own account
        // carries on from its report stamp rather than starting over.
        (username === settings.username ? settings.lastSyncByReport[report]?.coveredTo : undefined) ??
        null
      const from = clampToRetention(
        reportSyncFrom(last, today, DAILY_LOOKBACK_DAYS, {
          staleDays: AJIO_SYNC_CATCH_UP_DAYS,
          fallbackDays: AJIO_SYNC_CATCH_UP_DAYS
        })
      )

      logger.info(`[ajio-backup] daily ${report} for ${username}: ${from} to ${today} (last synced ${last ?? 'never'})`)

      const result = await syncRange({ report, username, from, to: today, kind: 'daily' })

      if (result.success) {
        summaries.push({ ...result.data, username })

        continue
      }

      logger.warn(`[ajio-backup] daily ${report} for ${username}: ${result.error.message}`)
      // Recorded as a report that ran and brought back nothing, WITH its reason,
      // rather than dropped: a run that says "Forward 412" and is silent about
      // the return report reads as a return report with no new rows.
      summaries.push({
        report,
        username,
        added: 0,
        skipped: 0,
        failed: 0,
        months: 0,
        error: result.error.message
      })
    }
  }

  await writeBackupSettings({ lastRunAt: new Date().toISOString() })

  return summaries
}

export const readBackupState = async (): Promise<Result<BackupSettings>> =>
  ok(await readBackupSettings())

export const saveBackupState = async (payload: unknown): Promise<Result<BackupSettings>> => {
  const request = (payload ?? {}) as Record<string, unknown>
  const patch: Partial<BackupSettings> = {}

  if (typeof request.username === 'string') patch.username = request.username.trim()

  // `dailyTime` is no longer written here. It is still READ once, by the
  // scheduler, to carry a time this machine already had onto the new schedule —
  // after which Settings → Automation schedule owns it. Accepting writes to a
  // field nothing arms would be a time an operator sets and no run ever honours.
  const next = await writeBackupSettings(patch)

  return ok(next)
}
