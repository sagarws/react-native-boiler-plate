import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'

/**
 * Meesho master import by driving the supplier portal.
 *
 * A port of the automation server's
 * `src/platforms/meesho/master-import/script-based-flow/script.js`: one login,
 * then each import type run inside that same session.
 *
 * Unlike Snapdeal there is no request/collect split and no queue, because
 * Meesho does not build a report in the background — the export is produced and
 * downloaded within the one page visit. Splitting it would add a second login
 * for nothing.
 *
 * The core flows download AND upload: `runForwardFlow` / `runReturnsFlow` call
 * `importMasterDataToTrackVid` themselves. This file only opens the browser,
 * signs in, and says which flows to run — the same division the server keeps.
 */

interface BrowserRuntime {
  loadPuppeteer: () => {
    launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowser>
  } | null
  resolveExecutablePath: () => string | undefined
}

interface Headless {
  isHeadless: () => boolean
}

interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>
  close: () => Promise<void>
}

type PuppeteerPage = Record<string, unknown> & {
  createCDPSession: () => Promise<{ send: (method: string, params: unknown) => Promise<unknown> }>
}

/** The shape the core flows read off their `config` argument. */
interface FlowConfig {
  companyId: string
  companyName: string
  trackVidEmail: string
  plateForm: string
  username: string
  importType: string
  scenario: string
  lastSyncDate: string | null
  tempFilePath: string
}

interface MeeshoLogin {
  meeshoLogin: (page: PuppeteerPage, credentials: { username: string; password: string }) => Promise<unknown>
}

interface ForwardFlow {
  runForwardFlow: (page: PuppeteerPage, config: FlowConfig) => Promise<unknown>
  navigateToDashboard: (page: PuppeteerPage) => Promise<unknown>
}

interface ReturnsFlow {
  runReturnsFlow: (page: PuppeteerPage, config: FlowConfig) => Promise<unknown>
}

interface PuppeteerHelpers {
  handleAdvertisementPopup: (page: PuppeteerPage) => Promise<unknown>
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

/**
 * Meesho's two exports, mirroring the server's configBuilder.
 *
 * Forward first: it is the one the API flow can also do, so running it first
 * keeps the two flows comparable when something goes wrong.
 */
const DEFAULT_IMPORT_TYPES = ['forwardOrderData', 'returnOrderData']

/** A login that failed because the password is wrong, not because the portal was slow. */
const isAuthFailure = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith('LOGIN_FAILED_')

export const runMeeshoMasterImport = async (
  input: MasterImportInput,
  onProgress?: (message: string) => void
): Promise<MasterImportOutcome[]> => {
  await prepareCoreWithBrowser(onProgress, 'meesho')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<Headless>('common/headless')
  const { meeshoLogin } = loadCore<MeeshoLogin>('platforms/meesho/master-import/common/meeshoLogin')
  const { runForwardFlow, navigateToDashboard } = loadCore<ForwardFlow>(
    'platforms/meesho/master-import/script-based-flow/forwardOrdersFlow'
  )
  const { runReturnsFlow } = loadCore<ReturnsFlow>(
    'platforms/meesho/master-import/script-based-flow/returnOrdersFlow'
  )
  const { handleAdvertisementPopup } = loadCore<PuppeteerHelpers>(
    'platforms/meesho/master-import/script-based-flow/puppeteerHelpers'
  )

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for the Meesho master import')

  const importTypes = input.importTypes?.length ? input.importTypes : DEFAULT_IMPORT_TYPES
  const outcomes: MasterImportOutcome[] = []

  // The flows write their download here and delete it after uploading; the
  // directory goes with it on every exit path, because these are a company's
  // order records sitting on an operator's own machine.
  const directory = await mkdtemp(join(tmpdir(), 'trackvid-meesho-import-'))

  let browser: PuppeteerBrowser | undefined

  try {
    onProgress?.('Signing in to Meesho…')

    browser = await puppeteer.launch({
      headless: isHeadless(),
      executablePath: runtime.resolveExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ]
    })

    const page = await browser.newPage()

    // Downloads must land in our temp directory, not the operator's Downloads
    // folder — the flows look for the file where they put it.
    const client = await page.createCDPSession()

    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: directory })

    try {
      await meeshoLogin(page, { username: input.username, password: input.password })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const badCredentials = isAuthFailure(error)

      logger.error(`[meesho-script] login failed for ${input.username}`, { message, badCredentials })

      // Every import type fails together — none of them got a session.
      return importTypes.map((importType) => ({
        importType,
        ok: false,
        message: badCredentials
          ? `Meesho rejected the sign-in for ${input.username} — the password has probably changed`
          : message
      }))
    }

    logger.info(`[meesho-script] signed in as ${input.username}`)

    // Best-effort: an interstitial ad covers the navigation the flows need.
    await handleAdvertisementPopup(page).catch(() => undefined)
    await navigateToDashboard(page)

    for (const importType of importTypes) {
      const config: FlowConfig = {
        companyId: input.companyId,
        companyName: input.companyName ?? '',
        trackVidEmail: input.trackVidEmail,
        plateForm: 'MEESHO',
        username: input.username,
        importType,
        // `null` lastSyncDate: the sync date lives in Mongo and this app cannot
        // read it, so every desktop run asks for the full window. Correct but
        // not minimal — narrowing it needs the sync-date gap closed first.
        scenario: 'SCENARIO_1_FULL',
        lastSyncDate: null,
        tempFilePath: directory
      }

      try {
        onProgress?.(`Downloading the ${importType} report…`)

        if (importType === 'forwardOrderData') await runForwardFlow(page, config)
        else if (importType === 'returnOrderData') await runReturnsFlow(page, config)
        else throw new Error(`Unknown Meesho importType: ${importType}`)

        // The flows upload as their last step and throw if TrackVid rejects it,
        // so reaching here means the data actually landed.
        outcomes.push({ importType, ok: true })
        logger.info(`[meesho-script] imported ${importType} for ${input.username}`)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        outcomes.push({ importType, ok: false, message })
        logger.error(`[meesho-script] ${importType} failed for ${input.username}`, { message })

        // Back to a known page before the next import type — a flow that failed
        // mid-navigation leaves the SPA somewhere the next one cannot start from.
        await navigateToDashboard(page).catch((navError: unknown) => {
          logger.warn(
            `[meesho-script] could not return to the dashboard: ${
              navError instanceof Error ? navError.message : String(navError)
            }`
          )
        })
      }
    }
  } finally {
    await browser?.close().catch(() => undefined)
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
  }

  return outcomes
}
