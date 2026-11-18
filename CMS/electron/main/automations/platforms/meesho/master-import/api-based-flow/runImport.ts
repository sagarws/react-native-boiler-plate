import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import { stoppableSleep, throwIfStopped } from '@main/services/automationStop'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'
import { reusableSession } from '@main/services/sessionReuse.service'
import { keepSession } from '@main/automations/common/keepSession'
import {
  MASTER_IMPORT_API_POLL_MS,
  MASTER_IMPORT_MAX_ATTEMPTS
} from '@main/automations/common/masterImportConstants'

/**
 * Meesho master import over the supplier panel's own JSON APIs.
 *
 * A port of the automation server's
 * `src/platforms/meesho/master-import/api-based-flow/apiScript.js`:
 *
 *   PHASE 1 — sign in once, request a report per import type.
 *   PHASE 2 — poll `listReportHistory` until each one is downloadable, then
 *     download and upload it.
 *
 * IMPORTANT — this flow covers FORWARD ORDERS ONLY.
 *
 * `returnOrderData` has no documented API: the core's `runReturnReport` throws
 * MEESHO_RETURN_API_UNAVAILABLE, and the server's runner skips it with "use the
 * Puppeteer path". So a company on `apiBasedAutomation.meesho.masterImport =
 * true` gets its forward orders over HTTP and NO return orders at all.
 *
 * That gap is reported per import type rather than hidden, because a run that
 * silently imports half the data looks exactly like a run that imported all of
 * it. The script-based flow does both.
 */

interface ReportRecord {
  status?: string
  [key: string]: unknown
}

interface DateRange {
  from: string
  to: string
}

interface ReportFlow {
  loginMasterData: (username: string, password: string, credentialId?: string) => Promise<unknown>
  requestOrderReport: (ctx: unknown, range: DateRange) => Promise<unknown>
  listReportHistory: (ctx: unknown) => Promise<ReportRecord[]>
  findMatchingReport: (
    history: ReportRecord[],
    match: { from: string; to: string; requestedAt: number }
  ) => ReportRecord | null
  getReportStatus: (record: ReportRecord) => string
  getReportDownloadUrl: (record: ReportRecord) => string | null
  downloadReportFile: (ctx: unknown, url: string) => Promise<{ buffer: Buffer; filename?: string }>
  computeDateRange: (scenario: unknown, lastSyncDate: unknown, cap?: number) => DateRange
}

interface TrackvidFunctions {
  /**
   * POSITIONAL, unlike Snapdeal's single-object equivalent. Passing an object
   * here type-checks nowhere but silently leaves filePath and user undefined —
   * which is exactly the bug this runner's server counterpart had.
   */
  importMasterDataToTrackVid: (
    reportType: string,
    filePath: string,
    user: { trackVidEmail: string; companyId: string; plateForm: string; username: string }
  ) => Promise<{ error?: string } | null>
}

export interface MasterImportInput {
  companyId: string
  companyName?: string
  /** The signed-in operator's TrackVid email — the profile the upload is filed under. */
  trackVidEmail: string
  username: string
  password: string
  credentialId: string
  importTypes?: string[]
}

export interface MasterImportOutcome {
  importType: string
  ok: boolean
  bytes?: number
  message?: string
}

const DEFAULT_IMPORT_TYPES = ['forwardOrderData', 'returnOrderData']

/** The only import type with a documented API export. */
const API_CAPABLE = 'forwardOrderData'

/**
 * What TrackVid calls Meesho's forward-order export.
 *
 * The ingest endpoint validates this string and answers 400 on anything else,
 * so it must match what the Puppeteer flow sends — `FORWARD_REPORT_TYPE` in the
 * core's forwardOrdersFlow.
 */
const FORWARD_REPORT_TYPE = 'Dropship Order Report'

const COMPLETE = new Set(['COMPLETED', 'SUCCESS', 'CMP', 'DONE'])
const TERMINAL = new Set(['FAILED', 'EXPIRED', 'CANCELLED', 'ERROR'])


interface PendingReport {
  importType: string
  range: DateRange
  requestedAt: number
}

export const runMeeshoMasterImport = async (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  // Auth is hybrid: the core bootstraps the cookie jar with Puppeteer before
  // axios takes over, so the browser half of the preparation is needed even
  // though the report calls are plain HTTP.
  await prepareCoreWithBrowser(onProgress, 'meesho')

  const flow = loadCore<ReportFlow>('platforms/meesho/master-import/api-based-flow/apiReportFlow')
  const { importMasterDataToTrackVid } = loadCore<TrackvidFunctions>(
    'platforms/meesho/master-import/api-based-flow/trackvidFunctions'
  )

  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []

  // Reported, not skipped silently. An operator who asked for both exports and
  // received one needs to know which one is missing and why.
  for (const importType of importTypes.filter((type) => type !== API_CAPABLE)) {
    throwIfStopped('meesho master import')
    outcomes.push({
      importType,
      ok: false,
      message:
        `Meesho has no API export for ${importType} — only ${API_CAPABLE} can be fetched over ` +
        'HTTP. Turn off the direct-API flow for Meesho to import this one via the portal.'
    })
    logger.warn(`[meesho-api] ${importType} has no API endpoint — not attempted`)
  }

  const apiTypes = importTypes.filter((type) => type === API_CAPABLE)

  if (apiTypes.length === 0) return outcomes

  // =========================================================================
  // PHASE 1 — one login, then request each report
  // =========================================================================
  // A stored session that PROVES it still works skips the sign-in.
  //
  // Meesho's login returns a CONTEXT rather than a bare jar — the supplier ids
  // are discovered during login and every later call needs them — so the
  // context is rebuilt from the stored record. Both ids are stored alongside
  // the jar by the same ingest that wrote it (see the core's meesho
  // sessionStore.saveSession), so nothing is invented here.
  const reuse = await reusableSession('meesho', input.username)
  const stored = reuse.session

  let ctx: unknown =
    stored && stored.supplierId
      ? {
          jar: stored.jar,
          supplierId: stored.supplierId,
          supplierIdentifier: stored.supplierIdentifier ?? null
        }
      : null

  // A jar without the supplier id cannot drive the report calls, so it is not a
  // usable session however alive the cookies are.
  const why = stored && !stored.supplierId ? 'the stored login has no supplierId' : reuse.detail

  onProgress?.(ctx ? 'Reusing the saved Meesho login…' : `No usable saved login — ${why}`)

  try {
    if (!ctx) {
      // NO SIGN-IN FROM AN IMPORT — the Login update owns that (signInPolicy).
      refuseSignInUnlessAllowed('meesho', input.username, why)
      ctx = await flow.loginMasterData(input.username, input.password, input.credentialId)
      logger.info(`[meesho-api] signed in as ${input.username}`)

      // Kept so the next run can skip this sign-in. The supplier ids go with
      // it: they are discovered DURING login and every later call needs them,
      // so a stored jar without them is not a reusable session — which is
      // exactly what the reuse path above checks for.
      const session = ctx as { jar?: unknown; supplierId?: unknown; supplierIdentifier?: unknown }

      await keepSession(
        'meesho',
        input.username,
        session.jar,
        {
          supplierId: session.supplierId,
          supplierIdentifier: session.supplierIdentifier ?? null
        },
        onProgress
      )
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`[meesho-api] login failed for ${input.username}`, { message })

    return [...outcomes, ...apiTypes.map((importType) => ({ importType, ok: false, message }))]
  }

  const pending: PendingReport[] = []

  for (const importType of apiTypes) {
    throwIfStopped('meesho master import')
    try {
      // `null` lastSyncDate: the sync date lives in Mongo and this app cannot
      // read it, so every desktop run asks for the full window.
      const range = flow.computeDateRange(undefined, null)

      onProgress?.(`Requesting the ${importType} report…`)

      const requestedAt = Date.now()

      await flow.requestOrderReport(ctx, range)

      logger.info(`[meesho-api] requested ${importType} ${range.from} → ${range.to}`)
      pending.push({ importType, range, requestedAt })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      outcomes.push({ importType, ok: false, message })
      logger.error(`[meesho-api] request failed for ${importType}`, { message })
    }
  }

  if (pending.length === 0) return outcomes

  // =========================================================================
  // PHASE 2 — poll the history, then download and upload what is ready
  // =========================================================================
  const directory = await mkdtemp(join(tmpdir(), 'trackvid-meesho-import-'))
  let round = 0

  const drop = (report: PendingReport): void => {
    const index = pending.indexOf(report)

    if (index >= 0) pending.splice(index, 1)
  }

  try {
    while (pending.length > 0 && round < MASTER_IMPORT_MAX_ATTEMPTS) {
      // Wait before checking, not after: a report requested milliseconds ago is
      // never ready, and checking immediately spends one of only three attempts
      // learning nothing.
      onProgress?.(
        `Meesho is building ${pending.length} report(s) — first check in ` +
          `${Math.round(MASTER_IMPORT_API_POLL_MS / 60000)} min`
      )
      await stoppableSleep(MASTER_IMPORT_API_POLL_MS, 'meesho master import — waiting for the report')

      round += 1

      logger.info(
        `[meesho-api] check ${round}/${MASTER_IMPORT_MAX_ATTEMPTS} — ${pending.length} pending`
      )

      let history: ReportRecord[]

      try {
        // One call returns the status of everything this seller asked for.
        history = await flow.listReportHistory(ctx)
      } catch (error) {
        // Does not count against the cap: the reports are building whether or
        // not this one call reached Meesho.
        round -= 1

        const message = error instanceof Error ? error.message : String(error)

        logger.warn(`[meesho-api] history call failed: ${message} — not counting it as a check`)
        continue
      }

      for (const report of [...pending]) {
        throwIfStopped('meesho master import')
        const record = flow.findMatchingReport(history, {
          from: report.range.from,
          to: report.range.to,
          requestedAt: report.requestedAt
        })

        // Not listed yet; try the next check.
        if (!record) continue

        const status = String(flow.getReportStatus(record) || '').toUpperCase()

        if (TERMINAL.has(status)) {
          const message = `${status}: Meesho did not finish building the report`

          outcomes.push({ importType: report.importType, ok: false, message })
          logger.warn(`[meesho-api] ${report.importType} → ${message}`)
          drop(report)
          continue
        }

        if (!COMPLETE.has(status)) continue

        const url = flow.getReportDownloadUrl(record)

        // Complete, but the link is not always stamped in the same response.
        if (!url) continue

        try {
          onProgress?.(`Downloading the ${report.importType} report…`)

          const { buffer, filename } = await flow.downloadReportFile(ctx, url)
          const filePath = join(directory, filename || `meesho_${report.importType}_${Date.now()}.csv`)

          await writeFile(filePath, buffer)
          onProgress?.(`Uploading ${report.importType} to TrackVid…`)

          const uploadResult = await importMasterDataToTrackVid(FORWARD_REPORT_TYPE, filePath, {
            trackVidEmail: input.trackVidEmail,
            companyId: input.companyId,
            plateForm: 'MEESHO',
            username: input.username
          })

          // The upload RETURNS its error rather than throwing; without this a
          // rejection would be recorded as a successful import.
          if (uploadResult?.error) throw new Error(uploadResult.error)

          outcomes.push({ importType: report.importType, ok: true, bytes: buffer.length })
          logger.info(
            `[meesho-api] imported ${report.importType} (${buffer.length} bytes) for ${input.username}`
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          outcomes.push({ importType: report.importType, ok: false, message })
          logger.error(`[meesho-api] ${report.importType} download/upload failed`, { message })
        } finally {
          drop(report)
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  for (const report of pending) {
    const message =
      `Meesho had not finished building the report after ${round} check(s) over ` +
      `${Math.round((round * MASTER_IMPORT_API_POLL_MS) / 60000)} minutes — it may still ` +
      'appear in the portal; resync to collect it'

    outcomes.push({ importType: report.importType, ok: false, message })
    logger.warn(`[meesho-api] giving up on ${report.importType}: ${message}`)
  }

  return outcomes
}
