import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import { throwIfStopped } from '@main/services/automationStop'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'
import { storedSession } from '@main/services/sessionReuse.service'
import { publishSession } from '@main/services/platformSession.service'

/**
 * AJIO master import — the runner both flows share.
 *
 * AJIO's two flows differ in ONE step. Signing in, selecting every Place of
 * Business, splitting the date range into portal-sized chunks and uploading are
 * identical; only the fetch differs:
 *
 *   api    — POST AJIO's download endpoint from INSIDE the logged-in page, so
 *            Akamai sees the browser's own HttpOnly bff_session and real TLS
 *            fingerprint. This is why an "API" flow still needs a browser.
 *   script — click View → Export on the Reports page and watch for the file.
 *
 * So this is one runner with a strategy, not two copies of a thousand lines —
 * the same shape the automation server now uses, and every step below is the
 * core's own (`common/reportPage`, `script-based-flow/downloadReportFlow`,
 * `api-based-flow/apiReportFlow`).
 */

export type AjioFlow = 'api' | 'script'

interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>
  close: () => Promise<void>
}

type PuppeteerPage = Record<string, unknown> & {
  target: () => { createCDPSession: () => Promise<CdpSession> }
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>
}

interface CdpSession {
  send: (method: string, params: unknown) => Promise<unknown>
}

interface Chunk {
  fromDate: string
  toDate: string
}

interface ReportPage {
  isEnterprisePoBUser: (username: string) => boolean
  selectAllBrands: (page: PuppeteerPage, log: unknown) => Promise<unknown>
  selectAllPOBsViaModal: (page: PuppeteerPage, log: unknown) => Promise<unknown>
  splitDateRange: (from: string, to: string, maxDays?: number) => Chunk[]
}

interface UiDownload {
  downloadReportChunk: (
    page: PuppeteerPage,
    client: CdpSession,
    chunk: Chunk,
    log: unknown,
    options: { downloadPath: string }
  ) => Promise<string | null>
}

interface ApiDownload {
  MAX_CHUNK_DAYS: number
  getUserId: (page: PuppeteerPage) => Promise<string | null>
  /** Returns `{ pobIds, stores }` — NOT a bare array. */
  getPobIds: (
    page: PuppeteerPage,
    userId: string
  ) => Promise<{ pobIds: string[]; stores: { id: string; storeName?: string }[] }>
  downloadReport: (
    page: PuppeteerPage,
    input: { reportType: string; pobIds: string[]; from: string; to: string }
  ) => Promise<{ ok: boolean; noData?: boolean; status?: number; body?: string; buffer?: Buffer }>
}

interface BrowserRuntime {
  loadPuppeteer: () => {
    launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowser>
  } | null
  resolveExecutablePath: () => string | undefined
}

interface Headless {
  isHeadless: () => boolean
}

interface AjioLogin {
  /** Signs the page in and LEAVES IT OPEN — both flows keep using it. */
  loginAjioPage: (
    page: PuppeteerPage,
    credentials: { username: string; password: string },
    options?: { logger?: unknown; timeoutMs?: number }
  ) => Promise<{ ok: true }>
}

interface AjioSessionStore {
  /** Reads every cookie the page holds, in the shape the ingest wants. */
  harvestCookies: (
    page: PuppeteerPage
  ) => Promise<{ name: string; value: string; domain: string }[]>

  /**
   * Hydrates the record's cookies into `page`, navigates, and probes the
   * work-places API from INSIDE the page. `null` means "sign in" — it has
   * already cleared the page's auth state by then, so the login form renders.
   */
  reuseSessionRecord: (
    page: PuppeteerPage,
    record: unknown,
    options?: { username?: string; landingUrl?: string }
  ) => Promise<{ userId: string; pobIds: string[]; stores: { id: string; storeName?: string }[] } | null>
}

interface TrackvidFunctions {
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
  /** AJIO report types to pull. Defaults to both of them. */
  importTypes?: string[]
}

export interface MasterImportOutcome {
  importType: string
  ok: boolean
  bytes?: number
  message?: string
}

/**
 * AJIO's two report types, named as the ingest endpoint validates them.
 *
 * Unlike Snapdeal these ARE the reportType strings — AJIO has no separate
 * internal key, and `REPORT_ENDPOINTS` in the core is keyed by these exact
 * labels.
 */
const DEFAULT_IMPORT_TYPES = ['Dropship Order Report', 'Dropship Rtv Report']

/**
 * Enterprise accounts get smaller windows. Their exports are large enough that
 * a full 30-day chunk is slow or times out — the same 15-day split the server
 * uses for them.
 */
const ENTERPRISE_CHUNK_DAYS = 15

/** How far back a run reaches when there is no last-sync date to work from. */
const DEFAULT_LOOKBACK_DAYS = 30

/**
 * The Reports page — only the script flow goes there.
 *
 * The automation server takes this from REPORT_URL in its .env. A packaged
 * desktop app has no .env, so the default is inline and overridable by the same
 * variable for parity with the server.
 */
const REPORT_URL =
  process.env.REPORT_URL ?? 'https://seller.ajio.com/ajiocommerce/#/reports'

/**
 * Ships the session this run just signed in with, so the NEXT run can reuse it.
 *
 * AJIO's ingest refuses a jar without `userId` and `pobIds` — the automation
 * builds every API URL from the seller id, and the download needs at least one
 * place of business — so both are read here even for the script flow, which
 * otherwise picks its PoBs through the UI and never asks the API for them. One
 * extra call, once per sign-in, in exchange for every later run skipping the
 * sign-in altogether.
 *
 * Deliberately swallows its errors: a session that could not be saved costs the
 * next run a login. Failing this import over it would cost the whole report.
 */
const keepSession = async (
  username: string,
  page: PuppeteerPage,
  api: ApiDownload,
  harvestCookies: (page: PuppeteerPage) => Promise<{ name: string; value: string; domain: string }[]>,
  onProgress?: (message: string) => void
): Promise<void> => {
  try {
    const userId = await api.getUserId(page)

    if (!userId) return

    const { pobIds, stores } = await api.getPobIds(page, userId)

    if (pobIds.length === 0) return

    const jar = await harvestCookies(page)
    const saved = await publishSession('ajio', username, jar, { userId, pobIds, stores })

    if (saved.success) {
      onProgress?.('Saved the AJIO login for the next run')
      logger.info(`[ajio] saved the session for ${username} (${jar.length} cookies)`)
    } else {
      logger.warn(`[ajio] could not save the session for ${username}: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[ajio] could not save the session for ${username}: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

/** Reads the seller id from browser storage, then its PoBs from inside the page. */
const readPobIds = async (api: ApiDownload, page: PuppeteerPage): Promise<string[]> => {
  const userId = await api.getUserId(page)

  if (!userId) throw new Error('Could not read the AJIO seller id — the login may be dead')

  const { pobIds } = await api.getPobIds(page, userId)

  if (pobIds.length === 0) {
    throw new Error('AJIO returned no Places of Business — the login is not usable')
  }

  return pobIds
}

const isoDaysAgo = (days: number): string =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10)

export const runAjioMasterImport = async (
  flow: AjioFlow,
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  await prepareCoreWithBrowser(onProgress, 'ajio')

  const reportPage = loadCore<ReportPage>('platforms/ajio/master-import/common/reportPage')
  const ui = loadCore<UiDownload>('platforms/ajio/master-import/script-based-flow/downloadReportFlow')
  const api = loadCore<ApiDownload>('platforms/ajio/master-import/api-based-flow/apiReportFlow')
  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<Headless>('common/headless')
  const { loginAjioPage } = loadCore<AjioLogin>('platforms/ajio/common/loginPage')
  const { reuseSessionRecord, harvestCookies } = loadCore<AjioSessionStore>(
    'platforms/ajio/common/sessionStore'
  )
  const { importMasterDataToTrackVid } = loadCore<TrackvidFunctions>(
    'platforms/ajio/master-import/api-based-flow/trackvidFunctions'
  )

  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []

  // The flows write here and it goes on every exit path: these are a company's
  // order records sitting on an operator's own machine.
  const directory = await mkdtemp(join(tmpdir(), 'trackvid-ajio-import-'))

  let browser: PuppeteerBrowser | undefined

  try {
    onProgress?.('Signing in to AJIO…')

    // This runner owns the browser.
    //
    // It previously called `loginAjioApi`, which owns its OWN browser and
    // closes it in a `finally`, returning only the harvested jar — so `page`
    // was always undefined and every run died on "AJIO login returned no page".
    // That function is for CAPTURING a session; both AJIO flows need to keep
    // using the page, so the page-taking login from the core is the right one.
    const puppeteer = runtime.loadPuppeteer()

    if (!puppeteer) throw new Error('No browser available for the AJIO master import')

    browser = await puppeteer.launch({
      headless: isHeadless(),
      executablePath: runtime.resolveExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1440,900'
      ]
    })

    const page = await browser.newPage()

    // A saved session that still works skips the SSO login entirely.
    //
    // AJIO is the one platform `reusableSession` cannot decide on: its check
    // has to run inside a logged-in page, and a caller holding only a jar gets
    // "cannot tell", which means sign in. This runner HAS a page, so it takes
    // the record and probes it here — the core's `reuseSessionRecord`, the same
    // function the automation server's reuse path runs, so both make the same
    // call from the same evidence.
    //
    // On any doubt it returns null having already cleared the page's auth
    // state, and the sign-in below proceeds as though nothing had been tried.
    const stored = await storedSession('ajio', input.username)
    const reused = stored ? await reuseSessionRecord(page, stored, { username: input.username }) : null

    if (!reused) {
      // NO SIGN-IN FROM AN IMPORT — the Login update owns that (signInPolicy).
      refuseSignInUnlessAllowed('ajio', input.username, stored ? 'the saved login did not pass its check' : 'no login is saved on this machine')
      await loginAjioPage(page, { username: input.username, password: input.password }, { logger })

      logger.info(`[ajio-${flow}] signed in as ${input.username}`)
    } else {
      onProgress?.('Reusing the saved AJIO login…')
      logger.info(
        `[ajio-${flow}] reused the saved session for ${input.username} — no sign-in needed`
      )
    }

    // How each flow decides which Places of Business the report covers.
    //
    // These are NOT interchangeable, and doing both is wrong:
    //
    //   api    — pobIds go in the request body, fetched from the work-places
    //            API. No UI is touched, and the page stays on the landing page.
    //   script — the Reports page's own PoB selector is driven, so the page
    //            must be ON the Reports page first.
    //
    // Running the UI selection for the API flow is what produced
    // `Waiting for selector ul[role="listbox"] li failed`: that dropdown only
    // exists on the Reports page, and the API flow never goes there. The
    // automation server imports those helpers and deliberately never calls
    // them for this flow.
    let pobIds: string[] = []

    // A session this run just minted is worth keeping, whichever flow asked for
    // it. Nothing used to save it, which is why reuse never got off the ground:
    // every run signed in, discarded the session, and the next run found
    // nothing to reuse. Best-effort — a save that fails must not fail an import
    // that is otherwise fine.
    if (!reused) await keepSession(input.username, page, api, harvestCookies, onProgress)

    if (flow === 'api') {
      // A reused record already carries both, and its probe just proved they
      // are current — re-reading them would repeat the call that verified them.
      if (reused?.pobIds?.length) {
        pobIds = reused.pobIds

        logger.info(`[ajio-api] ${pobIds.length} place(s) of business (from the saved session)`)
      } else {
        onProgress?.('Reading the seller’s Places of Business…')

        pobIds = await readPobIds(api, page)

        logger.info(`[ajio-api] ${pobIds.length} place(s) of business`)
      }
    } else {
      // The Reports page, where the PoB selector and the View/Export buttons
      // live. Without this the selectors below have nothing to find.
      onProgress?.('Opening the Reports page…')
      await page.goto(REPORT_URL, { waitUntil: 'networkidle2' })

      onProgress?.('Selecting every Place of Business…')

      // Enterprise accounts render this as a "Change" button + modal instead of
      // the usual MUI dropdown.
      if (reportPage.isEnterprisePoBUser(input.username)) {
        await reportPage.selectAllPOBsViaModal(page, logger)
      } else {
        await reportPage.selectAllBrands(page, logger)
      }
    }

    const maxChunkDays = reportPage.isEnterprisePoBUser(input.username)
      ? ENTERPRISE_CHUNK_DAYS
      : api.MAX_CHUNK_DAYS

    // `null` lastSyncDate: the sync date lives in Mongo and this app cannot read
    // it, so every desktop run asks for the full lookback window.
    const from = isoDaysAgo(DEFAULT_LOOKBACK_DAYS)
    const to = isoDaysAgo(0)

    for (const reportType of importTypes) {
      throwIfStopped('ajio master import')
      const chunks = reportPage.splitDateRange(from, to, maxChunkDays)

      logger.info(
        `[ajio-${flow}] ${reportType} ${from} → ${to} split into ${chunks.length} chunk(s) ` +
          `(${maxChunkDays}-day max)`
      )

      let uploaded = 0
      let bytes = 0
      let noData = 0
      const failures: string[] = []

      for (const [index, chunk] of chunks.entries()) {
        throwIfStopped('ajio master import')
        try {
          onProgress?.(
            `Downloading ${reportType} — chunk ${index + 1} of ${chunks.length} ` +
              `(${chunk.fromDate} → ${chunk.toDate})`
          )

          let buffer: Buffer | null = null

          if (flow === 'script') {
            const client = await page.target().createCDPSession()
            const fileName = await ui.downloadReportChunk(page, client, chunk, logger, {
              downloadPath: directory
            })

            // A chunk the portal has no rows for is not an error.
            buffer = fileName ? await readFile(join(directory, fileName)) : null
          } else {
            const result = await api.downloadReport(page, {
              reportType,
              pobIds,
              from: chunk.fromDate,
              to: chunk.toDate
            })

            if (!result.ok) {
              if (result.noData) buffer = null
              else throw new Error(`Download failed (status ${result.status}): ${result.body}`)
            } else {
              buffer = result.buffer ?? null
            }
          }

          if (!buffer) {
            noData += 1
            continue
          }

          const safeType = reportType.replace(/[^a-zA-Z0-9]/g, '_')
          const filePath = join(
            directory,
            `${safeType}_${input.companyId}_${chunk.fromDate}_${chunk.toDate}_${index}.xlsx`
          )

          await writeFile(filePath, buffer)

          const uploadResult = await importMasterDataToTrackVid(reportType, filePath, {
            trackVidEmail: input.trackVidEmail,
            companyId: input.companyId,
            plateForm: 'AJIO',
            username: input.username
          })

          // The upload RETURNS its error rather than throwing; without this a
          // rejection would be recorded as a successful import.
          if (uploadResult?.error) throw new Error(uploadResult.error)

          uploaded += 1
          bytes += buffer.length
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)

          // One bad chunk must not lose the rest of the range.
          failures.push(`${chunk.fromDate}→${chunk.toDate}: ${message}`)
          logger.error(`[ajio-${flow}] chunk failed for ${reportType}`, { message })
        }
      }

      if (failures.length === 0) {
        outcomes.push({
          importType: reportType,
          ok: true,
          bytes,
          message: `${uploaded} chunk(s) uploaded, ${noData} with no data`
        })
        logger.info(
          `[ajio-${flow}] imported ${reportType} for ${input.username} ` +
            `(${uploaded} uploaded, ${noData} empty)`
        )
      } else {
        // Partial success is reported as failure. Some of the range did land,
        // and saying "ok" would advance the sync date over the part that did not.
        outcomes.push({
          importType: reportType,
          ok: false,
          bytes,
          message:
            `${uploaded} of ${chunks.length} chunk(s) uploaded; ` +
            `${failures.length} failed — ${failures.join('; ')}`
        })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    logger.error(`[ajio-${flow}] run failed for ${input.username}`, { message })

    // Anything not already reported per report type failed with the session.
    for (const importType of importTypes) {
      throwIfStopped('ajio master import')
      if (!outcomes.some((outcome) => outcome.importType === importType)) {
        outcomes.push({ importType, ok: false, message })
      }
    }
  } finally {
    await browser?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  return outcomes
}
