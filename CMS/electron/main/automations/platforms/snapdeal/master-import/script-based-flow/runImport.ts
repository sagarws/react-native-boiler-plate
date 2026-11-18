import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import { MASTER_IMPORT_DOWNLOAD_TIMEOUT_MS } from '@main/automations/common/masterImportConstants'
import { enqueueReport, type QueuedReport } from '@main/services/masterImportQueue.store'
import type {
  MasterImportInput,
  MasterImportOutcome
} from '../api-based-flow/runImport'

/**
 * Snapdeal master import, script-based — the flow that actually works.
 *
 * Drives the seller portal's Reports UI exactly as the automation server does:
 * open Create New Report, pick the four dropdowns, set the date range, submit,
 * wait for the portal to build it, download the file, upload it to TrackVid.
 *
 * This exists because the API flow does not work for these accounts —
 * /report/generateReport answers 500 for reports the same account can produce
 * perfectly well through the UI. The server reached the same conclusion, which
 * is why its master import runs this way too.
 *
 * Every step is a core utility. The only thing this file owns is orchestration:
 * a browser, a download directory, and the wait between requesting a report and
 * it being ready.
 *
 * Differs from the server in ONE respect, deliberately: the server hands the
 * download to a BullMQ worker so a long-running import survives a restart.
 * There is no queue here, so the wait happens in-process. That is acceptable
 * for an operator-triggered resync they are watching, and wrong for an
 * unattended overnight job — worth revisiting if this is ever scheduled.
 */

interface MasterUtils {
  snapdealLoginWithRetry: (page: unknown, credentials: unknown, maxAttempts?: number) => Promise<unknown>
  navigateToReportsTab: (page: unknown) => Promise<unknown>
  findReportCardByInitiationText: (
    page: unknown,
    match: { reportName: string; initiationText: string }
  ) => Promise<ReportCard | null>
  findReportCardByRequestTime: (
    page: unknown,
    match: { reportName: string; requestedAt: number; toleranceMinutes?: number }
  ) => Promise<ReportCard | null>
  /** Matches the card again by name + initiation text — NOT by the card object. */
  clickReportDownload: (
    page: unknown,
    match: { reportName: string; initiationText: string }
  ) => Promise<unknown>
  sleep: (ms: number) => Promise<void>
}

/** What the portal's report list says about one report. */
interface ReportCard {
  name: string
  initiationText: string
  /** "CMP" once Snapdeal has finished building it; "PENDING" while it is queued. */
  status: 'CMP' | 'PENDING'
  downloadHref: string | null
}

interface RequestFlow {
  runRequestReportFlow: (page: unknown, config: unknown) => Promise<{
    initiationText?: string
    requestedAt?: number
    portalReportName?: string
  } | null>
  getImportTypeSpec: (importType: string) => {
    /** What the portal calls the report — used to find its row in the list. */
    portalReportName: string
    /** What TRACKVID calls it — what the upload endpoint validates against. */
    trackvidReportType: string
  } & Record<string, unknown>
}

interface TrackvidFunctions {
  importSnapdealDataToTrackVid: (input: {
    reportType: string
    filePath: string
    user: { trackVidEmail: string; companyId: string; plateForm: string; username: string }
  }) => Promise<{ error?: string } | null>
}

interface BrowserRuntime {
  loadPuppeteer: () => {
    launch: (options: Record<string, unknown>) => Promise<{
      newPage: () => Promise<Record<string, unknown>>
      close: () => Promise<void>
    }>
  } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

interface Headless {
  isHeadless: () => boolean
}

const DEFAULT_IMPORT_TYPES = ['returnOrderData']


/**
 * Waits for a file to appear in `dir` and stop growing.
 *
 * Chromium writes downloads through a `.crdownload` temp file, so a filename
 * appearing is not the same as a download finishing — uploading a half-written
 * CSV would silently import a partial report.
 */
interface DownloadResult {
  filePath: string | null
  /** What actually happened, for a failure message worth reading. */
  detail: string
}

const PLAUSIBLE = /\.(csv|xlsx|xls|zip)$/i

/**
 * Waits for the report file to finish downloading.
 *
 * Two independent checks, because either alone has been wrong before:
 *
 *   1. no `.crdownload` in the directory — Chromium's own "still writing"
 *      marker, and what the automation server keys on
 *   2. the same filename reporting the same non-zero size twice running
 *
 * Both must agree. Uploading a partially written CSV is the one failure here
 * that produces no error at all: the import "succeeds" and silently loads half
 * a report, which is worse than failing.
 *
 * On timeout it reports what it actually saw. A bare "download failed" after
 * ninety seconds tells nobody whether Chrome saved elsewhere, saved something
 * unexpected, or never started.
 */
const waitForDownload = async (dir: string, before: Set<string>): Promise<DownloadResult> => {
  const deadline = Date.now() + MASTER_IMPORT_DOWNLOAD_TIMEOUT_MS

  let lastName = ''
  let lastSize = -1
  let sawPartial = false

  while (Date.now() < deadline) {
    const names = await readdir(dir).catch((): string[] => [])
    const fresh = names.filter((name) => !before.has(name))

    if (fresh.some((name) => name.endsWith('.crdownload'))) {
      sawPartial = true
      await new Promise((resolve) => setTimeout(resolve, 1000))
      continue
    }

    const candidate = fresh.find((name) => !name.endsWith('.crdownload'))

    if (candidate) {
      const size = await stat(join(dir, candidate))
        .then((info) => info.size)
        .catch(() => -1)

      if (candidate === lastName && size === lastSize && size > 0) {
        if (!PLAUSIBLE.test(candidate)) {
          return {
            filePath: null,
            detail: `Snapdeal returned "${candidate}", which is not a report file (expected .csv, .xlsx or .zip)`
          }
        }

        return { filePath: join(dir, candidate), detail: `${candidate} (${size} bytes)` }
      }

      lastName = candidate
      lastSize = size
    }

    await new Promise((resolve) => setTimeout(resolve, 1000))
  }

  // Nothing arrived. Say what the folder held, and whether Chrome ever started,
  // so the next person knows which of the three likely causes it was.
  const finalNames = await readdir(dir).catch((): string[] => [])

  return {
    filePath: null,
    detail: sawPartial
      ? `a download started but never finished within 2 minutes (folder now holds: ${finalNames.join(', ') || 'nothing'})`
      : `no download ever appeared in ${dir} (folder holds: ${finalNames.join(', ') || 'nothing'}). ` +
        'If the browser saved it elsewhere, Page.setDownloadBehavior was not honoured.'
  }
}

/** Opens a browser prepared for desktop execution, with downloads landing in `dir`. */
const openBrowser = async (
  dir: string,
  onProgress?: (message: string) => void
): Promise<{ browser: { newPage: () => Promise<Record<string, unknown>>; close: () => Promise<void> }; page: Record<string, unknown> }> => {
  await prepareCoreWithBrowser(onProgress, 'snapdeal')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<Headless>('common/headless')
  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for the Snapdeal master import')

  const browser = await puppeteer.launch({
    headless: isHeadless(),
    executablePath: runtime.resolveExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1280,800'
    ]
  })

  const page = await browser.newPage()

  // Downloads must land where the watcher looks, not the OS default.
  const client = await (page as { createCDPSession: () => Promise<{ send: (m: string, p: unknown) => Promise<unknown> }> }).createCDPSession()

  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir })

  return { browser, page }
}

/**
 * PHASE 1 — request the reports, then close the browser.
 *
 * Snapdeal builds a report in the background over minutes. Sitting in front of
 * an open browser waiting for it wastes the machine and, on an operator's
 * laptop, leaves a window on their screen for the duration. So this phase does
 * the one thing that needs a session — submitting the request — records what to
 * collect, and shuts down. Phase 2 comes back for it later.
 *
 * This is the same split the automation server makes (request script, then a
 * BullMQ download worker); here the queue is a file rather than Redis.
 */
export const requestSnapdealMasterReports = async (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  const utils = loadCore<MasterUtils>('platforms/snapdeal/master-import/common/utils')
  const request = loadCore<RequestFlow>(
    'platforms/snapdeal/master-import/script-based-flow/requestReportFlow'
  )

  const dir = await mkdtemp(join(tmpdir(), 'trackvid-snapdeal-request-'))
  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []
  const { browser, page } = await openBrowser(dir, onProgress)

  try {
    onProgress?.('Signing in to Snapdeal…')
    await utils.snapdealLoginWithRetry(page, {
      username: input.username,
      password: input.password
    })

    for (const importType of importTypes) {
      try {
        const spec = request.getImportTypeSpec(importType)

        onProgress?.(`Requesting the ${spec.portalReportName} report…`)

        const requested = await request.runRequestReportFlow(page, {
          importType,
          username: input.username,
          companyId: input.companyId
        })

        if (!requested?.initiationText) {
          throw new Error('Snapdeal did not confirm the report request')
        }

        await enqueueReport({
          platform: 'snapdeal',
          credentialId: input.credentialId,
          username: input.username,
          companyId: input.companyId,
          trackVidEmail: input.trackVidEmail,
          importType,
          portalReportName: spec.portalReportName,
          trackvidReportType: spec.trackvidReportType,
          initiationText: requested.initiationText,
          requestedAt: Date.now()
        })

        outcomes.push({
          importType,
          ok: true,
          message: 'Requested — Snapdeal is building it; the download will follow automatically'
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        outcomes.push({ importType, ok: false, message })
        logger.error(`Snapdeal ${importType} request failed for ${input.username}`, { message })
      }
    }
  } finally {
    await browser.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }

  return outcomes
}

/**
 * PHASE 2 — collect one queued report, if Snapdeal has finished building it.
 *
 * Opens a browser, signs in, looks for the report's row. Still PENDING means
 * "not yet" — the entry stays queued and the next interval tries again, rather
 * than holding a session open in between.
 *
 * @returns `collected` false when the report is simply not ready; the caller
 *          leaves it queued. An actual failure throws.
 */
export const collectSnapdealReport = async (
  queued: QueuedReport,
  password: string,
  onProgress?: (message: string) => void
): Promise<{ collected: boolean; detail: string }> => {
  const utils = loadCore<MasterUtils>('platforms/snapdeal/master-import/common/utils')
  const { importSnapdealDataToTrackVid } = loadCore<TrackvidFunctions>(
    'platforms/snapdeal/master-import/api-based-flow/trackvidFunctions'
  )

  const dir = await mkdtemp(join(tmpdir(), 'trackvid-snapdeal-report-'))
  const { browser, page } = await openBrowser(dir, onProgress)

  try {
    onProgress?.(`Checking whether ${queued.portalReportName} is ready…`)

    await utils.snapdealLoginWithRetry(page, { username: queued.username, password })
    await utils.navigateToReportsTab(page)

    const card = await utils.findReportCardByInitiationText(page, {
      reportName: queued.portalReportName,
      initiationText: queued.initiationText
    })

    if (!card) return { collected: false, detail: 'not on the report list yet' }
    // The row appears as soon as the report is REQUESTED; only "CMP" carries a
    // download link.
    if (card.status !== 'CMP') return { collected: false, detail: `status ${card.status}` }

    onProgress?.(`Downloading ${queued.portalReportName}…`)

    const before = new Set(await readdir(dir).catch((): string[] => []))

    await utils.clickReportDownload(page, {
      reportName: card.name,
      initiationText: card.initiationText
    })

    const download = await waitForDownload(dir, before)

    if (!download.filePath) throw new Error(`Report download failed — ${download.detail}`)

    logger.info(`Downloaded Snapdeal ${queued.importType}: ${download.detail}`)
    onProgress?.(`Uploading ${queued.portalReportName} to TrackVid…`)

    const uploadResult = await importSnapdealDataToTrackVid({
      // TrackVid's name for the report, not our internal key.
      reportType: queued.trackvidReportType,
      filePath: download.filePath,
      user: {
        trackVidEmail: queued.trackVidEmail,
        companyId: queued.companyId,
        plateForm: 'SNAPDEAL',
        username: queued.username
      }
    })

    // It RETURNS its error rather than throwing.
    if (uploadResult?.error) throw new Error(uploadResult.error)

    return { collected: true, detail: download.detail }
  } finally {
    await browser.close().catch(() => undefined)
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}
