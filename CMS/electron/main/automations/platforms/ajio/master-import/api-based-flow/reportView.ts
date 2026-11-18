import { claimCredentials } from '@main/services/claimSession.service'
import { credentialsFor } from '@main/services/company.service'
import { sessionHealth } from '@main/services/platformSession.service'
import { canAuthenticateNow, healthOf } from '@shared/utils/sessionHealth'
import { platformKey } from '@shared/utils/platformKey'
import { loadCore } from '@main/automations/common/coreLoader'
import { leasedSession } from '@main/services/browserLease.service'
import { forwardAwbForOrder, readCoverage, returnOrderRows } from '@main/services/masterBackup.store'
import {
  openSignedInAjioPage,
  type PuppeteerPage
} from '@main/automations/platforms/ajio/common/signedInPage'
import { ensureAjioPobs } from '@main/services/ajioPobSync.service'
import { logger } from '@main/services/logger'
import type { AjioReturnOrderLookup, ReportColumn } from '@shared/types/masterDataReport'

/**
 * Reads one page of an AJIO dropship report.
 *
 * A READ: it writes nothing to AJIO and nothing to TrackVid. The sequence is
 * the core's, so the app and the automation server ask AJIO the same question
 * in the same way.
 *
 * Shares the claim runner's leased browser key (`ajio:<username>`), so opening
 * the report while a run is going borrows the page that is already signed in
 * rather than launching a second one against the same session.
 */

interface AjioReportView {
  fetchDropshipReport: (
    page: PuppeteerPage,
    input: {
      reportType: string
      pobIds: string[]
      from: string
      to: string
      pageNumber?: number
      size?: number
      userLogger?: unknown
    }
  ) => Promise<{
    rows: Record<string, unknown>[]
    pageNumber: number
    totalPages: number
    /** What AJIO says the window holds. Null when it does not say. */
    totalElements: number | null
    columns: ReportColumn[]
  }>
  findReturnOrder: (
    page: PuppeteerPage,
    input: { returnOrderNo: string; pobIds: string[]; months?: number; userLogger?: unknown }
  ) => Promise<{
    rows: Record<string, unknown>[]
    window: { from: string; to: string } | null
    searched: number
  }>
  /** The forward leg, from the customer order number — see the core. */
  findForwardAwb: (
    page: PuppeteerPage,
    input: {
      orderNo: string
      pobIds: string[]
      months?: number
      /** ISO day the return was created: the order precedes it. */
      on?: string
      userLogger?: unknown
    }
  ) => Promise<{ awbNumber: string | null; row: Record<string, unknown> | null; searched: number }>
}

export const readAjioDropshipReport = async (input: {
  username: string
  reportType: string
  from: string
  to: string
  pageNumber: number
  size: number
  /**
   * A subset of the account's POBs, when the operator narrowed it. Empty means
   * all of them — the report's default scope.
   */
  pobIds?: string[]
}): Promise<{
  rows: Record<string, unknown>[]
  pageNumber: number
  totalPages: number
  /**
   * What AJIO says the window holds, against what it will actually serve.
   *
   * `totalPages` cannot tell a finished month from a truncated one — AJIO
   * answers 100 for every month, and 100 pages of 100 rows is exactly the
   * 10,000-row result window. This is the only field that can say which.
   */
  totalElements: number | null
  columns: ReportColumn[]
  pobCount: number
  pobIds: string[]
}> => {
  // The POBs are the report's whole scope: AJIO answers an empty list with an
  // empty report, which reads as "this seller had nothing". None stored means
  // they are fetched from AJIO first and the read carries on.
  const available = await ensureAjioPobs(input.username)
  // Narrowed to what the operator chose, but only to POBs this account actually
  // has: a stale selection from another account would otherwise silently ask
  // AJIO about places of business that are not its own.
  const chosen = (input.pobIds ?? []).filter(id => available.includes(id))
  const pobIds = chosen.length > 0 ? chosen : available

  const credentials = await claimCredentials('ajio', input.username)

  const { fetchDropshipReport } = loadCore<AjioReportView>(
    'platforms/ajio/master-import/api-based-flow/reportView'
  )

  const { page, release } = await leasedSession(`ajio:${input.username}`, async () => {
    const opened = await openSignedInAjioPage({
      username: input.username,
      password: credentials.password
    })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    const answer = await fetchDropshipReport(page as PuppeteerPage, {
      reportType: input.reportType,
      pobIds,
      from: input.from,
      to: input.to,
      pageNumber: input.pageNumber,
      size: input.size,
      userLogger: logger
    })

    return { ...answer, pobCount: pobIds.length, pobIds }
  } finally {
    // A no-op while a run holds the lease; a real close when it does not.
    await release()
  }
}

/** A string field of an AJIO row, or null when it is blank. */
const field = (row: Record<string, unknown>, key: string): string | null => {
  const value = row[key]

  if (typeof value !== 'string' && typeof value !== 'number') return null

  const trimmed = String(value).trim()

  return trimmed.length > 0 ? trimmed : null
}

/**
 * Every line of one return order, searched for across the last five 31-day
 * windows — AJIO will not answer a wider one.
 *
 * Asks under ALL of the account's POBs: the operator knows the return order,
 * not which place of business it came back to, and finding that out is half of
 * what the lookup is for.
 *
 * Shares the leased browser like the report above, so a lookup while a run is
 * signed in borrows its page instead of signing in again.
 */
const searchOneAccount = async (input: {
  username: string
  returnOrderNo: string
}): Promise<AjioReturnOrderLookup> => {
  // None stored: fetched from AJIO first, then the search carries on.
  const pobIds = await ensureAjioPobs(input.username)

  const credentials = await claimCredentials('ajio', input.username)

  const { findReturnOrder, findForwardAwb } = loadCore<AjioReportView>(
    'platforms/ajio/master-import/api-based-flow/reportView'
  )

  const { page, release } = await leasedSession(`ajio:${input.username}`, async () => {
    const opened = await openSignedInAjioPage({
      username: input.username,
      password: credentials.password
    })

    return { browser: opened.browser, page: opened.page, context: { sellerId: opened.sellerId } }
  })

  try {
    // `months` is deliberately NOT passed: the core's
    // AJIO_RETURN_SEARCH_MONTHS is the one place it is set, so changing how
    // far back the lookup reaches changes it for both runners at once.
    const found = await findReturnOrder(page as PuppeteerPage, {
      returnOrderNo: input.returnOrderNo,
      pobIds,
      userLogger: logger
    })

    const lines = found.rows.map(row => ({
      returnOrderNo: field(row, 'returnOrderNo') ?? input.returnOrderNo,
      returnAwbNo: field(row, 'returnAwbNo'),
      fwdAwbNo: field(row, 'fwdAwbNo'),
      ean: field(row, 'ean'),
      pobId: field(row, 'pobId'),
      sellerSku: field(row, 'sellerSku'),
      jioCode: field(row, 'jioCode'),
      custOrderNo: field(row, 'custOrderNo'),
      returnCreateDate: field(row, 'returnCreateDate'),
      returnStatus: field(row, 'returnStatus'),
      returnType: field(row, 'returnType'),
      brand: field(row, 'brand')
    }))

    /*
     * THE FORWARD LEG, WHEN THE RETURN LINE DOES NOT CARRY IT.
     *
     * `fwdAwbNo` is often null on the return report — AJIO simply does not hold
     * the forward AWB there — and a claim needs it. The forward report does
     * have it, as `awbNumber`, keyed on the customer order number the return
     * line DID give us.
     *
     * ONE LOOKUP PER ORDER NUMBER, not per line: a return order's lines share
     * their customer order, and asking once per line would repeat the same
     * search three times for a three-article return.
     *
     * ANCHORED TO THE RETURN'S DATE, because the order always precedes it —
     * see `findForwardAwb`.
     *
     * Best effort. A forward AWB that cannot be found leaves the field blank
     * for the operator to fill, which is where it was before; failing the whole
     * lookup over it would throw away the return data that DID arrive.
     */
    const needed = new Map<string, string | null>()

    for (const line of lines) {
      if (line.fwdAwbNo || !line.custOrderNo) continue
      if (!needed.has(line.custOrderNo)) needed.set(line.custOrderNo, line.returnCreateDate)
    }

    for (const [orderNo, on] of needed) {
      try {
        const forward = await findForwardAwb(page as PuppeteerPage, {
          orderNo,
          pobIds,
          ...(on ? { on } : {}),
          userLogger: logger
        })

        if (!forward.awbNumber) continue

        for (const line of lines) {
          if (!line.fwdAwbNo && line.custOrderNo === orderNo) line.fwdAwbNo = forward.awbNumber
        }
      } catch (error) {
        logger.warn(`[master-report] forward AWB for ${orderNo} could not be read`, error)
      }
    }

    return {
      window: found.window,
      searched: found.searched,
      lines,
      source: 'api',
      username: input.username
    }
  } finally {
    await release()
  }
}

/**
 * AJIO accounts whose saved session can be used right now, lower-cased.
 *
 * Only an ORDERING hint for the sweep — never a filter. An account with no live
 * session is still asked, it just goes last, because asking it means opening a
 * browser and signing in while somebody waits at the form.
 *
 * An unanswerable health read orders nothing and excludes nothing: the sweep
 * then runs in the order the accounts are stored, which is what it did before
 * this existed.
 */
const platformsWithLiveAjioSessions = async (): Promise<Set<string>> => {
  try {
    const health = await sessionHealth()

    if (!health.success) return new Set()

    const ajio = health.data.find(entry => platformKey(entry.platform) === 'ajio')

    return new Set(
      (ajio?.credentials ?? [])
        .filter(credential => canAuthenticateNow(healthOf(credential.session)))
        .map(credential => credential.username.trim().toLowerCase())
    )
  } catch {
    return new Set()
  }
}

/**
 * The same lookup, across EVERY AJIO account this company holds.
 *
 * WHY SWEEPING IS NEEDED. The return report answers only under the POBs of the
 * account that asks, so a return order belonging to a second AJIO login came
 * back "not found on AJIO in the last 155 days" — confidently wrong, with
 * nothing to suggest trying another account. The return AWB field has never had
 * this problem: it resolves the owning account from master data. A return ORDER
 * number has no such index, so the only way to find it is to ask.
 *
 * THE CHOSEN ACCOUNT FIRST, ALWAYS. It is right nearly every time, and when it
 * is, nothing else is opened at all.
 *
 * THEN THE ONES ALREADY SIGNED IN, then the rest. Every account searched needs
 * a signed-in page, and the ones holding a live session cost nothing to use
 * while the others open a browser and sign in — with an operator waiting at the
 * form. Cheapest first means the common case stays fast and the expensive case
 * still completes.
 *
 * AN ACCOUNT THAT CANNOT BE ASKED IS SKIPPED, not fatal: no POBs synced, a
 * refused password, a sign-in that fails. One unusable login must not stop the
 * sweep reaching the account that has the order — that was the whole complaint.
 */
export const findAjioReturnOrder = async (input: {
  username: string
  returnOrderNo: string
}): Promise<AjioReturnOrderLookup> => {
  const chosen = input.username.trim()
  const all = await credentialsFor('ajio')
  const live = await platformsWithLiveAjioSessions()

  const others = all
    .map(credential => credential.username.trim())
    .filter(username => username.length > 0 && username.toLowerCase() !== chosen.toLowerCase())
    .sort((a, b) => Number(live.has(b.toLowerCase())) - Number(live.has(a.toLowerCase())))

  const order = [chosen, ...others]
  const failures: string[] = []

  for (const [index, username] of order.entries()) {
    try {
      if (index > 0) {
        logger.info(
          `[master-report] ${input.returnOrderNo}: not under ${order[index - 1]} — ` +
            `trying ${username}`
        )
      }

      const found = await searchOneAccount({ username, returnOrderNo: input.returnOrderNo })

      if (found.lines.length > 0) return found
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logger.warn(`[master-report] ${input.returnOrderNo}: ${username} could not be asked — ${message}`)
      failures.push(`${username}: ${message}`)
    }
  }

  /*
   * Nobody had it. Reported as an empty answer rather than an error, so the
   * form says "not found" — unless NO account could even be asked, which is a
   * different thing and must not read as "this order does not exist".
   */
  if (failures.length === order.length) {
    throw new Error(`No AJIO account could be searched — ${failures[0]}`)
  }

  return { lines: [], window: null, searched: 0, source: 'api', username: chosen }
}

/**
 * The same return order, out of this machine's backup instead of AJIO.
 *
 * WHAT IT TRADES. No login, no browser, no page walk — an answer in
 * milliseconds. In exchange it can only know what the nightly AJIO report sync
 * has already downloaded: a return created since the last sync is simply not
 * there, and neither is one from before the backup starts.
 *
 * THE FORWARD AWB IS NOT CHASED HERE. The API path falls back to the forward
 * report when the return line has no `fwdAwbNo`; doing that from the backup
 * would mean a second scan of every forward month — and the whole point of this
 * source is that it does not go looking. A blank forward AWB stays blank, and
 * the operator can switch to the API source if they need it filled.
 *
 * NO ACCOUNT SWEEP EITHER, and for a better reason than cost: the backup is not
 * stored per account. Whatever the sync downloaded is in it, so the order is
 * found or it is not — there is nothing to sweep.
 */
export const findReturnOrderInBackup = async (input: {
  username: string
  returnOrderNo: string
}): Promise<AjioReturnOrderLookup> => {
  const found = await returnOrderRows(input.returnOrderNo)

  if (!found) {
    /*
     * SAY WHAT WAS SEARCHED, not just that nothing matched.
     *
     * A backup that stops in July and a return order that does not exist give
     * the same empty answer, and only the first is something an operator can
     * do anything about — they run the AJIO report sync. The dates are what
     * tell them apart.
     */
    const coverage = await readCoverage('return').catch(() => null)
    const days = coverage?.days ?? []

    return {
      lines: [],
      window: null,
      searched: 0,
      source: 'report',
      username: input.username,
      coverage:
        days.length > 0
          ? { from: days[0]?.date ?? '', to: days[days.length - 1]?.date ?? '' }
          : null
    }
  }

  /*
   * THE FORWARD LEG, FROM THE BACKUP'S OWN FORWARD REPORT.
   *
   * The return line's `fwdAwbNo` is very often null, and a claim needs it. The
   * API source chases it live; this asks the same question of what the nightly
   * sync downloaded, keyed on the customer order number the return line gave
   * us — so the Report source stays what it promises to be: no login, no
   * network, no AJIO request.
   *
   * ONE LOOKUP PER ORDER NUMBER, not per line: a return order's lines share
   * their customer order.
   */
  const forwardByOrder = new Map<string, string | null>()

  for (const row of found.rows) {
    const order = field(row, 'custOrderNo')

    if (!order || field(row, 'fwdAwbNo') || forwardByOrder.has(order)) continue

    forwardByOrder.set(order, await forwardAwbForOrder(order).catch(() => null))
  }

  return {
    source: 'report',
    // The month the rows came from, in the same shape the API path reports its
    // window — so the form can say where the answer came from either way.
    window: {
      from: `${found.year}-${String(found.month).padStart(2, '0')}-01`,
      to: `${found.year}-${String(found.month).padStart(2, '0')}-31`
    },
    searched: 1,
    username: input.username,
    lines: found.rows.map(row => ({
      returnOrderNo: field(row, 'returnOrderNo') ?? input.returnOrderNo,
      returnAwbNo: field(row, 'returnAwbNo'),
      fwdAwbNo:
        field(row, 'fwdAwbNo') ?? forwardByOrder.get(field(row, 'custOrderNo') ?? '') ?? null,
      ean: field(row, 'ean'),
      pobId: field(row, 'pobId'),
      sellerSku: field(row, 'sellerSku'),
      jioCode: field(row, 'jioCode'),
      custOrderNo: field(row, 'custOrderNo'),
      returnCreateDate: field(row, 'returnCreateDate'),
      returnStatus: field(row, 'returnStatus'),
      returnType: field(row, 'returnType'),
      brand: field(row, 'brand')
    }))
  }
}
