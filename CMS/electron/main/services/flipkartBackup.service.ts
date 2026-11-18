import { randomUUID } from 'node:crypto'
import { dialog } from 'electron'
import type {
  FlipkartAccountResult,
  FlipkartAwbMatch,
  FlipkartBackupState,
  FlipkartCardState,
  FlipkartCoverage,
  FlipkartMonthCoverage,
  FlipkartRecord,
  FlipkartReport,
  FlipkartRequest,
  FlipkartRequestCoverage
} from '@shared/types/flipkartBackup'
import { FLIPKART_REPORTS } from '@shared/types/flipkartBackup'
import { fail, ok, type Result } from '@shared/types/result'
import { ymd } from '@shared/utils/backupRows'
import { flipkartWindows, toFlipkartRecord } from '@shared/utils/flipkartRows'
import { reportSyncFrom } from '@shared/utils/reportSyncWindow'
import {
  clampToRetention,
  isRetainedMonth,
  retentionRefusal
} from '@shared/utils/backupRetention'
import {
  MAX_REPORT_REQUEST_ATTEMPTS,
  attemptsOf,
  failedToRetry,
  isWindowCovered,
  nextAttempt,
  retryableFor
} from '@shared/utils/reportRequestRetry'
import {
  downloadFlipkartReport,
  flipkartReportContext,
  flipkartReportName,
  isFlipkartReportFailed,
  isFlipkartReportReady,
  listFlipkartReports,
  parseFlipkartReport,
  submitFlipkartReport,
  type FlipkartListRow
} from '../automations/platforms/flipkart/master-import/api-based-flow/reportRequest'
import {
  deleteFlipkartRange,
  eraseFlipkartRows,
  findFlipkartByAwb,
  forgetFlipkartRequests,
  readFlipkartRequests,
  readFlipkartRows,
  readFlipkartSettings,
  readFlipkartState,
  saveFlipkartRecords,
  saveFlipkartRequest,
  writeFlipkartSettings
} from './flipkartBackup.store'
import { pruneFlipkartBackup } from './backupRetention.service'
import { sessionAccounts } from './liveAccounts'
import { logger } from './logger'
import { throwIfStopped } from './automationStop'

/**
 * Backing Flipkart's Orders and Returns reports up locally, so Create Claim can
 * turn a return AWB into the forward AWB, order item id and SKU without asking
 * Flipkart.
 *
 * THE SNAPDEAL FLOW, WITH AN ID TO MATCH ON. Flipkart builds a report over
 * about half an hour, so a pass is:
 *
 *   COLLECT   list the Report Centre, download every outstanding request whose
 *             row is FILE_STORED, keep the four columns a claim needs.
 *   REQUEST   ask for the days since each report was last stored.
 *
 * Collect runs first, so a pass banks what the previous one asked for before
 * queueing more. Unlike Snapdeal, every list row carries the `request_id` the
 * submit answered with, so a file is matched to its request by id.
 *
 * READ, SAVE, NOTHING ELSE: nothing is written back to Flipkart or TrackVid.
 */

/** Days always re-read: a return's pickup AWB is filled in days after it is raised. */
const DAILY_REREAD_DAYS = 7

/** A last stored date older than this is not caught up; the pass reads this many days. */
const FLIPKART_SYNC_CATCH_UP_DAYS = 44

/** A request this old that is not on the list any more is given up on. */
const LOST_AFTER_MS = 2 * 24 * 60 * 60 * 1000

const REPORT_LABEL: Record<FlipkartReport, string> = { forward: 'Orders', return: 'Returns' }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

let running = false

const emptyResult = (username: string, error: string | null = null): FlipkartAccountResult => ({
  username,
  sent: 0,
  skipped: 0,
  stored: 0,
  added: 0,
  pending: 0,
  failed: 0,
  error
})

/* -------------------------------------------------------------------------- *
 * REQUEST
 * -------------------------------------------------------------------------- */

/**
 * Covered when one live request asked for all of it — or when a failed one has
 * been asked as often as it will be (`isWindowCovered`).
 */
const alreadyAsked = isWindowCovered

/**
 * Asks for every window of a range that nothing has asked for, one at a time.
 *
 * `retryFailed` — the daily pass only — also re-asks failed windows OUTSIDE the
 * range. The range starts from the last date stored, so a window refused, or
 * marked failed when its report failed or went missing, sits behind it once a
 * later window lands and would never be asked for again.
 */
const requestRange = async (
  ctx: unknown,
  username: string,
  report: FlipkartReport,
  from: string,
  to: string,
  result: FlipkartAccountResult,
  retryFailed = false
): Promise<void> => {
  const held = (await readFlipkartRequests()).filter(
    record => record.username === username && record.report === report
  )

  /**
   * One ask. `previous` is the failed row for the same window when there is
   * one — re-sent IN PLACE so its attempt count climbs and the cap ends it,
   * rather than a fresh row every pass that would be asked for forever.
   */
  const ask = async (window: { from: string; to: string }, previous: FlipkartRequest | null): Promise<void> => {
    const request: FlipkartRequest = previous
      ? nextAttempt(previous, new Date())
      : {
          id: randomUUID(),
          requestId: null,
          username,
          report,
          from: window.from,
          to: window.to,
          status: 'requested',
          requestedAt: new Date().toISOString(),
          storedAt: null,
          rows: 0,
          added: 0,
          error: null,
          attempts: 1
        }

    try {
      const answer = await submitFlipkartReport(ctx, report, window)

      request.requestId = answer.requestId
      result.sent += 1
      logger.info(
        `[flipkart-backup] ${username}: asked for ${REPORT_LABEL[report]} ${window.from} → ${window.to} ` +
          `(request_id=${answer.requestId}, eta ${answer.eta ?? '?'})`
      )
    } catch (error) {
      // Recorded, not dropped: a refused window is the one thing to act on.
      request.status = 'failed'
      request.error = error instanceof Error ? error.message : String(error)
      result.failed += 1
      logger.warn(
        `[flipkart-backup] ${username}: ${REPORT_LABEL[report]} ${window.from} → ${window.to} refused ` +
          `(attempt ${attemptsOf(request)} of ${MAX_REPORT_REQUEST_ATTEMPTS}): ${request.error}`
      )
    }

    await saveFlipkartRequest(request)

    const at = held.findIndex(record => record.id === request.id)

    if (at >= 0) held.splice(at, 1)
    held.unshift(request)
  }

  for (const window of flipkartWindows(from, to)) {
    throwIfStopped(`Flipkart ${REPORT_LABEL[report]} request`)
    if (alreadyAsked(window, held)) {
      result.skipped += 1
      continue
    }

    await ask(window, retryableFor(window, held))
  }

  // After the range, so a window the range has just covered is not asked twice.
  const retries = retryFailed ? failedToRetry(held, clampToRetention('0000-01-01')) : []

  for (const record of retries) {
    throwIfStopped(`Flipkart ${REPORT_LABEL[report]} retry`)
    if (alreadyAsked(record, held)) continue

    logger.info(
      `[flipkart-backup] ${username}: asking again for ${REPORT_LABEL[report]} ${record.from} → ${record.to} ` +
        `(attempt ${attemptsOf(record) + 1}; last time: ${record.error ?? 'failed'})`
    )
    await ask(record, record)
  }
}

/* -------------------------------------------------------------------------- *
 * COLLECT
 * -------------------------------------------------------------------------- */

const isOutstanding = (record: FlipkartRequest): boolean => record.status === 'requested'

/**
 * Downloads and stores every request of this account that `pick` chooses and
 * Flipkart has finished — by default every outstanding one, which is the
 * scheduled pass. The request calendar narrows it to a range or to one row.
 *
 * A row the operator picked that is NOT outstanding (Store on a stored or
 * failed row) is fetched again if Flipkart still lists it, but its status is
 * never rewritten to failed for being missing — it already ended once.
 *
 * A row with no request id (refused at submit) is matched by report name and
 * window instead: a 502 on submit is often a timeout on a report Flipkart went
 * on to build, and its list row carries the window it was asked for.
 */
const collect = async (
  ctx: unknown,
  username: string,
  result: FlipkartAccountResult,
  pick: (record: FlipkartRequest) => boolean = isOutstanding
): Promise<void> => {
  const outstanding = (await readFlipkartRequests()).filter(
    record => record.username === username && pick(record)
  )

  if (outstanding.length === 0) return

  const list = await listFlipkartReports(ctx, outstanding.length)
  const byId = new Map<string, FlipkartListRow>()

  for (const row of list) if (row.requestId) byId.set(row.requestId, row)

  // A file belongs to at most one request: one already claimed by id is not
  // offered to a refused request with the same window.
  const claimed = new Set(outstanding.flatMap(record => (record.requestId ? [record.requestId] : [])))
  const byWindow = (request: FlipkartRequest): FlipkartListRow | undefined => {
    const name = flipkartReportName(request.report)
    const row = list.find(
      candidate =>
        candidate.requestId &&
        !claimed.has(candidate.requestId) &&
        candidate.reportName === name &&
        candidate.from?.slice(0, 10) === request.from &&
        candidate.to?.slice(0, 10) === request.to &&
        isFlipkartReportReady(candidate)
    )

    if (row?.requestId) claimed.add(row.requestId)

    return row
  }

  const coveredTo: Partial<Record<FlipkartReport, string>> = {}

  for (const request of outstanding) {
    throwIfStopped('Flipkart report download')
    const row = request.requestId ? byId.get(request.requestId) : byWindow(request)

    if (!row) {
      if (isOutstanding(request) && Date.now() - Date.parse(request.requestedAt) > LOST_AFTER_MS) {
        await saveFlipkartRequest({ ...request, status: 'failed', error: "No longer on Flipkart's report list" })
        result.failed += 1
      } else {
        result.pending += 1
      }
      continue
    }

    if (isFlipkartReportFailed(row)) {
      if (isOutstanding(request)) {
        await saveFlipkartRequest({ ...request, status: 'failed', error: `Flipkart marked it ${row.status}` })
      }
      result.failed += 1
      continue
    }

    if (!isFlipkartReportReady(row)) {
      result.pending += 1
      continue
    }

    try {
      const file = await downloadFlipkartReport(ctx, row)
      const records = parseFlipkartReport(request.report, file.buffer)
        .map(raw =>
          toFlipkartRecord(request.report, raw, { username, requestId: request.id, fallbackDate: request.from })
        )
        .filter((record): record is FlipkartRecord => record !== null)
      const saved = await saveFlipkartRecords(request.report, records)

      await saveFlipkartRequest({
        ...request,
        requestId: request.requestId ?? row.requestId,
        status: 'stored',
        storedAt: new Date().toISOString(),
        rows: records.length,
        added: saved.added + saved.updated,
        error: null
      })

      result.stored += 1
      result.added += saved.added + saved.updated
      if (!coveredTo[request.report] || request.to > (coveredTo[request.report] as string)) {
        coveredTo[request.report] = request.to
      }

      logger.info(
        `[flipkart-backup] ${username}: ${REPORT_LABEL[request.report]} ${request.from} → ${request.to} — ` +
          `${records.length} row(s), ${saved.added} new, ${saved.updated} filled in`
      )
    } catch (error) {
      // One file, not the pass: it stays outstanding and the next pass retries.
      result.failed += 1
      logger.warn(
        `[flipkart-backup] ${username}: could not download ${REPORT_LABEL[request.report]} ` +
          `${request.from} → ${request.to}: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  if (Object.keys(coveredTo).length > 0) {
    const current = await readFlipkartSettings()
    const mine = { ...(current.coveredToByAccount?.[username] ?? {}) }

    for (const report of FLIPKART_REPORTS) {
      const to = coveredTo[report]

      if (to && (!mine[report] || to > mine[report])) mine[report] = to
    }

    await writeFlipkartSettings({
      lastStoredAt: new Date().toISOString(),
      coveredToByAccount: { ...(current.coveredToByAccount ?? {}), [username]: mine }
    })
  }
}

/* -------------------------------------------------------------------------- *
 * One account, one pass
 * -------------------------------------------------------------------------- */

const syncAccount = async (username: string, today: string): Promise<FlipkartAccountResult> => {
  const result = emptyResult(username)

  try {
    const ctx = await flipkartReportContext(username)

    await collect(ctx, username, result)

    for (const report of FLIPKART_REPORTS) {
      const last = (await readFlipkartSettings()).coveredToByAccount?.[username]?.[report] ?? null
      const from = clampToRetention(
        reportSyncFrom(last, today, DAILY_REREAD_DAYS, {
          staleDays: FLIPKART_SYNC_CATCH_UP_DAYS,
          fallbackDays: FLIPKART_SYNC_CATCH_UP_DAYS
        })
      )

      logger.info(
        `[flipkart-backup] ${username}: ${REPORT_LABEL[report]} ${from} to ${today} (last stored ${last ?? 'never'})`
      )

      // `true`: a window that failed on an earlier night is asked again here,
      // even once the range has moved past it.
      await requestRange(ctx, username, report, from, today, result, true)
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    logger.warn(`[flipkart-backup] ${username}: ${result.error}`)
  }

  return result
}

/**
 * The scheduled pass, for every Flipkart account with a live session.
 *
 * An account without one is listed as skipped — the stored session is the only
 * way in that does not stop for an emailed code. An empty array means this
 * company has no Flipkart account at all.
 */
export const runDailyFlipkartBackup = async (
  shouldStop: () => boolean = () => false
): Promise<FlipkartAccountResult[]> => {
  if (running) {
    return [emptyResult('—', 'A Flipkart report sync is already running')]
  }

  running = true

  try {
    await pruneFlipkartBackup()

    const { all: accounts, live } = await sessionAccounts('flipkart')

    if (accounts.length === 0) {
      logger.info('[flipkart-backup] skipped — this company has no Flipkart account')

      return []
    }

    const today = ymd(new Date())
    const results: FlipkartAccountResult[] = []

    for (const username of accounts) {
      if (shouldStop()) break

      if (!live.has(username.toLowerCase())) {
        logger.info(`[flipkart-backup] ${username} skipped — no active session`)
        results.push(emptyResult(username, 'Skipped — no active session (update it on the Login page)'))
        continue
      }

      results.push(await syncAccount(username, today))
    }

    await writeFlipkartSettings({ lastRunAt: new Date().toISOString() })

    return results
  } finally {
    running = false
  }
}

/* -------------------------------------------------------------------------- *
 * IPC
 * -------------------------------------------------------------------------- */

/** What is held, for the status line under the schedule task. */
export const flipkartBackupState = async (): Promise<Result<FlipkartBackupState>> =>
  ok(await readFlipkartState())

/**
 * Create Claim: the stored rows for one AWB, joined across the two reports.
 *
 * Local and exact. Null when nothing is held — the backup covers only the
 * windows that have been collected, so a miss is not an error.
 */
export const lookupFlipkartAwb = async (payload: unknown): Promise<Result<FlipkartAwbMatch | null>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const awb = text(input.awb)
  const side: FlipkartReport = input.side === 'forward' ? 'forward' : 'return'

  if (!/^[A-Za-z0-9-]{4,40}$/.test(awb)) return fail('VALIDATION_ERROR', 'That is not an AWB number')

  const { hits, others } = await findFlipkartByAwb(awb, side)
  const hit = hits[0]

  if (!hit) return ok(null)

  const other = others.find(record => record.orderItemId.toUpperCase() === hit.orderItemId.toUpperCase())
  const forward = side === 'forward' ? hit : other
  const back = side === 'return' ? hit : other

  return ok({
    returnAwb: back?.awb || null,
    forwardAwb: forward?.awb || null,
    orderItemId: hit.orderItemId,
    sku: hit.sku || other?.sku || null,
    username: hit.username
  })
}

/* -------------------------------------------------------------------------- *
 * The Settings card
 * -------------------------------------------------------------------------- */

const pad = (value: number): string => String(value).padStart(2, '0')

/** The report a payload names; Returns unless it says Orders. */
const reportOf = (value: unknown): FlipkartReport => (value === 'forward' ? 'forward' : 'return')

/** The most rows one viewer page or search answers with. */
const VIEW_CAP = 2000

/** The card's chosen account and when the backup last ran. */
export const readFlipkartCardState = async (): Promise<Result<FlipkartCardState>> => {
  const held = await readFlipkartSettings()

  return ok({ username: held.username ?? '', lastRunAt: held.lastRunAt, lastStoredAt: held.lastStoredAt })
}

export const saveFlipkartCardState = async (payload: unknown): Promise<Result<FlipkartCardState>> => {
  const username = text((payload as { username?: unknown } | null)?.username)

  await writeFlipkartSettings({ username })

  return readFlipkartCardState()
}

/**
 * What one report HOLDS, month by month and day by day — the card's green
 * chips, the coverage calendar and the viewer's month list. Newest month first.
 */
export const flipkartCoverage = async (payload: unknown): Promise<Result<FlipkartCoverage>> => {
  const report = reportOf((payload as { report?: unknown } | null)?.report)
  const rows = await readFlipkartRows(report)
  const months = new Map<string, FlipkartMonthCoverage>()
  const days = new Map<string, number>()

  for (const record of rows) {
    if (!record.date) continue

    const [year, month] = record.date.split('-').map(Number)
    const key = record.date.slice(0, 7)
    const entry = months.get(key) ?? { year: year ?? 0, month: month ?? 0, rows: 0 }

    entry.rows += 1
    months.set(key, entry)
    days.set(record.date, (days.get(record.date) ?? 0) + 1)
  }

  return ok({
    report,
    months: [...months.values()].sort((a, b) => b.year - a.year || b.month - a.month),
    days: [...days].map(([date, count]) => ({ date, rows: count })),
    rows: rows.length,
    bytes: Buffer.byteLength(JSON.stringify(rows))
  })
}

/** How far a request got, furthest last — what a day covered by several is painted as. */
const STATUS_RANK: Record<FlipkartRequest['status'], number> = { failed: 0, requested: 1, stored: 2 }

/**
 * What was ASKED of Flipkart for one report: every day any request covered,
 * painted by the furthest one got, and the requests themselves.
 */
export const flipkartRequestCoverage = async (payload: unknown): Promise<Result<FlipkartRequestCoverage>> => {
  const report = reportOf((payload as { report?: unknown } | null)?.report)
  const requests = (await readFlipkartRequests()).filter(record => record.report === report)
  const days = new Map<string, FlipkartRequest['status']>()

  for (const request of requests) {
    for (let cursor = Date.parse(`${request.from}T00:00:00Z`); Number.isFinite(cursor); cursor += 86_400_000) {
      const date = new Date(cursor).toISOString().slice(0, 10)

      if (date > request.to) break

      const held = days.get(date)

      if (!held || STATUS_RANK[request.status] > STATUS_RANK[held]) days.set(date, request.status)
    }
  }

  return ok({
    report,
    days: [...days].map(([date, status]) => ({ date, status })),
    requests: requests.slice(0, VIEW_CAP),
    outstanding: requests.filter(isOutstanding).length
  })
}

/**
 * One manual action against Flipkart, under the sync's lock and with the
 * account's stored session — never a sign-in.
 */
const withAccount = async (
  username: string,
  work: (ctx: unknown, result: FlipkartAccountResult) => Promise<void>
): Promise<Result<FlipkartAccountResult>> => {
  if (!username) return fail('VALIDATION_ERROR', 'Choose the Flipkart account to read from')
  if (running) return fail('VALIDATION_ERROR', 'A Flipkart report sync is already running')

  running = true

  try {
    const result = emptyResult(username)

    await work(await flipkartReportContext(username), result)

    return ok(result)
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  } finally {
    running = false
  }
}

/**
 * One month of one report, for the viewer.
 *
 * OPENING A MONTH CAN FETCH, as on the Snapdeal viewer: when the month is
 * empty and a request covering it is still outstanding, those requests are
 * collected first. `fetched` says so, because that takes as long as a download.
 */
export const flipkartMonth = async (
  payload: unknown
): Promise<Result<{ rows: FlipkartRecord[]; fetched: boolean }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const year = Number(input.year)
  const month = Number(input.month)
  const report = reportOf(input.report)

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return fail('VALIDATION_ERROR', 'Choose a month')
  }

  const prefix = `${year}-${pad(month)}`
  const read = async (): Promise<FlipkartRecord[]> =>
    (await readFlipkartRows(report))
      .filter(record => record.date.startsWith(prefix))
      .sort((a, b) => b.date.localeCompare(a.date))
  const held = await read()

  if (held.length > 0) return ok({ rows: held, fetched: false })

  const touches = (record: FlipkartRequest): boolean =>
    isOutstanding(record) && record.report === report && record.from.slice(0, 7) <= prefix && record.to.slice(0, 7) >= prefix
  const accounts = [...new Set((await readFlipkartRequests()).filter(touches).map(record => record.username))]

  if (accounts.length === 0 || running) return ok({ rows: held, fetched: false })

  for (const username of accounts) await withAccount(username, (ctx, result) => collect(ctx, username, result, touches))

  return ok({ rows: await read(), fetched: true })
}

/** Rows of one report carrying this order item, AWB or SKU — a substring, across every month. */
export const searchFlipkartBackup = async (
  payload: unknown
): Promise<Result<{ hits: FlipkartRecord[]; capped: boolean }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const term = text(input.term).toUpperCase()

  if (term.length < 3) return fail('VALIDATION_ERROR', 'Type at least three characters')

  const hits = (await readFlipkartRows(reportOf(input.report))).filter(
    record =>
      record.orderItemId.toUpperCase().includes(term) ||
      record.awb.toUpperCase().includes(term) ||
      record.sku.toUpperCase().includes(term)
  )

  return ok({ hits: hits.slice(0, VIEW_CAP), capped: hits.length > VIEW_CAP })
}

/**
 * A range the operator picked, as it may be asked for: inside the retention
 * window and never past today — Flipkart has nothing for days that have not
 * happened yet.
 */
const askableRange = (from: string, to: string): { from: string; to: string } | string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) {
    return 'Choose a date range'
  }

  const today = ymd(new Date())
  const start = clampToRetention(from)
  const end = to > today ? today : to

  if (end < from) return 'Those days have not happened yet'
  if (end < start) return retentionRefusal()

  return { from: start, to: end }
}

/**
 * "Request" on the card — whole months of the chosen report.
 *
 * Only asks; Flipkart builds the file over about half an hour and Collect now,
 * the request calendar's Download or the scheduled pass fetches it.
 */
export const requestFlipkartMonths = async (payload: unknown): Promise<Result<FlipkartAccountResult>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const year = Number(input.year)
  const fromMonth = Number(input.fromMonth)
  const toMonth = Number(input.toMonth)

  if (!Number.isInteger(year) || !fromMonth || !toMonth || fromMonth > toMonth) {
    return fail('VALIDATION_ERROR', 'Choose the months to request')
  }
  if (!isRetainedMonth(year, fromMonth) || !isRetainedMonth(year, toMonth)) {
    return fail('VALIDATION_ERROR', retentionRefusal())
  }

  const range = askableRange(
    `${year}-${pad(fromMonth)}-01`,
    `${year}-${pad(toMonth)}-${pad(new Date(year, toMonth, 0).getDate())}`
  )

  if (typeof range === 'string') return fail('VALIDATION_ERROR', range)

  const username = text(input.username)
  const report = reportOf(input.report)

  return withAccount(username, (ctx, result) => requestRange(ctx, username, report, range.from, range.to, result))
}

/** "Request" on the request calendar — any range of the chosen report. */
export const requestFlipkartRange = async (payload: unknown): Promise<Result<FlipkartAccountResult>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const range = askableRange(text(input.from), text(input.to))

  if (typeof range === 'string') return fail('VALIDATION_ERROR', range)

  const username = text(input.username)
  const report = reportOf(input.report)

  return withAccount(username, (ctx, result) => requestRange(ctx, username, report, range.from, range.to, result))
}

/** "Collect now" — download and store every report this account has finished, both reports. */
export const collectFlipkartNow = async (payload: unknown): Promise<Result<FlipkartAccountResult>> => {
  const username = text((payload as { username?: unknown } | null)?.username)

  return withAccount(username, (ctx, result) => collect(ctx, username, result))
}

/**
 * "Download" on the request calendar — collect only the outstanding requests
 * of this report that touch the picked days.
 */
export const collectFlipkartRange = async (payload: unknown): Promise<Result<FlipkartAccountResult>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const username = text(input.username)
  const report = reportOf(input.report)
  const from = text(input.from)
  const to = text(input.to)

  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  return withAccount(username, (ctx, result) =>
    collect(
      ctx,
      username,
      result,
      record => isOutstanding(record) && record.report === report && record.from <= to && record.to >= from
    )
  )
}

/**
 * "Store" on one request row — download that request's file and store it,
 * whatever state the row is in, as long as Flipkart still lists it. The way
 * back for a request marked failed after Flipkart had in fact built it — a
 * refused row, with no request id, is matched by its window (see `collect`).
 */
export const collectFlipkartRequest = async (payload: unknown): Promise<Result<FlipkartAccountResult>> => {
  const id = text((payload as { id?: unknown } | null)?.id)
  const request = (await readFlipkartRequests()).find(record => record.id === id)

  if (!request) return fail('NOT_FOUND', 'That request is no longer held')

  return withAccount(request.username, (ctx, result) =>
    collect(ctx, request.username, result, record => record.id === id)
  )
}

/** Removes the rows of one report dated inside a range — the coverage calendar's Delete. */
export const deleteFlipkartBackupRange = async (payload: unknown): Promise<Result<{ removed: number }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const report = reportOf(input.report)
  const from = text(input.from)
  const to = text(input.to)

  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const removed = await deleteFlipkartRange(report, from, to)

  logger.info(`[flipkart-backup] ${REPORT_LABEL[report]} ${from}..${to}: ${removed} row(s) deleted`)

  return ok({ removed })
}

/** Forgets one report's request rows for a range, so those windows can be asked again. */
export const forgetFlipkartBackupRequests = async (payload: unknown): Promise<Result<{ removed: number }>> => {
  const input = (payload ?? {}) as Record<string, unknown>
  const report = reportOf(input.report)
  const from = text(input.from)
  const to = text(input.to)

  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const removed = await forgetFlipkartRequests(report, from, to)

  logger.info(`[flipkart-backup] forgot ${removed} ${REPORT_LABEL[report]} request(s) covering ${from}..${to}`)

  return ok({ removed })
}

/**
 * One report's backup, deleted — confirmed here, in the main process, where
 * the dialog can say what is about to be lost and cannot be clicked past by
 * accident.
 */
export const eraseFlipkartBackup = async (payload: unknown): Promise<Result<{ rows: number }>> => {
  if (running) return fail('VALIDATION_ERROR', 'A Flipkart report sync is running — wait for it to finish')

  const report = reportOf((payload as { report?: unknown } | null)?.report)
  const total = (await readFlipkartRows(report)).length

  if (total === 0) return fail('VALIDATION_ERROR', `Nothing is held for the Flipkart ${REPORT_LABEL[report]} report`)

  const answer = await dialog.showMessageBox({
    type: 'warning',
    // Destructive second, Cancel the default: a stray Return key must not erase.
    buttons: ['Cancel', `Erase ${total.toLocaleString()} rows`],
    defaultId: 0,
    cancelId: 0,
    title: 'Erase this backup?',
    message: `Erase the whole Flipkart ${REPORT_LABEL[report]} report backup?`,
    detail:
      `${total.toLocaleString()} row(s) will be deleted from this machine, and the record of which ` +
      'windows were collected is cleared so the next sync asks for them again.\n\n' +
      'Create Claim fills Flipkart claims from these rows until then. This cannot be undone.'
  })

  if (answer.response !== 1) return fail('VALIDATION_ERROR', 'Cancelled')

  const rows = await eraseFlipkartRows(report)

  logger.info(`[flipkart-backup] erased ${rows} ${REPORT_LABEL[report]} row(s)`)

  return ok({ rows })
}
