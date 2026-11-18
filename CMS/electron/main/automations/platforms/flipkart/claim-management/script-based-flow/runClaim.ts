import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument } from '@main/automations/common/types'
import { discardLease, leasedSession } from '@main/services/browserLease.service'
import { fetchFlipkartOtp } from '@main/services/flipkartOtp.service'
import { publishSession } from '@main/services/platformSession.service'
import { logger } from '@main/services/logger'

/**
 * Files one Flipkart claim by driving the seller portal's UI, from this machine.
 *
 * The counterpart to the api-based runner beside it, and the reason both exist:
 * `apiBasedAutomation.flipkart.claim` decides which one a company gets, and the
 * two are NOT interchangeable — the API flow needs an account whose claims the
 * portal's own endpoints accept, and some accounts only work through the UI.
 * Until this existed, that setting was silently ignored here: a company on the
 * Selenium path had the API flow run on the desktop and the Selenium flow run
 * on the server, from one setting.
 *
 * SELENIUM, NOT PUPPETEER. Every other desktop runner drives Chrome through
 * Puppeteer or plain HTTP; this one drives a chromedriver session, because the
 * sequence it shares with the server is written against a WebDriver. The app
 * already pins both binaries (`browserProvision`), which is what makes that
 * safe on an operator's machine where Chrome updates itself.
 *
 * THE ONE-TIME CODE IS FETCHED, then fallen back on. The server reads it out
 * of Gmail with IMAP credentials only it has; this app must not carry those, so
 * it asks TrackVid for the code instead (see flipkartOtp.service) and gets the
 * same unattended login. If no mail arrives, it asks the person watching the
 * browser rather than failing the claim — which is the one thing this app can
 * do that the server cannot.
 *
 * SESSION REUSE, PROVEN NOT ASSUMED. The stored session is hydrated into the
 * driver and then checked by opening the SPF route and looking for the signed-in
 * dashboard's Payments rail — see `signedInDriver` in the core. A browser has no
 * 401 to tell it a jar is dead, which is why this flow refused to reuse a
 * session at all; a rendered dashboard is the signal it was missing. A failed
 * check costs one navigation and falls through to the sign-in, and the session a
 * sign-in mints is still saved for the API flow.
 *
 * HEADLESS FOLLOWS THE POLICY, and the fallback follows the window. Now that
 * the code is fetched, a visible browser is no longer a requirement, so this
 * obeys `MAIN_VITE_HEADLESS` / `MAIN_VITE_FLIPKART_HEADLESS` and
 * `isAutoLoginOnActiveSession` like everything else. It was briefly forced
 * visible, when the operator WAS the only source of the code — a headless
 * browser cannot be typed into, so the prompt was a guaranteed timeout.
 *
 * The two are tied together on purpose: `operatorFallback` is only offered when
 * the window is actually on screen. Offering it headless would replace a clear
 * "no code arrived" with three silent minutes and the same failure.
 */

interface Driver {
  quit: () => Promise<void>
  manage: () => { getCookies: () => Promise<{ name: string; value: string }[]> }
  [key: string]: unknown
}

interface FlipkartApiFlow {
  /** Reads the token from the page — cookies, then known JS globals. */
  discoverCsrfToken: (driver: Driver, jar: Record<string, string>) => Promise<string | null>
}

interface FlipkartSignIn {
  /**
   * Reuses the stored session when it still reaches a signed-in dashboard, and
   * signs in when it does not. `keep: false` because this app has no database —
   * it publishes what it captures to the backend instead, below.
   */
  signInOrRestore: (
    driver: Driver,
    credentials: { username: string; password?: string },
    options?: {
      session?: { jar: unknown } | null
      allowReuse?: boolean
      keep?: boolean
      login?: {
        fetchOtp?: ((username: string, since?: Date) => Promise<string | null>) | null
        operatorFallback?: boolean
        operatorTimeoutMs?: number
      }
    }
  ) => Promise<{ reused: boolean }>
}

interface FlipkartScriptUtils {
  buildDriver: (options?: { headless?: boolean }) => Promise<Driver>
  /** Quits it AND stops the open-browser registry remembering it. */
  destroyDriver: (driver: Driver) => Promise<void>
  openSpfClaimsPage: (driver: Driver, searchQuery: string, searchTarget: string) => Promise<unknown>
}

type ScriptClaimStatus = 'success' | 'help_center_failed' | 'salvaged' | 'dry_run' | 'failed'

interface FlipkartScriptFlow {
  fileFlipkartClaimByScript: (
    driver: Driver,
    configEntry: ClaimDocument,
    options: {
      credentials: { username: string }
      tempDir: string
      companyId?: string | null
      logger?: unknown
    }
  ) => Promise<{
    status: ScriptClaimStatus
    ticketId: string | null
    cmsStatus: string | null
    message: string
    /** The claim cannot be filed at all — not now, not on a retry. */
    terminal?: boolean
  }>
}

const SEARCH_QUERY = 'spf claim'
const SEARCH_TARGET = 'SPF Claims : Not Approved'

/**
 * Ships the session this run signed in with, so the next batch skips the login.
 *
 * The csrf token goes with it deliberately: Flipkart's stored record is only
 * counted usable when it has one, so a jar saved without it would be discarded
 * on read and every batch would sign in again anyway. It is read from the page
 * by the same function the API flow uses.
 *
 * Best-effort: a session that could not be saved costs the next batch a login.
 * Failing THIS claim over it would cost the dispute.
 */
const keepSession = async (
  driver: Driver,
  username: string,
  discoverCsrfToken: FlipkartApiFlow['discoverCsrfToken']
): Promise<void> => {
  try {
    const cookies = (await driver.manage().getCookies()) as { name: string; value: string }[]
    const jar: Record<string, string> = {}

    for (const cookie of cookies) {
      if (cookie?.name) jar[cookie.name] = cookie.value
    }

    if (Object.keys(jar).length === 0) return

    const csrfToken = await discoverCsrfToken(driver, jar).catch(() => null)

    const saved = await publishSession(
      'flipkart',
      username,
      cookies.map(cookie => ({ name: cookie.name, value: cookie.value, domain: 'seller.flipkart.com' })),
      { ...(csrfToken ? { csrfToken } : {}) }
    )

    if (saved.success) {
      logger.info(
        `[flipkart-script] saved the session for ${username} ` +
          `(${cookies.length} cookies, csrf ${csrfToken ? 'yes' : 'no'})`
      )
    } else {
      logger.warn(`[flipkart-script] could not save the session: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[flipkart-script] could not save the session: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

export const runFlipkartScriptClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('flipkart', doc)
  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('flipkart', username)
  const entry = requireClaimConfig('flipkart', doc)

  await prepareCoreWithBrowser(undefined, 'flipkart')

  const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
  const utils = loadCore<FlipkartScriptUtils>(
    'platforms/flipkart/claim-management/common/utils'
  )
  const { discoverCsrfToken } = loadCore<FlipkartApiFlow>(
    'platforms/flipkart/claim-management/api-based-flow/claimApiFlow'
  )
  const { signInOrRestore } = loadCore<FlipkartSignIn>(
    'platforms/flipkart/claim-management/script-based-flow/signedInDriver'
  )
  const flow = loadCore<FlipkartScriptFlow>(
    'platforms/flipkart/claim-management/script-based-flow/fileClaim'
  )

  // One signed-in driver for a whole batch — see browserLease. Signing in to
  // Flipkart is the expensive part by a wide margin: it can involve a one-time
  // code, and asking an operator for one per claim would be unusable.
  const { context, release } = await leasedSession(`flipkart-script:${username}`, async () => {
    // Per platform, so MAIN_VITE_FLIPKART_HEADLESS wins over MAIN_VITE_HEADLESS
    // and a company with scripted sign-in turned off still gets a window.
    const headless = isHeadless('flipkart')
    const driver = await utils.buildDriver({ headless })

    try {
      // THE STORED SESSION FIRST, and a sign-in only when it does not work.
      //
      // `claimCredentials` has already read it off the local company document
      // and had the marketplace verify it, so by the time it reaches here it is
      // the same session the API flow would reuse. The core hydrates it and then
      // opens the SPF route to check for the signed-in dashboard's Payments
      // rail — the proof a browser otherwise cannot produce, and the reason this
      // flow used to sign in on every single claim while a good session sat in
      // company settings.
      const { reused } = await signInOrRestore(
        driver,
        { username, password: credentials.password },
        {
          session: { jar: credentials.jar },
          // This app has no database: the core's session store cannot write
          // here. The publish below is how a session it mints gets kept.
          keep: false,
          login: {
            // Read the code automatically, exactly as the server does — but
            // through TrackVid rather than by holding the mailbox credentials.
            fetchOtp: fetchFlipkartOtp,
            // Only when there is a window to type into. Headless, this would
            // trade a clear "no code arrived" for three silent minutes and the
            // same failure.
            operatorFallback: !headless,
            operatorTimeoutMs: 180000
          }
        }
      )

      logger.info(
        reused
          ? `[flipkart-script] reused the stored session for ${username} — no sign-in, no one-time code`
          : `[flipkart-script] signed in as ${username}`
      )

      // Only what this run actually minted. Re-publishing a session that was
      // merely REUSED would stamp a fresh expiry on somebody else's record and
      // relabel its source as this app's, which is how the question "where did
      // this session come from" stops having an answer.
      if (!reused) await keepSession(driver, username, discoverCsrfToken)

      await utils.openSpfClaimsPage(driver, SEARCH_QUERY, SEARCH_TARGET)

      return {
        // The lease speaks Puppeteer; a WebDriver session closes with quit().
        // Through the core's `destroyDriver` so the open-browser registry stops
        // remembering it — otherwise a sign-out later tries to quit a driver
        // that ended with this batch.
        browser: { close: () => utils.destroyDriver(driver) },
        page: driver,
        context: { driver }
      }
    } catch (error) {
      // The driver belongs to this function until it returns, so a failed
      // sign-in has to close it here — nothing upstream is holding it yet.
      await utils.destroyDriver(driver).catch(() => undefined)

      throw error
    }
  })

  try {
    return await withTempDir(async (tempDir: string) => {
      const outcome = await flow.fileFlipkartClaimByScript(context.driver, entry, {
        credentials: { username },
        tempDir,
        companyId: claim.companyId,
        logger
      })

      return toProcessResult(claim, outcome)
    })
  } catch (error) {
    // A thrown error here is not the marketplace answering — the sequence
    // reports those. It is the driver or the session, so the next claim starts
    // with a fresh one rather than inheriting whatever broke.
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
 * again. Returning a ProcessResult for `failed` would record a claim that was
 * never filed as filed — the worst outcome available, because nothing retries
 * it and the seller never gets their money.
 */
export const toProcessResult = (
  claim: QueuedClaim,
  outcome: {
    status: ScriptClaimStatus
    ticketId: string | null
    cmsStatus: string | null
    message: string
    terminal?: boolean
  }
): ProcessResult => {
  switch (outcome.status) {
    case 'success':
      return { cmsId: claim.cmsId, ticketId: outcome.ticketId, message: outcome.message, cmsStatus: null }

    // A claim that WAS filed and whose number we could not read, or one that
    // already existed on the order. Recording the id is the whole point: a
    // retry that did not know would file a second claim for the same return.
    case 'salvaged':
      return {
        cmsId: claim.cmsId,
        ticketId: outcome.ticketId,
        message: outcome.message,
        cmsStatus: outcome.cmsStatus
      }

    case 'help_center_failed':
      return { cmsId: claim.cmsId, ticketId: null, message: outcome.message, cmsStatus: null }

    // DISABLE_SUBMIT. Thrown with the tagged code so the processor treats it as
    // a dry run and leaves the row claimable, exactly as the other runners do.
    case 'dry_run': {
      const error = new Error(outcome.message) as Error & { code?: string }

      error.code = 'CLAIM_SUBMIT_DISABLED'

      throw error
    }

    default: {
      const error = new Error(outcome.message || 'Flipkart claim failed') as Error & {
        terminal?: boolean
      }

      // EF2 — the packet cannot be selected, so there is nothing to claim
      // against however many times it is tried. Carried up so the row is moved
      // to "Failed to Proceed" now rather than after it has spent its remaining
      // attempts on something that cannot succeed.
      if (outcome.terminal) error.terminal = true

      throw error
    }
  }
}
