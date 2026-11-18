import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import { SNAPDEAL_BACKUP_EVENTS } from '@shared/constants/channels'
import type {
  SnapdealBackupSettings,
  SnapdealCollectSummary,
  SnapdealCoverage,
  SnapdealFinished,
  SnapdealJobKind,
  SnapdealProgress,
  SnapdealRecord,
  SnapdealReport,
  SnapdealRequest,
  SnapdealRequestCoverage,
  SnapdealRequestSummary
} from '@shared/types/snapdealBackup'
import { fail, ok, type Result } from '@shared/types/result'
import { monthsBetween, ymd } from '@shared/utils/backupRows'
import {
  snapdealFileWindow,
  snapdealMonthWindow,
  snapdealWindows,
  toSnapdealRecord
} from '@shared/utils/snapdealRows'
import { broadcast } from '../ipc/broadcast'
import { withAutomationLock } from './automationLock'
import {
  completedSnapdealReports,
  downloadSnapdealReport,
  parseSnapdealReport,
  requestSnapdealReport,
  type SnapdealReportRow
} from '../automations/platforms/snapdeal/master-import/api-based-flow/reportRequest'
import {
  deleteSnapdealRange,
  eraseSnapdealReport,
  findSnapdealByAwb,
  forgetSnapdealRequests,
  heldSnapdealMonths,
  readSnapdealCoverage,
  readSnapdealMonth,
  readSnapdealRequestCoverage,
  readSnapdealRequests,
  readSnapdealSettings,
  saveSnapdealRecords,
  saveSnapdealRequest,
  searchSnapdealRecords,
  snapdealRequestsOverlapping,
  writeSnapdealSettings
} from './snapdealBackup.store'
import { saveSnapdealBackupJob } from './snapdealBackupArchive.store'
import { reportSyncFrom } from '@shared/utils/reportSyncWindow'
import { clampToRetention, isRetainedMonth, retentionRefusal } from '@shared/utils/backupRetention'
import {
  MAX_REPORT_REQUEST_ATTEMPTS,
  failedToRetry,
  isStaleRequest,
  isWindowCovered,
  nextAttempt,
  retryableFor
} from '@shared/utils/reportRequestRetry'
import { pruneSnapdealBackup } from './backupRetention.service'
import { sessionAccounts } from './liveAccounts'
import { logger } from './logger'
import { throwIfStopped } from './automationStop'

/**
 * Backing Snapdeal's return report up locally.
 *
 * SAME NEED AS AJIO, A DIFFERENT PORTAL. Snapdeal's seller reports are a live
 * window too — ask for August next March and there is nothing to ask with —
 * and the claims this app files are argued from those rows: the sub-order, the
 * forward AWB, the reverse AWB, the SKU.
 *
 * WHAT MAKES IT DIFFERENT IS THAT SNAPDEAL DOES NOT ANSWER. `generateReport`
 * returns a receipt and builds the file over the next several minutes. So the
 * flow is not read-and-save, it is:
 *
 *   REQUEST   ask for the windows nothing has asked for yet, record each one.
 *   COLLECT   list what Snapdeal has finished, download it, store the rows,
 *             and close the request that asked for it.
 *
 * Both halves run on the same schedule, in that order, so one nightly pass
 * collects yesterday's requests and sends today's. A machine that was asleep
 * simply collects two nights' worth on the next pass — which is the whole
 * reason the request table is durable rather than an in-memory queue.
 *
 * READ, SAVE, NOTHING ELSE. It asks Snapdeal for reports and writes to this
 * machine; it never writes back to Snapdeal and never to TrackVid.
 */

/** Only one report today. Named so a second is an entry, not a rewrite. */
const REPORT: SnapdealReport = 'return'

/**
 * The days the scheduled pass always re-reads — and its window when an account
 * has no recent stored report to continue from (see `reportSyncFrom`).
 *
 * Wider than AJIO's two days on purpose: the thing being re-read is the
 * forward AWB, which Snapdeal fills in only once the forward leg settles —
 * days after the return was raised. A two-day look-back would store the return
 * and never come back for the AWB. Seven days costs one extra report build a
 * night and is what makes the merge in `saveSnapdealRecords` worth having.
 */
const DAILY_REREAD_DAYS = 7

/** Rows a `view data` fetch is allowed to wait for before giving up. */
const MAX_LIST_PAGE = 50

/**
 * How long a request may wait for Snapdeal to build it.
 *
 * A day, because the daily pass collects about 24 h after it asked: a report
 * that is not on the list by then is not coming. Shorter would fail reports
 * that are merely slow before the daily pass had looked once.
 */
const STALE_REQUEST_MS = 24 * 60 * 60 * 1000

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

let running = false

/* -------------------------------------------------------------------------- *
 * Progress
 * -------------------------------------------------------------------------- */

const publish = (progress: SnapdealProgress): void => {
  broadcast(SNAPDEAL_BACKUP_EVENTS.progress, progress)
}

const publishFinished = (finished: SnapdealFinished): void => {
  broadcast(SNAPDEAL_BACKUP_EVENTS.finished, finished)
}

/* -------------------------------------------------------------------------- *
 * REQUEST — asking Snapdeal for windows
 * -------------------------------------------------------------------------- */

/**
 * Does a request already cover this window?
 *
 * CONTAINMENT, NOT OVERLAP, and only by a request that has not failed — or one
 * that has failed as often as it will be asked (`isWindowCovered`). A window is
 * covered when some single request asked for all of it: two requests that
 * each cover half leave the middle unasked unless they happen to abut, and
 * treating a partial overlap as covered is how a gap gets locked in
 * permanently — nothing would ever ask for it again.
 */
const alreadyAsked = isWindowCovered

/**
 * Asks Snapdeal for every window in a range that nothing has asked for.
 *
 * ONE WINDOW AT A TIME, SEQUENTIALLY. Unlike the AJIO backup — which reads
 * months in parallel because each one is just pages of HTTP — every call here
 * queues a report build on Snapdeal's side. Firing twenty-six at once is how a
 * seller account gets rate-limited, and there is nothing to gain: the pass is
 * not waiting for the data, it is waiting for a portal that will take minutes
 * either way.
 */
const requestWindows = async (input: {
  jobId: string
  username: string
  from: string
  to: string
  /** Also re-ask failed windows outside `from`–`to`. The daily pass only. */
  retryFailed?: boolean | undefined
  onProgress?: ((message: string) => void) | undefined
}): Promise<SnapdealRequestSummary> => {
  const windows = snapdealWindows(input.from, input.to)
  // THIS ACCOUNT'S requests only: a window another account asked for says
  // nothing about this one's returns, and skipping it would leave them out.
  const held = (await readSnapdealRequests(REPORT)).filter(record => record.username === input.username)
  const summary: SnapdealRequestSummary = {
    report: REPORT,
    sent: 0,
    skipped: 0,
    failed: 0,
    windows: [],
    error: null
  }

  let done = 0

  /**
   * One ask. `previous` is the failed row for the same window when there is
   * one — sent again IN PLACE, so its attempt count climbs and the cap in
   * `SNAPDEAL_MAX_REQUEST_ATTEMPTS` can end it, rather than a fresh row every
   * pass that would be asked for forever.
   */
  const ask = async (
    window: { from: string; to: string },
    previous: SnapdealRequest | null,
    total: number
  ): Promise<void> => {
    publish({
      jobId: input.jobId,
      report: REPORT,
      message: previous
        ? `Asking Snapdeal again for ${window.from} → ${window.to} (attempt ${previous.attempts + 1})`
        : `Asking Snapdeal for ${window.from} → ${window.to}`,
      done,
      total,
      running: true
    })

    const request: SnapdealRequest = previous
      ? { ...nextAttempt(previous, new Date()), readyAt: null, code: null }
      : {
          id: randomUUID(),
          requestId: null,
          username: input.username,
          report: REPORT,
          from: window.from,
          to: window.to,
          status: 'requested',
          requestedAt: new Date().toISOString(),
          readyAt: null,
          storedAt: null,
          code: null,
          subArea: null,
          filename: null,
          rows: 0,
          added: 0,
          attempts: 1,
          error: null
        }

    try {
      const answer = await requestSnapdealReport({
        username: input.username,
        from: window.from,
        to: window.to,
        onProgress: input.onProgress
      })

      request.requestId = answer.requestId
      request.subArea = answer.subArea
      summary.sent += 1
      summary.windows.push(`${window.from} → ${window.to}`)
    } catch (error) {
      // RECORDED AS A FAILED REQUEST, not dropped. Snapdeal refuses a window
      // it will not build — too old, too wide, or a report of the same shape
      // already queued — and the refusal is the one thing an operator can act
      // on. A row with no trace of the attempt would just be asked for again
      // tomorrow, and refused again.
      request.status = 'failed'
      request.error = error instanceof Error ? error.message : String(error)
      summary.failed += 1
      logger.warn(
        `[snapdeal-backup] ${window.from} → ${window.to} was refused ` +
          `(attempt ${request.attempts} of ${MAX_REPORT_REQUEST_ATTEMPTS}): ${request.error}`
      )
    }

    await saveSnapdealRequest(request)

    const at = held.findIndex(record => record.id === request.id)

    if (at >= 0) held.splice(at, 1)
    held.unshift(request)
  }

  for (const window of windows) {
    throwIfStopped('Snapdeal report request')
    done += 1

    if (alreadyAsked(window, held)) {
      summary.skipped += 1
      continue
    }

    await ask(window, retryableFor(window, held), windows.length)
  }

  // FAILED WINDOWS OUTSIDE TODAY'S RANGE. The range starts from the last date
  // stored, so a window refused — or never built — before a later one landed
  // sits behind it and would never be asked for again. Asked here, after the
  // range, so a window the range has just covered is not asked twice.
  const retries = input.retryFailed ? failedToRetry(held, clampToRetention('0000-01-01')) : []

  for (const record of retries) {
    throwIfStopped('Snapdeal report retry')
    if (alreadyAsked(record, held)) continue

    await ask(record, record, windows.length + retries.length)
  }

  return summary
}

/* -------------------------------------------------------------------------- *
 * COLLECT — fetching what Snapdeal has finished building
 * -------------------------------------------------------------------------- */

/**
 * Which outstanding request a downloaded file belongs to.
 *
 * THE FILENAME IS THE ONLY HONEST ANSWER. Snapdeal's reports list carries no
 * id, and every row of this report is called "Dropship Return Acknowledged" —
 * so with four windows in flight the list cannot say which row is which. The
 * file can: `..._05092026_03102026.csv` is the 5th of September to the 3rd of
 * October, exactly the window that was asked for.
 *
 * Matched on the window the file states, falling back to the oldest
 * outstanding request only when the name carries no dates at all. That
 * fallback is deliberately the OLDEST: Snapdeal builds in the order it was
 * asked, so the unnamed file in front of us is the one that has been waiting
 * longest — and guessing the newest would hand a month's rows to the request
 * that asked for a week.
 */
const matchRequest = (
  file: { from: string; to: string } | null,
  outstanding: SnapdealRequest[]
): SnapdealRequest | null => {
  if (file) {
    const exact = outstanding.find(record => record.from === file.from && record.to === file.to)

    if (exact) return exact

    // Snapdeal has been seen to widen a window by a day at the edges. A file
    // that CONTAINS a request's window still answers it.
    const covering = outstanding.find(
      record => file.from <= record.from && file.to >= record.to
    )

    if (covering) return covering

    return null
  }

  return [...outstanding].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0] ?? null
}

/**
 * Rows from one downloaded file, into the one table.
 *
 * EVERY ROW CARRIES THE REQUEST THAT BROUGHT IT — `request.id`, the row id in
 * `snapdeal-backup-requests`, not Snapdeal's own portal number. That is what
 * replaced the month in the filename: "which window did this come from" used
 * to be answered by which file a row sat in, and is now a join against a table
 * that also knows the window, the portal requestId, the account and whether
 * the download succeeded. The portal number is one hop away and would be
 * ambiguous stored here — it is null whenever Snapdeal did not return one.
 */
const storeFile = async (
  rows: Record<string, unknown>[],
  request: SnapdealRequest
): Promise<{ added: number; updated: number; skipped: number; stored: number }> => {
  const records: SnapdealRecord[] = []

  for (const row of rows) {
    const record = toSnapdealRecord(row, request.id)

    // A row with no sub-order is not a return, and one with no parseable date
    // has no month to report under — keeping it would put a row in the store
    // that no calendar, delete or lookup could ever reach.
    if (!record || !record.year || !record.month) continue

    records.push(record)
  }

  const saved = await saveSnapdealRecords(REPORT, records)

  return { ...saved, stored: records.length }
}

/**
 * Downloads and stores everything Snapdeal has finished building.
 *
 * `only` narrows it to a set of request ids — what the manual fetch in the
 * request coverage dialog passes. Left out, it chases every outstanding
 * request, which is what the schedule does.
 *
 * `redo` is the per-row "Store" in that dialog: the `only` requests are chased
 * WHATEVER their status — a stored request that came back with no rows, or
 * one marked failed after Snapdeal did return a requestId — and their own
 * download token is let past the downloaded-once filter so the same file can
 * be fetched again. Rows merge on save, so a second store of the same file
 * adds nothing twice.
 */
const collectReports = async (input: {
  jobId: string
  username: string
  only?: Set<string> | undefined
  redo?: boolean | undefined
  onProgress?: ((message: string) => void) | undefined
}): Promise<SnapdealCollectSummary> => {
  const summary: SnapdealCollectSummary = {
    report: REPORT,
    stored: 0,
    added: 0,
    skipped: 0,
    pending: 0,
    failed: 0,
    error: null
  }

  const outstanding = (await readSnapdealRequests(REPORT)).filter(
    record =>
      (input.redo || record.status === 'requested' || record.status === 'ready') &&
      // The reports list read below is THIS account's portal: another
      // account's request cannot be in it, and matching a window against one
      // would file this account's report under that account's request.
      record.username === input.username &&
      (!input.only || input.only.has(record.id))
  )

  if (outstanding.length === 0) return summary

  publish({
    jobId: input.jobId,
    report: REPORT,
    message: 'Checking what Snapdeal has finished building…',
    done: 0,
    total: outstanding.length,
    running: true
  })

  let completed: SnapdealReportRow[]

  try {
    completed = await completedSnapdealReports({
      username: input.username,
      pageSize: MAX_LIST_PAGE,
      onProgress: input.onProgress
    })
  } catch (error) {
    summary.error = error instanceof Error ? error.message : String(error)
    summary.pending = outstanding.length
    logger.warn(`[snapdeal-backup] could not read the reports list: ${summary.error}`)

    return summary
  }

  // DOWNLOADED ONCE, NEVER AGAIN. Snapdeal's list keeps finished files for
  // weeks; a file whose token is on a stored request, or which an earlier pass
  // opened and found to be nobody's, is not fetched a second time.
  const held = await readSnapdealSettings()
  const redoing = input.redo ? new Set(outstanding.map(record => record.id)) : new Set<string>()
  const downloaded = new Set<string>([
    // A redo whose request never got a token cannot say which file is its
    // own, so the "opened and found to be nobody's" memory is not trusted for
    // it — that file may be exactly the one that was mis-attributed.
    ...(input.redo && outstanding.some(record => !record.code)
      ? []
      : (held.downloadedByAccount?.[input.username] ?? [])),
    ...(await readSnapdealRequests(REPORT))
      .filter(
        record =>
          record.username === input.username &&
          record.status === 'stored' &&
          !redoing.has(record.id)
      )
      .flatMap(record => (record.code ? [record.code] : []))
  ])
  for (const record of outstanding) {
    if (input.redo && record.code) downloaded.delete(record.code)
  }
  const fetchedNow: string[] = []
  const fresh = completed.filter(row => !row.code || !downloaded.has(row.code))

  if (completed.length > fresh.length) {
    input.onProgress?.(`${completed.length - fresh.length} report(s) already downloaded — skipped`)
  }

  // Oldest first, so the fallback match in `matchRequest` pairs the earliest
  // file with the earliest request rather than racing the sort order.
  const queue = [...fresh].sort((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0))
  const waiting = [...outstanding]
  /** Requests whose file IS built but would not download — owed a download, not a new ask. */
  const downloadFailed = new Set<string>()
  let done = 0

  for (const row of queue) {
    throwIfStopped('Snapdeal report download')
    if (waiting.length === 0) break
    if (!row.downloadHref) continue

    // THE ROW SAYS ITS WINDOW. Snapdeal's list now carries `reportStartDate` /
    // `reportEndDate`, so a report that answers no outstanding request — an
    // old one, or one made by hand in the portal — is passed over without
    // downloading it at all.
    const listed = row.window ? matchRequest(row.window, waiting) : null

    if (row.window && !listed) continue

    done += 1
    publish({
      jobId: input.jobId,
      report: REPORT,
      message: `Downloading report ${done} of ${queue.length}…`,
      done,
      total: queue.length,
      running: true
    })

    let file: { buffer: Buffer; filename: string }

    try {
      file = await downloadSnapdealReport({
        username: input.username,
        href: row.downloadHref,
        onProgress: input.onProgress
      })
    } catch (error) {
      // ONE FILE, NOT THE PASS. A report that will not download leaves its
      // request outstanding and the next pass tries again — abandoning the
      // loop would strand every report behind it.
      if (listed) downloadFailed.add(listed.id)
      summary.failed += 1
      logger.warn(
        `[snapdeal-backup] could not download ${row.downloadHref}: ` +
          (error instanceof Error ? error.message : String(error))
      )
      continue
    }

    if (row.code) fetchedNow.push(row.code)

    const request = listed ?? matchRequest(snapdealFileWindow(file.filename), waiting)

    if (!request) {
      // Somebody else's report — one generated from the portal by hand, or one
      // this machine has already stored. Not a failure, and not ours to store:
      // without a request to attribute it to there is nothing to close.
      logger.info(
        `[snapdeal-backup] ignoring ${file.filename || 'an unnamed report'} — ` +
          'no outstanding request matches its window'
      )
      continue
    }

    const rows = parseSnapdealReport(file.buffer)
    const saved = await storeFile(rows, request)

    waiting.splice(waiting.indexOf(request), 1)

    await saveSnapdealRequest({
      ...request,
      status: 'stored',
      readyAt: request.readyAt ?? new Date().toISOString(),
      storedAt: new Date().toISOString(),
      code: row.code,
      subArea: row.subArea ?? request.subArea,
      filename: file.filename || null,
      rows: saved.stored,
      added: saved.added,
      error: null
    })

    summary.stored += 1
    summary.added += saved.added + saved.updated
    summary.skipped += saved.skipped

    logger.info(
      `[snapdeal-backup] ${request.from} → ${request.to}: ${saved.added} new, ` +
        `${saved.updated} filled in, ${saved.skipped} already held ` +
        `(${file.filename || 'unnamed'})`
    )
  }

  // NEVER BUILT. A request still unanswered a day after it was asked is not
  // slow, it is lost — Snapdeal failed the build or dropped it from the list.
  // Left `requested` it would count as asked forever and its window would
  // never be asked for again; marked failed, the next daily pass re-asks it.
  // Not on a manual fetch of chosen rows (`only`), which is about those files,
  // and not for a request whose file is there but would not download — that
  // one is owed a download on the next pass, not a second build.
  if (!input.only) {
    const now = new Date()

    for (const record of [...waiting]) {
      if (downloadFailed.has(record.id) || !isStaleRequest(record, now, STALE_REQUEST_MS)) continue

      waiting.splice(waiting.indexOf(record), 1)
      summary.failed += 1

      const error =
        'Snapdeal had not built this report a day after it was asked — ' +
        (record.attempts < MAX_REPORT_REQUEST_ATTEMPTS
          ? 'it will be asked for again on the next pass'
          : `given up after ${record.attempts} attempts`)

      await saveSnapdealRequest({ ...record, status: 'failed', error })
      logger.warn(`[snapdeal-backup] ${record.from} → ${record.to}: ${error}`)
    }
  }

  summary.pending = waiting.length

  if (fetchedNow.length > 0) {
    const current = await readSnapdealSettings()
    const mine = [...new Set([...(current.downloadedByAccount?.[input.username] ?? []), ...fetchedNow])]

    await writeSnapdealSettings({
      downloadedByAccount: {
        ...(current.downloadedByAccount ?? {}),
        // The newest few hundred: the list itself does not reach further back.
        [input.username]: mine.slice(-DOWNLOADED_MEMORY)
      }
    })
  }

  if (summary.stored > 0) {
    const stored = (await readSnapdealRequests(REPORT)).filter(record => record.status === 'stored')
    const latest = stored
      .map(record => record.to)
      .sort()
      .at(-1)
    const latestHere = stored
      .filter(record => record.username === input.username)
      .map(record => record.to)
      .sort()
      .at(-1)
    const current = await readSnapdealSettings()

    await writeSnapdealSettings({
      coveredTo: latest ?? null,
      lastStoredAt: new Date().toISOString(),
      ...(latestHere
        ? { coveredToByAccount: { ...(current.coveredToByAccount ?? {}), [input.username]: latestHere } }
        : {})
    })
  }

  return summary
}

/* -------------------------------------------------------------------------- *
 * One run
 * -------------------------------------------------------------------------- */

/**
 * A pass, whatever started it: the lock, the archive, the finished event.
 *
 * THE LOCK, ONCE, FOR THE WHOLE PASS — the same decision the AJIO backup
 * makes, for the same reason. Snapdeal's sign-in drives a browser, so a pass
 * is one automation and must not interleave with a claim run.
 *
 * `collect` runs BEFORE `request` when a pass does both. Yesterday's reports
 * are finished and today's are not, so collecting first means a nightly pass
 * banks what is ready before queueing more — and a machine that is closed
 * straight afterwards has still saved something.
 */
const runPass = async (input: {
  jobId: string
  username: string
  kind: SnapdealJobKind
  label: string
  from: string
  to: string
  doCollect: boolean
  doRequest: boolean
  collectAfterRequest?: boolean
  retryFailed?: boolean
  only?: Set<string> | undefined
  redo?: boolean | undefined
}): Promise<{ request: SnapdealRequestSummary | null; collect: SnapdealCollectSummary | null }> => {
  /**
   * THE FLAG IS CLEARED HERE, OUTSIDE THE LOCK, and that placement is the
   * point. `running` is claimed by the caller before this is reached, so
   * anything that throws BEFORE the body runs — the automation lock itself,
   * most plausibly — would otherwise leave it set for the life of the process
   * and every later pass refused with "a Snapdeal pass is already running".
   * A stuck flag on a feature whose normal state is "waiting" is close to
   * invisible: it looks exactly like a portal that is slow today.
   */
  try {
    return await runLockedPass(input)
  } finally {
    running = false
  }
}

const runLockedPass = async (input: {
  jobId: string
  username: string
  kind: SnapdealJobKind
  label: string
  from: string
  to: string
  doCollect: boolean
  doRequest: boolean
  /** Check once for a fast report straight after requesting. Default on; the scheduled run downloads in its own phase. */
  collectAfterRequest?: boolean
  /** Re-ask failed windows outside the range too — see `requestWindows`. */
  retryFailed?: boolean
  only?: Set<string> | undefined
  redo?: boolean | undefined
}): Promise<{ request: SnapdealRequestSummary | null; collect: SnapdealCollectSummary | null }> =>
  withAutomationLock('snapdeal-backup', async () => {
    const startedAt = new Date().toISOString()
    const onProgress = (message: string): void => {
      logger.info(`[snapdeal-backup/${input.username}] ${message}`)
    }

    let collect: SnapdealCollectSummary | null = null
    let request: SnapdealRequestSummary | null = null
    let error: string | null = null

    try {
      if (input.doCollect) {
        collect = await collectReports({
          jobId: input.jobId,
          username: input.username,
          only: input.only,
          redo: input.redo,
          onProgress
        })
      }

      if (input.doRequest) {
        request = await requestWindows({
          jobId: input.jobId,
          username: input.username,
          from: input.from,
          to: input.to,
          retryFailed: input.retryFailed,
          onProgress
        })

        // A pass that has just asked for windows checks once more before it
        // ends. Snapdeal's smaller reports are often built in seconds, and
        // waiting a whole day to fetch one that was ready a minute later is
        // the difference between a backup that is current and one that is
        // always a day behind.
        if (request.sent > 0 && input.collectAfterRequest !== false) {
          const second = await collectReports({
            jobId: input.jobId,
            username: input.username,
            onProgress
          })

          collect = collect
            ? {
                ...collect,
                stored: collect.stored + second.stored,
                added: collect.added + second.added,
                skipped: collect.skipped + second.skipped,
                pending: second.pending,
                failed: collect.failed + second.failed
              }
            : second
        }
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'The Snapdeal pass stopped unexpectedly'
      logger.warn(`[snapdeal-backup] ${input.label} stopped`, caught)
    }

    publish({
      jobId: input.jobId,
      report: REPORT,
      message: error ?? 'Finished',
      done: 1,
      total: 1,
      running: false
    })

    await saveSnapdealBackupJob({
      jobId: input.jobId,
      report: REPORT,
      username: input.username,
      kind: input.kind,
      from: input.from,
      to: input.to,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: error ? 'failed' : 'done',
      sent: request?.sent ?? 0,
      stored: collect?.stored ?? 0,
      added: collect?.added ?? 0,
      skipped: collect?.skipped ?? 0,
      pending: collect?.pending ?? 0,
      failed: (request?.failed ?? 0) + (collect?.failed ?? 0),
      error: error ?? collect?.error ?? null
    })

    publishFinished({
      jobId: input.jobId,
      report: REPORT,
      kind: input.kind,
      label: input.label,
      sent: request?.sent ?? 0,
      stored: collect?.stored ?? 0,
      added: collect?.added ?? 0,
      pending: collect?.pending ?? 0,
      failed: (request?.failed ?? 0) + (collect?.failed ?? 0),
      error: error ?? collect?.error ?? null
    })

    return { request, collect }
  })

/* -------------------------------------------------------------------------- *
 * The IPC entry points
 * -------------------------------------------------------------------------- */

const chosenAccount = async (given: unknown): Promise<string> =>
  text(given) || (await readSnapdealSettings()).username

/**
 * "Request" — whole months, chosen on the card.
 *
 * Backgrounded. Twelve months is twenty-six report builds queued one after
 * another, and holding the IPC call open for that would put the whole app
 * behind one window staying open.
 */
export const requestSnapdealMonths = async (payload: unknown): Promise<Result<{ jobId: string; windows: number }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const username = await chosenAccount(input.username)
  const fromYear = Number(input.fromYear)
  const fromMonth = Number(input.fromMonth)
  const toYear = Number(input.toYear)
  const toMonth = Number(input.toMonth)

  if (!username) return fail('VALIDATION_ERROR', 'Choose the Snapdeal account to read from')
  if (!fromYear || !fromMonth || !toYear || !toMonth) {
    return fail('VALIDATION_ERROR', 'Choose the months to request')
  }
  if (running) return fail('VALIDATION_ERROR', 'A Snapdeal pass is already running')

  const months = monthsBetween(fromYear, fromMonth, toYear, toMonth)

  if (months.length === 0) return fail('VALIDATION_ERROR', 'That range ends before it starts')
  // The prune would delete it again on the next run.
  if (months.some(({ year, month }) => !isRetainedMonth(year, month))) {
    return fail('VALIDATION_ERROR', retentionRefusal())
  }

  const first = snapdealMonthWindow(months[0]!.year, months[0]!.month)
  const last = snapdealMonthWindow(months.at(-1)!.year, months.at(-1)!.month)
  // Never ask for days that have not happened: Snapdeal answers a window
  // ending in the future by refusing the whole report, not by trimming it.
  const today = ymd(new Date())
  const to = last.to > today ? today : last.to

  if (to < first.from) return fail('VALIDATION_ERROR', 'That month has not started yet')

  running = true

  const jobId = randomUUID()
  const windows = snapdealWindows(first.from, to).length

  void runPass({
    jobId,
    username,
    kind: 'months',
    label: `${first.from} → ${to}`,
    from: first.from,
    to,
    doCollect: false,
    doRequest: true
  }).catch(error => {
    running = false
    logger.warn(`[snapdeal-backup] job ${jobId} ended badly`, error)
  })

  return ok({ jobId, windows })
}

/** "Request this range" — from the request calendar. */
export const requestSnapdealRange = async (payload: unknown): Promise<Result<SnapdealRequestSummary>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const username = await chosenAccount(input.username)
  const from = text(input.from)
  const to = text(input.to)

  if (!username) return fail('VALIDATION_ERROR', 'Choose the Snapdeal account to read from')
  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')
  if (running) return fail('VALIDATION_ERROR', 'A Snapdeal pass is already running')

  running = true

  const result = await runPass({
    jobId: randomUUID(),
    username,
    kind: 'range',
    label: `${from} → ${to}`,
    from,
    to,
    doCollect: false,
    doRequest: true
  })

  return ok(
    result.request ?? {
      report: REPORT,
      sent: 0,
      skipped: 0,
      failed: 0,
      windows: [],
      error: 'The request pass did not run'
    }
  )
}

/** "Collect now" — download and store whatever Snapdeal has finished. */
export const collectSnapdealReports = async (payload: unknown): Promise<Result<SnapdealCollectSummary>> => {
  const username = await chosenAccount((payload as { username?: unknown })?.username)

  if (!username) return fail('VALIDATION_ERROR', 'Choose the Snapdeal account to read from')
  if (running) return fail('VALIDATION_ERROR', 'A Snapdeal pass is already running')

  running = true

  const result = await runPass({
    jobId: randomUUID(),
    username,
    kind: 'collect',
    label: 'Collect',
    from: '',
    to: '',
    doCollect: true,
    doRequest: false
  })

  return ok(
    result.collect ?? {
      report: REPORT,
      stored: 0,
      added: 0,
      skipped: 0,
      pending: 0,
      failed: 0,
      error: null
    }
  )
}

/**
 * "Download this range" — the manual fetch in the request coverage dialog.
 *
 * Collects only the requests whose window overlaps the chosen days. The point
 * is an operator who can see a request sitting at "requested" and wants its
 * file NOW rather than at the next scheduled pass — chasing every outstanding
 * request instead would make a targeted action take as long as the whole
 * backlog.
 */
export const collectSnapdealRange = async (payload: unknown): Promise<Result<SnapdealCollectSummary>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const username = await chosenAccount(input.username)
  const from = text(input.from)
  const to = text(input.to)

  if (!username) return fail('VALIDATION_ERROR', 'Choose the Snapdeal account to read from')
  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')
  if (running) return fail('VALIDATION_ERROR', 'A Snapdeal pass is already running')

  const overlapping = await snapdealRequestsOverlapping({ report: REPORT, from, to })
  const chaseable = overlapping.filter(
    record => record.status === 'requested' || record.status === 'ready'
  )

  if (chaseable.length === 0) {
    return fail(
      'VALIDATION_ERROR',
      overlapping.length === 0
        ? 'Nothing has been asked of Snapdeal for those days yet — request them first'
        : 'Every request covering those days has already been downloaded'
    )
  }

  running = true

  const result = await runPass({
    jobId: randomUUID(),
    username,
    kind: 'collect',
    label: `${from} → ${to}`,
    from,
    to,
    doCollect: true,
    doRequest: false,
    only: new Set(chaseable.map(record => record.id))
  })

  return ok(
    result.collect ?? {
      report: REPORT,
      stored: 0,
      added: 0,
      skipped: 0,
      pending: 0,
      failed: 0,
      error: null
    }
  )
}

/**
 * "Store" on one row of the request table — download that request's report
 * and store it, whatever state the row is in.
 *
 * Keyed on OUR row id, with or without a Snapdeal requestId. The requestId
 * cannot address the file anyway (see `reportRequest.ts`), so the download is
 * resolved through the reports list exactly as the scheduled pass does,
 * narrowed to this one request's window and account.
 */
export const collectSnapdealRequest = async (payload: unknown): Promise<Result<SnapdealCollectSummary>> => {
  const id = text((payload as { id?: unknown } | null)?.id)

  if (!id) return fail('VALIDATION_ERROR', 'Choose the request to store')
  if (running) return fail('VALIDATION_ERROR', 'A Snapdeal pass is already running')

  const request = (await readSnapdealRequests(REPORT)).find(record => record.id === id)

  if (!request) return fail('NOT_FOUND', 'That request no longer exists — reopen the dialog')

  // A REFUSED ROW IS TRIED TOO. A 502 at generate time is often a gateway
  // timeout on a report Snapdeal went on to build; the collect matches a file
  // by the window in its filename, not by requestId, so it can still find it.
  running = true

  const result = await runPass({
    jobId: randomUUID(),
    username: request.username,
    kind: 'collect',
    label: `${request.from} → ${request.to}` + (request.requestId ? ` (#${request.requestId})` : ''),
    from: request.from,
    to: request.to,
    doCollect: true,
    doRequest: false,
    only: new Set([request.id]),
    redo: true
  })

  return ok(
    result.collect ?? {
      report: REPORT,
      stored: 0,
      added: 0,
      skipped: 0,
      pending: 0,
      failed: 0,
      error: null
    }
  )
}

/** What is held, for the data calendar and the month chips. */
export const snapdealCoverage = async (): Promise<Result<SnapdealCoverage>> =>
  ok(await readSnapdealCoverage(REPORT))

/** What was asked for, for the request calendar. */
export const snapdealRequestCoverage = async (): Promise<Result<SnapdealRequestCoverage>> =>
  ok(await readSnapdealRequestCoverage(REPORT))

/**
 * One month's stored rows — and a fetch first when nothing is held.
 *
 * "VIEW DATA" IS ALSO A COLLECT. The month an operator opens is often one
 * whose report was requested and never fetched, and showing them an empty
 * table next to a request row that says "requested" is making them run the
 * collect themselves. So an empty month triggers one collect pass and is then
 * re-read; a month that already holds rows opens straight away.
 */
export const snapdealMonth = async (
  payload: unknown
): Promise<Result<{ rows: SnapdealRecord[]; fetched: boolean }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const year = Number(input.year)
  const month = Number(input.month)

  if (!year || !month) return fail('VALIDATION_ERROR', 'Choose a month')

  const held = await readSnapdealMonth(REPORT, year, month)

  if (held.length > 0) return ok({ rows: held, fetched: false })

  const username = await chosenAccount(input.username)

  // Nothing held and nothing outstanding means there is nothing to fetch —
  // answered as an empty month rather than as a pass that does nothing.
  const outstanding = (await readSnapdealRequests(REPORT)).some(
    record => record.status === 'requested' || record.status === 'ready'
  )

  if (!username || !outstanding || running) return ok({ rows: held, fetched: false })

  running = true

  await runPass({
    jobId: randomUUID(),
    username,
    kind: 'collect',
    label: `${year}-${String(month).padStart(2, '0')}`,
    from: '',
    to: '',
    doCollect: true,
    doRequest: false
  })

  return ok({ rows: await readSnapdealMonth(REPORT, year, month), fetched: true })
}

/** Rows carrying a sub-order, an AWB or a SKU. */
export const searchSnapdealBackup = async (
  payload: unknown
): Promise<Result<{ term: string; hits: SnapdealRecord[]; capped: boolean }>> => {
  const term = text((payload as { term?: unknown })?.term)

  if (term.length < 3) {
    return fail('VALIDATION_ERROR', 'Type at least three characters to search')
  }

  const { hits, capped } = await searchSnapdealRecords(term)

  logger.info(`[snapdeal-backup] search "${term}": ${hits.length}${capped ? '+' : ''} row(s)`)

  return ok({ term, hits, capped })
}

/**
 * The stored return for one AWB typed into Create Claim — exact, local, no
 * network. Null when nothing is held for it, which is not an error: the backup
 * only covers the windows that were collected.
 */
export const lookupSnapdealAwb = async (
  payload: unknown
): Promise<Result<SnapdealRecord | null>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const awb = text(input.awb)
  const side = input.side === 'forward' ? 'forward' : 'return'

  if (!/^[A-Za-z0-9-]{4,40}$/.test(awb)) return fail('VALIDATION_ERROR', 'That is not an AWB number')

  return ok(await findSnapdealByAwb(awb, side))
}

/** Removes what is held for a date range — the data calendar's delete. */
export const deleteSnapdealBackupRange = async (
  payload: unknown
): Promise<Result<{ removed: number }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const from = text(input.from)
  const to = text(input.to)

  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const removed = await deleteSnapdealRange(REPORT, from, to)

  logger.info(`[snapdeal-backup] ${from}..${to}: ${removed} row(s) deleted`)

  return ok({ removed })
}

/** Forgets the request rows for a range, so those windows can be asked again. */
export const forgetSnapdealBackupRequests = async (
  payload: unknown
): Promise<Result<{ removed: number }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const from = text(input.from)
  const to = text(input.to)

  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const removed = await forgetSnapdealRequests({ report: REPORT, from, to })

  logger.info(`[snapdeal-backup] forgot ${removed} request(s) covering ${from}..${to}`)

  return ok({ removed })
}

export const readSnapdealBackupState = async (): Promise<Result<SnapdealBackupSettings>> =>
  ok(await readSnapdealSettings())

export const saveSnapdealBackupState = async (
  payload: unknown
): Promise<Result<SnapdealBackupSettings>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const patch: Partial<SnapdealBackupSettings> = {}

  if (typeof input.username === 'string') patch.username = input.username.trim()

  return ok(await writeSnapdealSettings(patch))
}

/* -------------------------------------------------------------------------- *
 * The scheduled pass
 * -------------------------------------------------------------------------- */

/**
 * How far back the scheduled run asks for an account: a last stored date
 * within this many days continues from it; older, or never, asks for this many
 * days. The same as AJIO.
 */
const SNAPDEAL_SYNC_CATCH_UP_DAYS = 44

/** How many downloaded-file tokens are remembered per account. */
const DOWNLOADED_MEMORY = 500

/** One account's share of the scheduled pass. */
export interface SnapdealDailyResult {
  username: string
  request: SnapdealRequestSummary | null
  collect: SnapdealCollectSummary | null
}

/**
 * The nightly pass, for EVERY Snapdeal account: collect what is ready, then ask
 * for the days since that account's last stored report.
 *
 * EVERY ACCOUNT, not the one chosen on the card: each Snapdeal login has its
 * own returns, and a backup of one left the others out. The card's choice is
 * for its own buttons.
 *
 * FROM THE LAST DATE HELD, per account, so a missed night leaves no hole —
 * never less than the last two days, and never a catch-up of more than a week
 * (see `reportSyncFrom`).
 *
 * An empty array means there was nothing to run as — no Snapdeal account at
 * all — which the caller reports as a failure. It is not a quiet success: a
 * backup that syncs nothing every night while claiming to work is the exact
 * failure this exists to prevent.
 *
 * @param shouldStop asked between accounts — Automations switched off stops
 *        the run there.
 */
export const runDailySnapdealBackup = async (
  shouldStop: () => boolean = () => false
): Promise<SnapdealDailyResult[]> => {
  // First, so a new month drops the oldest one before anything is fetched.
  await pruneSnapdealBackup()

  const { all: accounts, live } = await sessionAccounts('snapdeal')

  if (accounts.length === 0) {
    logger.info('[snapdeal-backup] daily pass skipped — this company has no Snapdeal account')

    return []
  }

  const today = ymd(new Date())
  const results: SnapdealDailyResult[] = []
  const active = accounts.filter(username => live.has(username.toLowerCase()))

  // ONLY ACCOUNTS WITH A LIVE SESSION: without one the pass would stop to sign
  // in, with an OTP. Listed as skipped, and caught up once the session is back.
  for (const username of accounts.filter(name => !active.includes(name))) {
    logger.info(`[snapdeal-backup] daily pass for ${username} skipped — no active session`)
    results.push({
      username,
      request: null,
      collect: {
        report: REPORT,
        stored: 0,
        added: 0,
        skipped: 0,
        pending: 0,
        failed: 0,
        error: 'Skipped — no active session (update it on the Login page)'
      }
    })
  }

  const byAccount = new Map<string, SnapdealDailyResult>()

  // PHASE 1 — ASK. Every account's windows are requested first, so Snapdeal
  // builds them while the other accounts are being asked.
  for (const username of active) {
    if (shouldStop()) break

    // Read fresh each time: the account before this one has just stamped its own.
    const settings = await readSnapdealSettings()
    const last =
      settings.coveredToByAccount?.[username] ??
      // A machine from before per-account stamps: the card's own account
      // carries on from the old stamp rather than starting over.
      (username === settings.username ? settings.coveredTo : null) ??
      null
    const from = clampToRetention(
      reportSyncFrom(last, today, DAILY_REREAD_DAYS, {
        staleDays: SNAPDEAL_SYNC_CATCH_UP_DAYS,
        fallbackDays: SNAPDEAL_SYNC_CATCH_UP_DAYS
      })
    )

    logger.info(`[snapdeal-backup] daily pass for ${username}: ${from} to ${today} (last stored ${last ?? 'never'})`)

    running = true

    const result = await runPass({
      jobId: randomUUID(),
      username,
      kind: 'daily',
      label: `${username}: ${from} → ${today}`,
      from,
      to: today,
      doCollect: false,
      doRequest: true,
      collectAfterRequest: false,
      // A window refused, or never built, on an earlier night is asked again
      // here — even once the range has moved past it.
      retryFailed: true
    })

    byAccount.set(username, { username, request: result.request, collect: null })
  }

  // PHASE 2 — DOWNLOAD. Every outstanding request of every active account,
  // fetched and marked stored, so it is never downloaded again.
  for (const username of active) {
    if (shouldStop()) break

    running = true

    const result = await runPass({
      jobId: randomUUID(),
      username,
      kind: 'daily',
      label: `${username}: download requested reports`,
      from: today,
      to: today,
      doCollect: true,
      doRequest: false
    })

    byAccount.set(username, {
      username,
      request: byAccount.get(username)?.request ?? null,
      collect: result.collect
    })
  }

  results.push(...byAccount.values())

  await writeSnapdealSettings({ lastRunAt: new Date().toISOString() })

  return results
}

/**
 * Everything held, deleted.
 *
 * The confirming happens HERE, in the main process, where the dialog can state
 * the rows, the months and the size — what is about to be lost, rather than
 * "are you sure" — and where it cannot be clicked past by accident.
 *
 * The request rows are left alone. Erasing the data and forgetting that the
 * windows were ever asked for are different decisions, and an operator who
 * erases a bad import still wants the calendar to show which windows Snapdeal
 * has already built.
 */
export const eraseSnapdealBackup = async (): Promise<Result<{ rows: number; months: number }>> => {
  const coverage = await readSnapdealCoverage(REPORT)

  if (coverage.rows === 0) return fail('VALIDATION_ERROR', 'Nothing is held for Snapdeal')

  const size = coverage.bytes > 0 ? ` (${(coverage.bytes / 1024 / 1024).toFixed(1)} MB)` : ''
  const answer = await dialog.showMessageBox({
    type: 'warning',
    // Destructive second, and the default is Cancel: the dangerous button
    // should never be the one a stray Return key presses.
    buttons: ['Cancel', `Erase ${coverage.rows.toLocaleString()} rows`],
    defaultId: 0,
    cancelId: 0,
    title: 'Erase this backup?',
    message: 'Erase the whole Snapdeal return report backup?',
    detail:
      `${coverage.rows.toLocaleString()} row(s) across ${coverage.months.length} month(s)${size} ` +
      'will be deleted from this machine.\n\n' +
      "Snapdeal's reports are a live window, and a report takes minutes to rebuild — a month " +
      'erased here has to be asked for and waited on again. This cannot be undone.'
  })

  if (answer.response !== 1) return fail('VALIDATION_ERROR', 'Cancelled')

  const removed = await eraseSnapdealReport(REPORT)

  logger.info(`[snapdeal-backup] erased ${removed.rows} row(s)`)

  return ok(removed)
}

/** Which months hold anything — used by the card's chips. */
export const snapdealHeldMonths = async (): Promise<{ year: number; month: number }[]> =>
  heldSnapdealMonths(REPORT)
