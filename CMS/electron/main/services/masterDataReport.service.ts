import { MASTER_REPORT_CHANNELS } from '@shared/constants/channels'
import type {
  AjioReturnOrderLookup,
  ReportAccount,
  ReportPage,
  ReportType
} from '@shared/types/masterDataReport'
import { fail, ok, type Result } from '@shared/types/result'
import { credentialsFor, orderedPobIds } from './company.service'
import { withAutomationLock } from './automationLock'
import { loadCore } from '../automations/common/coreLoader'
import {
  findAjioReturnOrder,
  findReturnOrderInBackup,
  readAjioDropshipReport
} from '../automations/platforms/ajio/master-import/api-based-flow/reportView'
import { logger } from './logger'

/**
 * "Check master data" — AJIO's own reports, read live.
 *
 * A READ, and the only one of these tools that is. It writes nothing to AJIO
 * and nothing to TrackVid: it exists so an operator looking at a claim can see
 * what AJIO actually holds for that window, which is the question behind most
 * "why did this fail" investigations and the one that otherwise means leaving
 * for the seller portal.
 *
 * AJIO only. The two endpoints are its own, and no other marketplace here
 * exposes anything comparable.
 */

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

interface ReportRules {
  REPORT_TYPES: string[]
  reportDescriptor: (type: string) => { label: string } | null
  MAX_PAGE_SIZE: number
}

const rules = (): ReportRules =>
  loadCore<ReportRules>('platforms/ajio/master-import/api-based-flow/reportView')

/**
 * The AJIO accounts a report can be read from.
 *
 * Every account is listed, including those with no POBs — with the count, so an
 * operator can see WHY one of them cannot be reported on instead of wondering
 * where it went. The report itself refuses those with a message naming Sync
 * POBs.
 */
export const reportAccounts = async (): Promise<Result<ReportAccount[]>> => {
  const accounts = await credentialsFor('ajio')

  return ok(
    accounts
      .filter(account => account.username.length > 0)
      .map(account => {
        const pobIds = orderedPobIds(account.pobIds)

        return { username: account.username, pobCount: pobIds.length, pobIds }
      })
  )
}

/** One page of one report. */
export const reportPage = async (payload: unknown): Promise<Result<ReportPage>> => {
  const request = (payload ?? {}) as {
    reportType?: unknown
    username?: unknown
    from?: unknown
    to?: unknown
    page?: unknown
    size?: unknown
    /** A subset of the account's POBs. Absent or empty means all of them. */
    pobIds?: unknown
  }

  const reportType = text(request.reportType).toLowerCase() as ReportType
  const username = text(request.username)
  const from = text(request.from)
  const to = text(request.to)

  const { REPORT_TYPES } = rules()

  if (!REPORT_TYPES.includes(reportType)) {
    return fail('VALIDATION_ERROR', `"${reportType || 'none'}" is not a report this app can read`)
  }
  if (!username) return fail('VALIDATION_ERROR', 'Choose the AJIO account to read the report from')
  if (!from || !to) return fail('VALIDATION_ERROR', 'Choose a date range')

  const pobIds = Array.isArray(request.pobIds)
    ? request.pobIds.map(id => text(id)).filter(id => id.length > 0)
    : []

  // Takes the lock like any other browser work — it may open a marketplace
  // session, and two of those at once is what the lock prevents. While a run
  // holds a signed-in AJIO page this borrows it and costs nothing.
  return withAutomationLock('master-report', () => readReportPage({ ...request, pobIds }))
}

/**
 * The same read, WITHOUT taking the automation lock.
 *
 * For a caller that already holds it and wants several pages at once — the
 * backup, which reads every selected month in parallel. Taking the lock per
 * page made those months queue behind each other one request at a time: nine
 * months asked for nine page 1s, and got them one after another, which is the
 * sequential run the parallelism was meant to replace.
 *
 * NOT exported to the renderer, and not safe to call cold: it assumes the lock
 * is held and the signed-in page already open, because nine callers arriving at
 * once with no browser open would each start one.
 */
export const readReportPage = async (payload: unknown): Promise<Result<ReportPage>> => {
  const request = (payload ?? {}) as {
    reportType?: unknown
    username?: unknown
    from?: unknown
    to?: unknown
    page?: unknown
    size?: unknown
    pobIds?: unknown
  }
  const reportType = text(request.reportType) as ReportType
  const username = text(request.username)
  const from = text(request.from)
  const to = text(request.to)
  const pobIds = Array.isArray(request.pobIds)
    ? request.pobIds.map(id => text(id)).filter(id => id.length > 0)
    : []
  const pageNumber = Math.max(0, Number(request.page) || 0)
  const size = Math.min(Math.max(1, Number(request.size) || 50), rules().MAX_PAGE_SIZE)

  {
    try {
      const answer = await readAjioDropshipReport({
        username,
        reportType,
        from,
        to,
        pageNumber,
        size,
        pobIds
      })

      logger.info(
        `[master-report] ${reportType} ${from}..${to} for ${username}: ` +
          `${answer.rows.length} row(s), page ${answer.pageNumber + 1} of ${answer.totalPages}`
      )

      return ok({ reportType, username, ...answer })
    } catch (error) {
      // AJIO's own wording is the actionable one ("No POBs are stored for …"),
      // so it is passed through rather than flattened.
      return fail(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Could not read the report from AJIO'
      )
    }
  }
}

/** AJIO return order numbers look like "RT229843479". Anything else is a typo. */
const RETURN_ORDER_NO = /^[A-Za-z]{1,4}\d{5,}$/

/**
 * Every line of one AJIO return order — Create Claim's "Return Order Number".
 *
 * Takes the automation lock for the same reason the report does: it may sign in.
 */
/**
 * Record the operator's choice of lookup source, in the log they can see.
 *
 * Fire-and-forget: nothing depends on the answer, and a logging call that
 * could fail a toggle would be worse than no logging at all.
 */
export const noteLookupSource = (payload: unknown): Promise<Result<true>> => {
  const asked = text((payload as { source?: unknown })?.source)

  logger.info(
    `[master-report] lookup source set to ${asked === 'report' ? 'REPORT (this machine\'s backup)' : 'API (ask AJIO now)'}`
  )

  return Promise.resolve(ok(true))
}

export const returnOrderLookup = async (payload: unknown): Promise<Result<AjioReturnOrderLookup>> => {
  const request = (payload ?? {}) as {
    username?: unknown
    returnOrderNo?: unknown
    source?: unknown
  }
  const username = text(request.username)
  const returnOrderNo = text(request.returnOrderNo).toUpperCase()
  /*
   * WHICH SOURCE, chosen on the form.
   *
   *   api     ask AJIO now — always current, needs a signed-in browser, and
   *           walks a month of pages per window per account
   *   report  read what the nightly AJIO report sync downloaded — instant, no
   *           login, and only as complete as the backup is
   *
   * Defaults to `api`, which is what this did before the choice existed.
   */
  const asked = text(request.source)
  const source = asked === 'report' ? 'report' : 'api'

  /*
   * SAID OUT LOUD, EVERY TIME.
   *
   * "Report is selected but AJIO is being called" is a claim about a value
   * that crosses the renderer, the IPC bridge and this function, and none of
   * those three could be checked from the log. One line ends the argument: it
   * prints what ARRIVED, not what was meant.
   *
   * An empty `asked` is worth its own warning — it means the caller sent no
   * source at all, which is a renderer that has not been rebuilt rather than a
   * routing fault here.
   */
  logger.info(
    asked === ''
      ? `[master-report] ${returnOrderNo}: no source given — defaulting to AJIO ` +
          '(an older renderer bundle does not send one)'
      : `[master-report] ${returnOrderNo}: source "${asked}" → ${source}`
  )

  if (!username) return fail('VALIDATION_ERROR', 'Choose the AJIO account first')
  if (!RETURN_ORDER_NO.test(returnOrderNo)) {
    return fail('VALIDATION_ERROR', `"${returnOrderNo}" is not an AJIO return order number`)
  }

  /*
   * NO BROWSER, SO NO LOCK. The backup is a local read; taking the automation
   * lock for it would queue an instant lookup behind whatever hour-long run
   * happens to hold the browser — for a question that never needed one.
   */
  if (source === 'report') {
    const found = await findReturnOrderInBackup({ username, returnOrderNo })

    logger.info(
      `[master-report] return ${returnOrderNo} for ${username}: ${found.lines.length} line(s) ` +
        'from this machine\'s REPORT BACKUP — no AJIO request was made'
    )

    return ok(found)
  }

  return withAutomationLock('ajio-return-order', async () => {
    try {
      const found = await findAjioReturnOrder({ username, returnOrderNo })

      logger.info(
        `[master-report] return ${returnOrderNo} for ${username}: ${found.lines.length} line(s) ` +
          `after ${found.searched} window(s)`
      )

      return ok(found)
    } catch (error) {
      return fail(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Could not look the return order up on AJIO'
      )
    }
  })
}

/** Registered by the IPC layer; exported for the channel names it uses. */
export const MASTER_REPORT = MASTER_REPORT_CHANNELS
