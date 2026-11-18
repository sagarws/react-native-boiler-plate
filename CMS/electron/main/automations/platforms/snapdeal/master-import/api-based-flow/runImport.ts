import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import { stoppableSleep, throwIfStopped } from '@main/services/automationStop'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'
import { reusableSession } from '@main/services/sessionReuse.service'
import { keepSession } from '@main/automations/common/keepSession'
import { snapdealApiDate } from '@shared/utils/snapdealRows'
import {
  MASTER_IMPORT_API_POLL_MS,
  MASTER_IMPORT_API_TIMEOUT_MS,
  MASTER_IMPORT_MAX_ATTEMPTS
} from '@main/automations/common/masterImportConstants'

/**
 * Snapdeal master import over the portal's own JSON APIs.
 *
 * A port of the automation server's
 * `src/platforms/snapdeal/master-import/api-based-flow/apiScript.js`, with the
 * same two phases in one pass:
 *
 *   PHASE 1 — sign in once, then schedule every requested report type. Each
 *     scheduled report goes on an in-memory queue as { requestId,
 *     initiationText, meta, scheduledAt }.
 *   PHASE 2 — drain. Each round makes ONE listReports call covering every
 *     pending report, downloads and uploads whatever reached CMP in parallel,
 *     records terminal failures, then sleeps and goes again until the queue is
 *     empty or the deadline passes.
 *
 * Unlike the script-based flow this does NOT use the persisted queue, and that
 * is deliberate: it holds only a cookie jar between rounds, not a browser, so
 * there is nothing to close and reopen. The tradeoff is that closing the app
 * mid-drain abandons a report Snapdeal has already built — on the server that
 * never happens, on a laptop it can.
 *
 * Every step is the core's own. This file is orchestration: which import types,
 * the date window, the polling, and where the temp file goes.
 *
 * The upload is what makes this work from a desktop at all —
 * `importSnapdealData` POSTs the report as multipart to the backend rather than
 * writing to Mongo, so it needs no database access.
 */

interface ScheduleResult {
  requestId?: string | null
  /** What the reports list calls it — rows carry no id, so this is the handle. */
  reportName: string
  /** Query param that narrows the reports list to this report's area. */
  listCategory: string
  subArea: string
  portalReportName: string
  trackvidReportType: string
}

interface ReportRecord {
  name?: string | null
  /** "PEN" while building, "CMP" when complete. */
  status?: string
  code?: string | null
  subArea?: string | null
  startTime?: number | null
  /** Derived from subArea + code by the core; absent until the report completes. */
  downloadHref?: string | null
}

interface ImportTypeConfig {
  lookbackDaysCap?: number
  portalReportName: string
  /** What TRACKVID calls the report — the upload endpoint validates it. */
  trackvidReportType: string
}

/** A Date's local calendar day, `yyyy-MM-dd` — the day the core computed it as. */
const localDay = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

interface DateRange {
  from: string
  to: string
  fromDate: Date
  toDate: Date
}

interface ReportFlow {
  loginMasterData: (username: string, password: string, credentialId?: string) => Promise<unknown>
  scheduleReport: (jar: unknown, importType: string, range: DateRange) => Promise<ScheduleResult>
  listReports: (
    jar: unknown,
    options?: { category?: string; pageSize?: number; start?: number }
  ) => Promise<ReportRecord[]>
  findReport: (
    rows: ReportRecord[],
    match: { reportName: string; notBefore?: number }
  ) => ReportRecord | null
  downloadReport: (jar: unknown, href: string) => Promise<{ buffer: Buffer; filename?: string }>
  computeDateRange: (scenario: unknown, lastSyncDate: unknown, cap: unknown) => DateRange
  getImportTypeApiConfig: (importType: string) => ImportTypeConfig & Record<string, unknown>
}

interface LoginErrors {
  isInvalidCredentialsError: (error: unknown) => boolean
}

interface TrackvidFunctions {
  importSnapdealDataToTrackVid: (input: {
    reportType: string
    filePath: string
    user: { trackVidEmail: string; companyId: string; plateForm: string; username: string }
  }) => Promise<{ error?: string } | null>
}

export interface MasterImportInput {
  companyId: string
  /** The signed-in operator's TrackVid email — the profile the upload is filed under. */
  trackVidEmail: string
  username: string
  password: string
  credentialId: string
  /** Report types to pull. Defaults to Snapdeal's configured set. */
  importTypes?: string[]
}

export interface MasterImportOutcome {
  importType: string
  ok: boolean
  bytes?: number
  message?: string
}

/** A report asked for and not yet accounted for. */
interface PendingReport {
  importType: string
  requestId: string | null
  /** Matched on in the reports list — rows have no id of any kind. */
  reportName: string
  listCategory: string
  trackvidReportType: string
  scheduledAt: number
}

/** Snapdeal's report types, mirroring the server's configBuilder. */
const DEFAULT_IMPORT_TYPES = ['returnOrderData']

/**
 * Snapdeal's statuses on the Reports list, as verified from the Puppeteer path
 * in requestReportFlow / downloadReportScript.
 */
const COMPLETE = new Set(['CMP', 'COMPLETED'])
/** "PEN" is Snapdeal's still-building status — not terminal, just not ready. */
const TERMINAL = new Set(['FAILED', 'EXPIRED', 'CANCELLED'])


export const runSnapdealMasterImport = async (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  // Auth is hybrid: the core bootstraps cookies with Puppeteer before axios
  // takes over, so this needs the browser half of the preparation even though
  // the report calls themselves are plain HTTP. Without it the login fails
  // minutes in with "An `executablePath` or `channel` must be specified for
  // `puppeteer-core`".
  await prepareCoreWithBrowser(onProgress, 'snapdeal')

  const flow = loadCore<ReportFlow>('platforms/snapdeal/master-import/api-based-flow/apiReportFlow')
  const { isInvalidCredentialsError } = loadCore<LoginErrors>('platforms/snapdeal/common/loginErrors')
  const { importSnapdealDataToTrackVid } = loadCore<TrackvidFunctions>(
    'platforms/snapdeal/master-import/api-based-flow/trackvidFunctions'
  )

  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []

  // =========================================================================
  // PHASE 1 — one login, then schedule every report
  // =========================================================================
  // A stored session that PROVES it still works skips the sign-in entirely.
  // Anything less — dead, unverifiable, absent — falls through to logging in.
  const reuse = await reusableSession('snapdeal', input.username)

  let jar: unknown = reuse.session?.jar

  // The REASON is reported, not just the outcome. "A browser opened even though
  // the session says Active" is otherwise unanswerable without reading a log
  // file, and the answer is usually that Active only means the expiry date has
  // not passed.
  onProgress?.(jar ? 'Reusing the saved Snapdeal login…' : `No usable saved login — ${reuse.detail}`)

  try {
    if (!jar) {
      // NO SIGN-IN FROM AN IMPORT — the Login update owns that (signInPolicy).
      refuseSignInUnlessAllowed('snapdeal', input.username, reuse.detail)
      jar = await flow.loginMasterData(input.username, input.password, input.credentialId)
      logger.info(`[snapdeal-api] signed in as ${input.username}`)

      // Kept so the NEXT run can skip this sign-in. Nothing saved it before,
      // which is why every run signed in however healthy the stored session
      // looked — there was never a stored session to be healthy.
      await keepSession('snapdeal', input.username, jar, {}, onProgress)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // A changed password is worth naming: it is the one failure here an
    // operator can actually fix, and it will not resolve itself on a retry.
    const badCredentials = isInvalidCredentialsError(error)

    logger.error(`[snapdeal-api] login failed for ${input.username}`, { message, badCredentials })

    return importTypes.map((importType) => ({
      importType,
      ok: false,
      message: badCredentials
        ? `Snapdeal rejected the sign-in for ${input.username} — the password has probably changed`
        : message
    }))
  }

  const pending: PendingReport[] = []

  for (const importType of importTypes) {
    throwIfStopped('snapdeal master import')
    try {
      const meta = flow.getImportTypeApiConfig(importType)

      // `null` lastSyncDate: the sync date lives in Mongo and this app cannot
      // read it, so every desktop run asks for the full lookback window the
      // report type allows. Correct but not minimal — narrowing it needs the
      // sync-date gap closed first.
      const computed = flow.computeDateRange(undefined, null, meta.lookbackDaysCap)
      // The core writes `1-10-2026`; the portal itself sends the zero-padded
      // `01-10-2026`, so this asks exactly as the portal does.
      const range = {
        ...computed,
        from: snapdealApiDate(localDay(computed.fromDate)),
        to: snapdealApiDate(localDay(computed.toDate))
      }

      onProgress?.(`Requesting the ${importType} report…`)

      const scheduled = await flow.scheduleReport(jar, importType, range)

      logger.info(
        `[snapdeal-api] scheduled ${meta.portalReportName} ${range.from} → ${range.to} ` +
          `(requestId=${scheduled.requestId || '?'})`
      )

      pending.push({
        importType,
        requestId: scheduled.requestId ?? null,
        reportName: scheduled.reportName ?? meta.portalReportName,
        listCategory: scheduled.listCategory ?? meta.listCategory,
        trackvidReportType: scheduled.trackvidReportType ?? meta.trackvidReportType,
        scheduledAt: Date.now()
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      // One report type failing must not abandon the others: they are separate
      // reports and separate uploads.
      outcomes.push({ importType, ok: false, message })
      logger.error(`[snapdeal-api] schedule failed for ${importType}`, { message })
    }
  }

  if (pending.length === 0) {
    logger.warn('[snapdeal-api] nothing scheduled — no reports to poll for')

    return outcomes
  }

  // =========================================================================
  // PHASE 2 — drain: one list call per round, parallel download + upload
  // =========================================================================
  logger.info(`[snapdeal-api] ${pending.length} report(s) scheduled; draining`)

  const deadline = Date.now() + MASTER_IMPORT_API_TIMEOUT_MS
  const directory = await mkdtemp(join(tmpdir(), 'trackvid-master-import-'))
  let round = 0

  const drop = (report: PendingReport): void => {
    const index = pending.indexOf(report)

    if (index >= 0) pending.splice(index, 1)
  }

  try {
    while (pending.length > 0 && round < MASTER_IMPORT_MAX_ATTEMPTS && Date.now() < deadline) {
      // Wait BEFORE checking, not after. A report asked for milliseconds ago is
      // never ready, so checking immediately spends one of only three attempts
      // on a guaranteed "PEN" — the checks now land at 5, 10 and 15 minutes
      // rather than 0, 5 and 10.
      onProgress?.(
        `Snapdeal is building ${pending.length} report(s) — first check in ` +
          `${Math.round(MASTER_IMPORT_API_POLL_MS / 60000)} min`
      )
      await stoppableSleep(MASTER_IMPORT_API_POLL_MS, 'snapdeal master import — waiting for the report')

      round += 1

      logger.info(
        `[snapdeal-api] check ${round}/${MASTER_IMPORT_MAX_ATTEMPTS} — ${pending.length} pending`
      )
      onProgress?.(
        `Checking whether Snapdeal has built ${pending.length} report(s) — check ` +
          `${round} of ${MASTER_IMPORT_MAX_ATTEMPTS}`
      )

      let rows: ReportRecord[]

      try {
        // One call covers every pending report. Enough rows to hold all of
        // them plus a margin for the account's older reports.
        rows = await flow.listReports(jar, {
          ...(pending[0] ? { category: pending[0].listCategory } : {}),
          pageSize: Math.max(20, pending.length + 10)
        })
      } catch (error) {
        // Transient: the reports are still building regardless of whether this
        // one list call succeeded, so the round is skipped rather than failed.
        const message = error instanceof Error ? error.message : String(error)

        // Does not count against the attempt cap: the reports are building
        // regardless of whether this one list call reached the portal, and
        // spending a check on a network blip would be spending it on nothing.
        round -= 1

        logger.warn(`[snapdeal-api] list call failed: ${message} — not counting it as a check`)
        continue
      }

      const ready: { report: PendingReport; record: ReportRecord }[] = []

      for (const report of [...pending]) {
        throwIfStopped('snapdeal master import')
        // By name and recency. The list rows carry no id, so the requestId the
        // schedule returned has nothing to match against; `notBefore` is what
        // stops yesterday's identically-named report being collected instead.
        const record = flow.findReport(rows, {
          reportName: report.reportName,
          notBefore: report.scheduledAt
        })

        // Not visible yet; try the next round.
        if (!record) continue

        const status = String(record.status || '').toUpperCase()

        if (COMPLETE.has(status)) {
          // Complete, but the link is not always stamped in the same response.
          if (record.downloadHref) ready.push({ report, record })
          continue
        }

        if (TERMINAL.has(status)) {
          const message = `${status}: Snapdeal did not finish building the report`

          logger.warn(`[snapdeal-api] ${report.importType} → ${message}`)
          outcomes.push({ importType: report.importType, ok: false, message })
          drop(report)
        }
      }

      if (ready.length > 0) {
        logger.info(`[snapdeal-api] ${ready.length} report(s) complete — downloading`)

        // In parallel: these are independent downloads and independent uploads,
        // and the portal has already done the slow part.
        await Promise.all(
          ready.map(async ({ report, record }) => {
            try {
              onProgress?.(`Downloading the ${report.importType} report…`)

              const { buffer, filename } = await flow.downloadReport(jar, record.downloadHref as string)
              const filePath = join(
                directory,
                filename || `snapdeal_${report.importType}_${Date.now()}.csv`
              )

              await writeFile(filePath, buffer)

              const elapsedSec = Math.round((Date.now() - report.scheduledAt) / 1000)

              logger.info(
                `[snapdeal-api] downloaded ${buffer.length}B in ${elapsedSec}s → ${basename(filePath)}`
              )
              onProgress?.(`Uploading ${report.importType} to TrackVid…`)

              const uploadResult = await importSnapdealDataToTrackVid({
                // TrackVid's name for the report, not our internal key — the
                // endpoint validates it and answers 400 otherwise.
                reportType: report.trackvidReportType,
                filePath,
                user: {
                  trackVidEmail: input.trackVidEmail,
                  companyId: input.companyId,
                  plateForm: 'SNAPDEAL',
                  username: input.username
                }
              })

              // The upload RETURNS its error rather than throwing; without this
              // an outright rejection would be recorded as a successful import.
              if (uploadResult?.error) throw new Error(uploadResult.error)

              outcomes.push({ importType: report.importType, ok: true, bytes: buffer.length })
              logger.info(
                `[snapdeal-api] imported ${report.importType} (${buffer.length} bytes) for ${input.username}`
              )
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)

              outcomes.push({ importType: report.importType, ok: false, message })
              logger.error(`[snapdeal-api] ${report.importType} download/upload failed`, { message })
            } finally {
              drop(report)
            }
          })
        )
      }

    }
  } finally {
    // Removed on every exit path: these reports are a company's order data, and
    // this is an operator's own machine rather than a server nobody logs into.
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  // Anything still pending ran out of time. Reported rather than dropped: the
  // report may well appear in the portal later, and saying so is more useful
  // than a silent gap.
  for (const report of pending) {
    const message =
      `Snapdeal had not finished building the report after ${round} check(s) over ` +
      `${Math.round((round * MASTER_IMPORT_API_POLL_MS) / 60000)} minutes — it may still ` +
      'appear in the portal; resync to collect it'

    outcomes.push({ importType: report.importType, ok: false, message })
    logger.warn(`[snapdeal-api] giving up on ${report.importType}: ${message}`)
  }

  return outcomes
}
