import { read as readWorkbook, utils as sheetUtils } from 'xlsx'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { keepSession } from '@main/automations/common/keepSession'
import { reusableSession } from '@main/services/sessionReuse.service'
import { rememberSessionRejected } from '@main/services/sessionRejection.store'
import { credentialSecret } from '@main/services/credentialSecret.service'
import { credentialFor } from '@main/services/company.service'
import { snapdealApiDate } from '@shared/utils/snapdealRows'
import { logger } from '@main/services/logger'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'

/**
 * Asking Snapdeal for a report, and fetching it once it exists.
 *
 * THE PORTAL DOES NOT ANSWER WITH DATA. `generateReport` answers with a
 * requestId and an ETA; the rows are built server-side over the following
 * minutes and appear as a row on the Reports list, which only then carries the
 * token the file is downloaded with. Three calls, separated in time — which is
 * why the backup that uses this is built around a request table rather than
 * around a loop.
 *
 * Every step is the core's own (`platforms/snapdeal/master-import/
 * api-based-flow/apiReportFlow`), so this app and the automation server ask
 * Snapdeal the same question in the same way. This file is orchestration: the
 * sign-in, the window, and turning the downloaded spreadsheet into rows.
 *
 * WHY THE requestId CANNOT FETCH THE FILE. The Reports list rows carry
 * `{ name, status, code, area, subArea, startTime, endTime }` and no id of any
 * kind, and every row of this report is named "Dropship Return Acknowledged".
 * So the requestId is a receipt, not a handle: it is kept against our own
 * request row and quoted in logs, while the download is resolved through the
 * list and matched on the window in the file's own name. See
 * `snapdealFileWindow`.
 */

/** The core's config key for the dropship return report. */
const IMPORT_TYPE = 'returnOrderData'

/** Snapdeal's reports-list statuses. "PEN" is still building, not a failure. */
const COMPLETE = new Set(['CMP', 'COMPLETED'])

/** The page size Snapdeal's own Reports tab asks for (captured: `pageSize=20`). */
const LIST_PAGE = 20

/** India's offset: Snapdeal stamps a report's window as midnight IST, in epoch ms. */
const IST_OFFSET_MS = 330 * 60 * 1000

/** An epoch-ms midnight IST as `yyyy-MM-dd`, or null. */
const istDate = (value: unknown): string | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10)
    : null

interface ScheduleResult {
  requestId?: string | null
  reportName: string
  listCategory: string
  subArea: string
  portalReportName: string
}

export interface SnapdealReportRow {
  name: string | null
  status: string
  code: string | null
  subArea: string | null
  startTime: number | null
  /** Built by the core from subArea + code; absent until the report completes. */
  downloadHref: string | null
  /** The row as Snapdeal sent it — carries `reportStartDate` / `reportEndDate`. */
  raw?: Record<string, unknown> | undefined
  /**
   * The window the report holds, `yyyy-MM-dd`, read from the row itself — null
   * on old rows that predate Snapdeal adding it.
   */
  window?: { from: string; to: string } | null
}

interface ReportFlow {
  loginMasterData: (
    username: string,
    password: string,
    credentialId?: string,
    options?: { forceFresh?: boolean }
  ) => Promise<unknown>
  scheduleReport: (
    jar: unknown,
    importType: string,
    range: { from: string; to: string }
  ) => Promise<ScheduleResult>
  listReports: (
    jar: unknown,
    options?: { category?: string; pageSize?: number; start?: number }
  ) => Promise<SnapdealReportRow[]>
  downloadReport: (
    jar: unknown,
    href: string
  ) => Promise<{ buffer: Buffer; filename?: string; contentType?: string }>
  getImportTypeApiConfig: (importType: string) => Record<string, unknown>
}

const flow = (): ReportFlow =>
  loadCore<ReportFlow>('platforms/snapdeal/master-import/api-based-flow/apiReportFlow')

/* -------------------------------------------------------------------------- *
 * The session
 * -------------------------------------------------------------------------- */

/**
 * One cookie jar per account, held for as long as the app runs.
 *
 * A backup pass makes one `generateReport` call per window and one list call,
 * then comes back minutes later to download — signing in for each of those
 * would be several browser launches for a few HTTP requests. The jar is
 * cheap to keep and Snapdeal's own session outlives a pass comfortably.
 *
 * Dropped on an auth failure rather than refreshed in place, so the next call
 * signs in again instead of retrying with a jar the portal has already
 * rejected.
 */
const jars = new Map<string, unknown>()

/**
 * A session Snapdeal no longer honours.
 *
 * The core flags 401/403 and a bounce to the login page as `AUTH_EXPIRED`.
 * Snapdeal now also answers a lapsed session with HTTP 422 and an empty body —
 * on every endpoint, whatever the headers, while the same calls with no
 * cookies at all answer 502 — so a 422 is read as the same thing.
 */
const isAuthError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : ''

  return (
    (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'AUTH_EXPIRED') ||
    /session expired/i.test(message) ||
    /failed: HTTP 422(?!\d)/.test(message)
  )
}

export const forgetSnapdealJar = (username: string): void => {
  jars.delete(username)
}

/**
 * A signed-in jar for this account.
 *
 * Auth is HYBRID — the core bootstraps cookies with Puppeteer before axios
 * takes over — so this needs the browser half of the preparation even though
 * every report call is plain HTTP.
 */
export const snapdealJar = async (
  username: string,
  onProgress?: (message: string) => void,
  options: { fresh?: boolean } = {}
): Promise<unknown> => {
  const held = options.fresh ? undefined : jars.get(username)

  if (held) return held

  await prepareCoreWithBrowser(onProgress, 'snapdeal')

  // A stored session that PROVES it still works skips the sign-in entirely.
  // Not after a refusal: the stored session is the one Snapdeal just turned
  // down, and the reuse check cannot always tell (it reads a 422 as "no clear
  // answer" and falls back to a probe that passes).
  const reuse = options.fresh
    ? { session: null, detail: 'the saved login was refused' }
    : await reusableSession('snapdeal', username)

  if (reuse.session?.jar) {
    jars.set(username, reuse.session.jar)

    return reuse.session.jar
  }

  // NO SIGN-IN FROM A REPORT SYNC — the Login update owns that (signInPolicy).
  refuseSignInUnlessAllowed('snapdeal', username, reuse.detail)

  const secret = await credentialSecret('snapdeal', username)

  if (!secret.success) throw new Error(secret.error.message)

  onProgress?.(`Signing in to Snapdeal — ${reuse.detail}`)

  const stored = await credentialFor('snapdeal', username)
  // `forceFresh` after a refusal: the core keeps its own session cache, and
  // without it the sign-in would hand back the same refused cookies.
  const jar = await flow().loginMasterData(
    username,
    secret.data.password,
    stored?.credentialId,
    { forceFresh: options.fresh === true }
  )

  // Kept so the next pass can skip the sign-in.
  await keepSession('snapdeal', username, jar, {}, onProgress)
  jars.set(username, jar)

  return jar
}

/** Runs `work` with a jar, signing in again once if the session has lapsed. */
const withJar = async <T>(
  username: string,
  work: (jar: unknown) => Promise<T>,
  onProgress?: (message: string) => void
): Promise<T> => {
  try {
    return await work(await snapdealJar(username, onProgress))
  } catch (error) {
    if (!isAuthError(error)) throw error

    // The jar the portal just rejected is worse than none: dropped, not reused.
    logger.warn(`[snapdeal-backup] session lapsed for ${username} — signing in again`)
    forgetSnapdealJar(username)

    // Shown on the Login page, so the account reads "rejected" there rather
    // than "Saved" while every report call is being turned away.
    await rememberSessionRejected(
      'snapdeal',
      username,
      'Snapdeal refused the saved login (HTTP 422) — it is signed out'
    ).catch(() => undefined)

    let jar: unknown

    try {
      jar = await snapdealJar(username, onProgress, { fresh: true })
    } catch (signIn) {
      // Usually "Auto-login is turned off" — which, on its own, does not say
      // that the saved login is the thing that stopped working.
      throw new Error(
        'Snapdeal refused the saved login — capture the session again on the Login page. ' +
          `(Signing in again failed: ${signIn instanceof Error ? signIn.message : String(signIn)})`,
        { cause: signIn }
      )
    }

    return work(jar)
  }
}

/* -------------------------------------------------------------------------- *
 * The three calls
 * -------------------------------------------------------------------------- */

export interface RequestedReport {
  requestId: string | null
  reportName: string
  listCategory: string
  subArea: string
}

/**
 * Ask Snapdeal to build one window.
 *
 * Returns the receipt. Nothing is downloadable yet — `generationStatus: false`
 * is a refusal the core turns into a throw, and the caller records it against
 * the window rather than retrying: a window Snapdeal will not serve does not
 * become servable by asking again immediately.
 */
export const requestSnapdealReport = async (input: {
  username: string
  from: string
  to: string
  onProgress?: ((message: string) => void) | undefined
}): Promise<RequestedReport> => {
  const scheduled = await withJar(
    input.username,
    jar =>
      flow().scheduleReport(jar, IMPORT_TYPE, {
        from: snapdealApiDate(input.from),
        to: snapdealApiDate(input.to)
      }),
    input.onProgress
  )

  logger.info(
    `[snapdeal-backup] asked for ${input.from} → ${input.to} ` +
      `(requestId=${scheduled.requestId || '?'})`
  )

  return {
    requestId: scheduled.requestId ?? null,
    reportName: scheduled.reportName,
    listCategory: scheduled.listCategory,
    subArea: scheduled.subArea
  }
}

/**
 * The reports Snapdeal has finished building, newest first.
 *
 * `pageSize` is generous on purpose: a month is two windows and a year is
 * twenty-six, so a pass that asked for several months at once has to see all
 * of them on one page or it will chase a report that is sitting just past the
 * end of the list.
 */
export const completedSnapdealReports = async (input: {
  username: string
  pageSize?: number | undefined
  onProgress?: ((message: string) => void) | undefined
}): Promise<SnapdealReportRow[]> => {
  const config = flow().getImportTypeApiConfig(IMPORT_TYPE)
  const category = typeof config.listCategory === 'string' ? config.listCategory : 'Returns'

  // PAGED AT THE PORTAL'S OWN SIZE — its Reports tab asks for 20 at a time.
  // The same reach is walked twenty rows at a time, stopping at the first
  // short page.
  //
  // Whether `start` counts rows or pages is not documented anywhere we hold,
  // so the second request answers it: `start=1` overlapping the first page
  // means rows (the offset slid by one); a disjoint page means page numbers.
  const wanted = input.pageSize ?? 50
  const rows = await withJar(
    input.username,
    async jar => {
      const list = (start: number): Promise<SnapdealReportRow[]> =>
        flow().listReports(jar, { category, pageSize: LIST_PAGE, start })
      const identity = (row: SnapdealReportRow): string =>
        `${row.name ?? ''}|${row.startTime ?? ''}|${row.status}|${row.code ?? ''}`

      const all = await list(0)

      if (all.length < LIST_PAGE) return all

      const seen = new Set(all.map(identity))
      const probe = await list(1)
      const byRows = probe.some(row => seen.has(identity(row)))
      const add = (page: SnapdealReportRow[]): void => {
        for (const row of page) {
          if (seen.has(identity(row))) continue
          seen.add(identity(row))
          all.push(row)
        }
      }

      add(probe)

      // Rows: the probe covered rows 1–20, so the next page starts at 21.
      // Pages: the probe WAS page 1, so the next is page 2.
      const step = byRows ? LIST_PAGE : 1
      let last = probe

      for (let start = byRows ? 1 + LIST_PAGE : 2; last.length >= LIST_PAGE && all.length < wanted; start += step) {
        last = await list(start)
        add(last)
      }

      return all
    },
    input.onProgress
  )

  // ONLY THIS REPORT. `category=Returns` also lists "Dropship Return
  // Delivered" (subArea ReturnsDlvrd), which is a different file.
  const subArea = typeof config.subArea === 'string' ? config.subArea : null

  return rows
    .filter(row => COMPLETE.has(String(row.status || '').toUpperCase()) && row.downloadHref)
    .filter(row => !subArea || !row.subArea || row.subArea === subArea)
    .map(row => {
      const from = istDate(row.raw?.reportStartDate)
      const to = istDate(row.raw?.reportEndDate)

      return { ...row, window: from && to ? { from, to } : null }
    })
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0))
}

/** Is this row still being built? Told apart from a row that failed outright. */
export const isStillBuilding = (row: { status?: string }): boolean =>
  String(row.status || '').toUpperCase() === 'PEN'

/**
 * Fetch one completed report.
 *
 * The filename matters as much as the bytes: it is the only thing that says
 * which window the file holds, and with several reports of the same name on
 * the list it is what stops October's rows being filed against September's
 * request.
 */
export const downloadSnapdealReport = async (input: {
  username: string
  href: string
  onProgress?: ((message: string) => void) | undefined
}): Promise<{ buffer: Buffer; filename: string }> => {
  const file = await withJar(
    input.username,
    jar => flow().downloadReport(jar, input.href),
    input.onProgress
  )

  return { buffer: file.buffer, filename: file.filename ?? '' }
}

/* -------------------------------------------------------------------------- *
 * The file
 * -------------------------------------------------------------------------- */

/**
 * The downloaded spreadsheet, as rows.
 *
 * CSV TODAY, XLSX TOMORROW, AND THE SAME CODE EITHER WAY. Snapdeal serves this
 * report as CSV — `S7aea7_DROPSHIP_RTN_CREATED_05092026_03102026.csv` — but
 * the portal's other reports arrive as .xlsx and the download endpoint is the
 * same one. `xlsx` reads both from a buffer and is already a dependency here,
 * so nothing is gained by committing to the format the file happens to be in
 * today.
 *
 * Every cell is read as TEXT. Sub-order codes, AWBs and SKUs are long digit
 * strings — `8907979168347`, `4608544326972` — and a spreadsheet parser that
 * is allowed to guess turns those into floats and then into `8.90798e+12`,
 * which matches nothing and is unrecoverable once stored.
 */
export const parseSnapdealReport = (buffer: Buffer): Record<string, unknown>[] => {
  const book = readWorkbook(buffer, { type: 'buffer', raw: false, codepage: 65001 })
  const first = book.SheetNames[0]

  if (!first) return []

  const sheet = book.Sheets[first]

  if (!sheet) return []

  return sheetUtils.sheet_to_json<Record<string, unknown>>(sheet, {
    // Blank cells come back as "" rather than being dropped, so a row's shape
    // does not change with its content.
    defval: '',
    raw: false
  })
}
