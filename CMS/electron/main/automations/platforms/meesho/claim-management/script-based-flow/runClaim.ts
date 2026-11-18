import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { meeshoClaimEntry } from '../common/claimEntry'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument } from '@main/automations/common/types'
import { discardLease, leasedSession } from '@main/services/browserLease.service'
import { logger } from '@main/services/logger'
import { requireMeeshoClaimPreflight } from '../common/preflight'

/**
 * Files one Meesho claim by driving the supplier portal's UI, from this machine.
 *
 * The counterpart to the api-based runner beside it; which one a company gets is
 * `apiBasedAutomation.meesho.claim`. The two are not interchangeable — the API
 * flow needs an account whose claims the portal's own endpoints accept, and some
 * accounts only work through the form.
 *
 * EVERY STEP COMES FROM THE CORE. The field helpers were already shared; the
 * three functions that use them moved there too (`fileMeeshoClaimByScript`), so
 * this file holds no marketplace knowledge at all — just the browser, the
 * sign-in and the mapping onto this app's result. That is the whole point: the
 * server and the desktop file a Meesho claim through one piece of code.
 *
 * SIGN IN ONCE, then keep the page. The login is the expensive part and the
 * session has to persist across claims, so the signed-in page is held by the
 * browser lease for the batch — the same thing the server does with one page
 * for a whole job.
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

type ScriptClaimStatus =
  | 'success'
  | 'already_raised'
  | 'help_center_failed'
  | 'dry_run'
  | 'failed'

interface MeeshoScriptFlow {
  fileMeeshoClaimByScript: (
    page: Page,
    configEntry: ClaimDocument,
    options: { tempDir: string; companyId?: string | null; logger?: unknown }
  ) => Promise<{ status: ScriptClaimStatus; ticketId: string | null; message: string }>
}

export const runMeeshoScriptClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('meesho', doc)
  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('meesho', username)
  const entry = meeshoClaimEntry(doc)

  // BEFORE the browser opens: if a required field is missing, opening a
  // window, signing in and filling every other slot only for Submit to sit
  // disabled at the end is wasted work and — for the video/image slots —
  // downloaded evidence for a claim that could not be submitted anyway.
  requireMeeshoClaimPreflight(awb, entry)

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
  const flow = loadCore<MeeshoScriptFlow>(
    'platforms/meesho/claim-management/script-based-flow/fileClaim'
  )

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for the Meesho claim')

  const { context, release } = await leasedSession(`meesho-script:${username}`, async () => {
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
      await meeshoLogin(page, { username, password: credentials.password })

      logger.info(`[meesho-script] signed in as ${username}`)

      // Meesho greets a fresh session with a promo overlay that swallows every
      // click underneath it. Never fatal.
      await handleAdvertisementPopup(page).catch(() => undefined)

      return { browser, page, context: { page } }
    } catch (error) {
      // The browser belongs to this function until it returns, so a failed
      // sign-in has to close it here — nothing upstream is holding it yet.
      await browser.close().catch(() => undefined)

      throw error
    }
  })

  try {
    // A fresh directory per claim, removed on every exit path. The evidence is
    // a customer's photos and video, and this is an operator's own machine.
    return await withTempDir(async (tempDir: string) => {
      const outcome = await flow.fileMeeshoClaimByScript(context.page, entry, {
        tempDir,
        companyId: claim.companyId,
        logger
      })

      return toProcessResult(claim, outcome)
    })
  } catch (error) {
    // The sequence reports marketplace outcomes rather than throwing, so
    // reaching here means the page or the session broke. The next claim starts
    // with a fresh one rather than inheriting it.
    await discardLease()

    throw error
  } finally {
    await release()
  }
}

/**
 * Maps the sequence's vocabulary onto this app's result.
 *
 * The sequence never throws, so this is where a real failure has to become one
 * again — returning a ProcessResult for `failed` would record a claim that was
 * never filed as filed.
 */
export const toProcessResult = (
  claim: QueuedClaim,
  outcome: { status: ScriptClaimStatus; ticketId: string | null; message: string }
): ProcessResult => {
  switch (outcome.status) {
    case 'success':
      return { cmsId: claim.cmsId, ticketId: outcome.ticketId, message: outcome.message, cmsStatus: null }

    // Meesho already had a ticket for this AWB and told us its number when the
    // AWB was entered. Recording it is the whole point: the claim exists, and a
    // row left open would be retried into a SECOND ticket for one return.
    case 'already_raised':
      return { cmsId: claim.cmsId, ticketId: outcome.ticketId, message: outcome.message, cmsStatus: null }

    // The form WAS submitted and the ticket almost certainly exists upstream;
    // only its id could not be read. Not a failure — reporting it as one
    // invites a retry that raises a second ticket for the same return.
    case 'help_center_failed':
      return { cmsId: claim.cmsId, ticketId: null, message: outcome.message, cmsStatus: null }

    // DISABLE_SUBMIT. Tagged so the processor treats it as a dry run and leaves
    // the row claimable, exactly as the other runners do.
    case 'dry_run': {
      const error = new Error(outcome.message) as Error & { code?: string }

      error.code = 'CLAIM_SUBMIT_DISABLED'

      throw error
    }

    default:
      throw new Error(outcome.message || 'Meesho claim failed')
  }
}
