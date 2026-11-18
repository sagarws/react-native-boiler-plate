import { claimCredentials } from '@main/services/claimSession.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { logger } from '@main/services/logger'
import type { AccountProbe, MappingCredential, ProbeAnswer } from '@main/automations/accountMapping/types'

/**
 * Asks one Meesho supplier account whether it holds an AWB, by looking.
 *
 * The only platform here with no API that can answer. Meesho's supplier
 * endpoints are keyed on the SUB-ORDER NUMBER end to end, and an unmapped row
 * has no sub-order number either — that is the same blank this run is trying
 * to fill. The supplier portal's Returns screen searches by AWB and lists only
 * the signed-in supplier's returns, so it can answer when nothing else can.
 *
 * NO SESSION REUSE, deliberately. This is a script-based flow, and rehydrating
 * a stored jar into a Meesho page has put the automation on the login screen
 * while the script carried on clicking underneath it. It signs in.
 */

interface Page extends Record<string, unknown> {
  setViewport: (size: { width: number; height: number }) => Promise<void>
}

interface Browser {
  newPage: () => Promise<Page>
  close: () => Promise<void>
}

interface BrowserRuntime {
  loadPuppeteer: () => { launch: (options: Record<string, unknown>) => Promise<Browser> } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

interface MeeshoBrowserHelpers {
  enableStealthMode: (page: Page) => Promise<unknown>
  handleDialog: (page: Page) => Promise<unknown>
}

interface MeeshoLogin {
  meeshoLogin: (page: Page, credentials: { username: string; password: string }) => Promise<unknown>
}

interface MeeshoUtils {
  handleAdvertisementPopup: (page: Page) => Promise<unknown>
}

interface MeeshoProbe {
  probeMeeshoAwb: (
    page: Page,
    awb: string,
    options?: { settleMs?: number; logger?: unknown }
  ) => Promise<ProbeAnswer>
}

export const openMeeshoProbe = async (credential: MappingCredential): Promise<AccountProbe> => {
  const credentials = await claimCredentials('meesho', credential.username)

  await prepareCoreWithBrowser(undefined, 'meesho')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
  const { enableStealthMode, handleDialog } = loadCore<MeeshoBrowserHelpers>(
    'platforms/meesho/common/browserHelpers'
  )
  const { meeshoLogin } = loadCore<MeeshoLogin>('platforms/meesho/master-import/common/meeshoLogin')
  const { handleAdvertisementPopup } = loadCore<MeeshoUtils>(
    'platforms/meesho/claim-management/common/utils'
  )
  const { probeMeeshoAwb } = loadCore<MeeshoProbe>(
    'platforms/meesho/account-mapping/script-based-flow/probeAwb'
  )

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available to map Meesho accounts')

  const browser = await puppeteer.launch({
    headless: isHeadless('meesho'),
    executablePath: runtime.resolveExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--window-size=1920,1080'
    ]
  })

  try {
    const page = await browser.newPage()

    await page.setViewport({ width: 1280, height: 800 })
    await enableStealthMode(page)
    await handleDialog(page)
    await meeshoLogin(page, { username: credential.username, password: credentials.password })

    logger.info(`[account-map/meesho] signed in as ${credential.username}`)

    // Meesho greets a fresh session with a promo overlay that swallows every
    // click underneath it. Never fatal.
    await handleAdvertisementPopup(page).catch(() => undefined)

    return {
      ask: (awb: string) => probeMeeshoAwb(page, awb, { logger }),
      close: async () => {
        await browser.close().catch(() => undefined)
      }
    }
  } catch (error) {
    await browser.close().catch(() => undefined)

    throw error
  }
}
