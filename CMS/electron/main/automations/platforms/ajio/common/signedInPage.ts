import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { storedSession } from '@main/services/sessionReuse.service'
import { publishSession } from '@main/services/platformSession.service'
import { credentialFor, orderedPobIds } from '@main/services/company.service'
import { logger } from '@main/services/logger'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'
import { OTP_FETCHERS } from '@main/services/localLogin.service'
import { OTP_WAIT_MS } from '@main/services/otpSource'

/**
 * A signed-in AJIO page, reusing the stored session whenever it still works.
 *
 * ONE COPY, used by every AJIO automation on this machine — the claim runner,
 * the account-mapping probe and the SKU picker. It was one copy in the claim
 * runner and two half-copies beside it, and the halves were missing the last
 * step: they signed in and never SAVED the session, so every single press
 * logged in again while a perfectly good record sat unused. Nothing about that
 * is visible from reading either file, which is exactly why the sequence has to
 * live in one place.
 *
 * The order matters and each step is load-bearing:
 *
 *   1. Hydrate the stored jar and PROBE it from inside the page. AJIO cannot be
 *      checked from a jar alone — `common/probeSession.js` omits it on purpose —
 *      so this in-page work-places call IS the "is the session alive" test.
 *   2. Sign in only if that fails. This is the automatic re-capture: an expired
 *      session is replaced without anyone being asked.
 *   3. SAVE what the sign-in produced. `reuseSessionRecord` refuses a record
 *      without `userId`, a non-empty `pobIds` and an HttpOnly `bff_session`
 *      cookie, so a session that is never saved — or saved without those — can
 *      never be reused, and the next call signs in again. Forever.
 */

export interface PuppeteerPage extends Record<string, unknown> {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>
}

export interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>
  close: () => Promise<void>
}

interface BrowserRuntime {
  loadPuppeteer: () => { launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowser> } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

interface AjioLogin {
  loginAjioPage: (
    page: PuppeteerPage,
    credentials: { username: string; password: string },
    options?: {
      logger?: unknown
      /** Read a mailed code when the SSO shows "Verify your identity". */
      fetchOtp?: ((username: string, since: Date, timeoutMs?: number) => Promise<string | null>) | null
      otpWaitMs?: number
    }
  ) => Promise<{ ok: true }>
}

interface AjioSessionStore {
  reuseSessionRecord: (
    page: PuppeteerPage,
    record: unknown,
    options?: { username?: string; landingUrl?: string }
  ) => Promise<{ userId: string; pobIds: string[] } | null>
  /** Reads every cookie the page holds, HttpOnly included (CDP). */
  harvestCookies: (
    page: PuppeteerPage
  ) => Promise<{ name: string; value: string; domain: string }[]>
}

interface AjioPobs {
  getPobIds: (
    page: PuppeteerPage,
    userId: string
  ) => Promise<{ pobIds: string[]; stores: { id: string; storeName?: string }[] }>
}

interface AjioClaimFlow {
  getUserId: (page: PuppeteerPage) => Promise<string | null>
}

export interface SignedInAjioPage {
  browser: PuppeteerBrowser
  page: PuppeteerPage
  /** Every AJIO API URL is built from this. */
  sellerId: string
  /** The account's places of business, most recently useful first. */
  pobIds: string[]
  /** True when the stored session was good and no sign-in happened. */
  reused: boolean
}

/**
 * Ships the session this run signed in with, so the next call skips the login.
 *
 * AJIO's ingest refuses a jar without `userId` and `pobIds` — every API URL is
 * built from the seller id, and the download needs at least one place of
 * business — so both go with it.
 *
 * The POB list comes from the credential's stored one first: it is what Monitor
 * writes and what everything else here reads, and re-fetching it means a paged
 * API sweep to rebuild a list already in memory. AJIO is only asked when the
 * credential has never been synced, because a save without POBs is a record
 * that can never be reused.
 *
 * Best-effort by design: a session that could not be saved costs the next call a
 * login. Failing the work in hand over it would cost considerably more.
 */
const keepSession = async (
  username: string,
  page: PuppeteerPage,
  sellerId: string,
  pobs: AjioPobs,
  harvestCookies: AjioSessionStore['harvestCookies'],
  storedPobIds: string[]
): Promise<void> => {
  try {
    let pobIds = storedPobIds
    let stores: { id: string; storeName?: string }[] = []

    if (pobIds.length === 0) {
      const live = await pobs.getPobIds(page, sellerId)

      pobIds = live.pobIds
      stores = live.stores
    }

    if (pobIds.length === 0) {
      logger.warn(
        `[ajio-session] no POBs for ${username} — the session cannot be saved in a reusable ` +
          'shape, so the next run will sign in again. Run Sync POBs for this account in Monitor.'
      )

      return
    }

    const jar = await harvestCookies(page)
    const saved = await publishSession('ajio', username, jar, { userId: sellerId, pobIds, stores })

    if (saved.success) {
      logger.info(`[ajio-session] saved the session for ${username} (${jar.length} cookies)`)
    } else {
      logger.warn(`[ajio-session] could not save the session: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[ajio-session] could not save the session: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

/**
 * Launches a browser and brings it to a signed-in AJIO page.
 *
 * The browser is the CALLER'S once this returns — close it, or hand it to the
 * lease. On any failure before returning it is closed here, because nothing
 * upstream is holding it yet.
 */
export const openSignedInAjioPage = async (input: {
  username: string
  password: string
}): Promise<SignedInAjioPage> => {
  await prepareCoreWithBrowser(undefined, 'ajio')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
  const { loginAjioPage } = loadCore<AjioLogin>('platforms/ajio/common/loginPage')
  const { reuseSessionRecord, harvestCookies } = loadCore<AjioSessionStore>(
    'platforms/ajio/common/sessionStore'
  )
  const pobs = loadCore<AjioPobs>('platforms/ajio/master-import/api-based-flow/apiReportFlow')
  const flow = loadCore<AjioClaimFlow>(
    'platforms/ajio/claim-management/api-based-flow/updatedClaimApiFlow'
  )

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for AJIO')

  // Read before the launch: it costs nothing, and an account with no POBs
  // stored is one whose session cannot be saved reusably — worth knowing at the
  // start rather than after a sign-in.
  const credential = await credentialFor('ajio', input.username)
  const storedPobIds = orderedPobIds(credential?.pobIds ?? [])

  const browser = await puppeteer.launch({
    headless: isHeadless('ajio'),
    executablePath: runtime.resolveExecutablePath(),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1440,900'
    ]
  })

  try {
    const page = await browser.newPage()

    // The stored session, hydrated and probed in-page. `reuseSessionRecord`
    // returns null on ANY doubt, having already cleared the page's auth state,
    // so the sign-in below proceeds as though nothing had been tried.
    const stored = await storedSession('ajio', input.username)
    const reused = stored
      ? await reuseSessionRecord(page, stored, { username: input.username })
      : null

    if (!reused) {
      // Only session capture signs in (signInPolicy).
      refuseSignInUnlessAllowed('ajio', input.username, stored ? 'the saved login did not pass its check' : 'no login is saved on this machine')
      await loginAjioPage(
        page,
        { username: input.username, password: input.password },
        // An account challenged with a one-time code is answered from this
        // machine's mailbox; null (no reader) fails it as OTP_REQUIRED.
        { logger, fetchOtp: OTP_FETCHERS.ajio ?? null, otpWaitMs: OTP_WAIT_MS }
      )
      logger.info(`[ajio-session] signed in as ${input.username}`)
    } else {
      logger.info(`[ajio-session] reused the saved session for ${input.username}`)
    }

    // A reused record already carries the seller id, and its probe just proved
    // it current.
    const sellerId = reused?.userId ?? (await flow.getUserId(page))

    if (!sellerId) {
      throw new Error('Could not read the AJIO seller id — the login may be dead')
    }

    // THE STEP THAT WAS MISSING. Without it every entry point signs in, works,
    // and throws the session away — so the next one signs in too.
    if (!reused) await keepSession(input.username, page, sellerId, pobs, harvestCookies, storedPobIds)

    return {
      browser,
      page,
      sellerId,
      // The freshly-saved list when there was none stored, so a first run still
      // has something to search.
      pobIds: storedPobIds.length > 0 ? storedPobIds : (reused?.pobIds ?? []),
      reused: reused !== null
    }
  } catch (error) {
    await browser.close().catch(() => undefined)

    throw error
  }
}
