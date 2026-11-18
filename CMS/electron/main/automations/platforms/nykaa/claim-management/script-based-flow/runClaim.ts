import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import type { ClaimDocument } from '@main/automations/common/types'
import { discardLease, leasedSession } from '@main/services/browserLease.service'
import { logger } from '@main/services/logger'

/**
 * Files one Nykaa claim by driving the dispute portal's UI, from this machine.
 *
 * The counterpart to the api-based runner beside it. Which one a company gets
 * is `apiBasedAutomation.nykaa.claim`, and the two are not interchangeable: the
 * API flow signs its writes with a CSRF token read from the portal's own
 * cookies, and an account whose jar is missing it can still file perfectly well
 * through the UI — where the browser sends that header itself.
 *
 * SIGN IN ONCE, then keep the page. Nykaa's login runs through a Zoho iframe
 * and the session has to persist across claims: re-navigating to /signin while
 * already authenticated redirects away and the iframe never appears. So the
 * signed-in page is held by the browser lease for the whole batch, exactly as
 * the automation server holds one page for a whole job.
 */

interface Page extends Record<string, unknown> {
  close: () => Promise<void>
}

interface Browser {
  newPage: () => Promise<Page>
  close: () => Promise<void>
}

interface BrowserRuntime {
  loadPuppeteer: () => { launch: (options: Record<string, unknown>) => Promise<Browser> } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

interface NykaaLogin {
  loginNykaa: (page: Page, credentials: { email: string; password: string }) => Promise<unknown>
  dismissTerminateSessionsPopup: (page: Page) => Promise<unknown>
}

type ScriptClaimStatus = 'success' | 'help_center_failed' | 'dry_run' | 'failed'

interface NykaaScriptFlow {
  fileNykaaClaimByScript: (
    page: Page,
    configEntry: ClaimDocument,
    options?: { logger?: unknown }
  ) => Promise<{ status: ScriptClaimStatus; ticketId: string | null; message: string }>
}

export const runNykaaScriptClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('nykaa', doc)
  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('nykaa', username)
  const entry = requireClaimConfig('nykaa', doc)

  await prepareCoreWithBrowser(undefined, 'nykaa')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
  const { loginNykaa, dismissTerminateSessionsPopup } = loadCore<NykaaLogin>(
    'platforms/nykaa/claim-management/common/utils'
  )
  const flow = loadCore<NykaaScriptFlow>(
    'platforms/nykaa/claim-management/script-based-flow/fileClaim'
  )

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for the Nykaa claim')

  // One signed-in page for the whole batch — see browserLease. Signing in is
  // the expensive part, and Nykaa's session cannot survive a second sign-in
  // attempt on the same account anyway.
  const { context, release } = await leasedSession(`nykaa-script:${username}`, async () => {
    const browser = await puppeteer.launch({
      headless: isHeadless('nykaa'),
      executablePath: runtime.resolveExecutablePath(),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1920,1080'
      ]
    })

    try {
      const page = await browser.newPage()

      await loginNykaa(page, { email: username, password: credentials.password })
      logger.info(`[nykaa-script] signed in as ${username}`)

      // "Terminate all other sessions" can appear right after the login and
      // blocks everything underneath it. Never fatal.
      await dismissTerminateSessionsPopup(page).catch(() => undefined)

      return { browser, page, context: { page } }
    } catch (error) {
      // The browser belongs to this function until it returns, so a failed
      // sign-in has to close it here — nothing upstream is holding it yet.
      await browser.close().catch(() => undefined)

      throw error
    }
  })

  try {
    const outcome = await flow.fileNykaaClaimByScript(context.page, entry, { logger })

    return toProcessResult(claim, outcome)
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

    // The ticket EXISTS at Nykaa; only its number could not be read. Not a
    // failure — reporting it as one invites a retry that files a second ticket
    // for the same return.
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
      throw new Error(outcome.message || 'Nykaa claim failed')
  }
}
