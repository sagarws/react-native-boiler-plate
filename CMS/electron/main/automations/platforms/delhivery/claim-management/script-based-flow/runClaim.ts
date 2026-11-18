import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'
import { claimCredentials } from '@main/services/claimSession.service'
import { requireClaimAccount } from '@main/automations/common/claimAccount'
import { requireClaimConfig } from '@main/automations/common/claimConfig'
import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { withTempDir } from '@main/automations/common/tempDir'
import type { ClaimDocument } from '@main/automations/common/types'
import { leasedSession } from '@main/services/browserLease.service'
import { logger } from '@main/services/logger'

/**
 * Files one Delhivery claim by driving the portal's own drawer, from this
 * machine.
 *
 * THE COUNTERPART TO THE API RUNNER BESIDE IT, and the two are not
 * interchangeable. The support API takes a request it dislikes and answers 200
 * with no ticket id — no error, nothing to act on — while the drawer refuses
 * the same claim with a sentence a person can read ("the claim window has
 * closed", "a previous claim for this issue wasn't approved"). Which one a
 * company gets is `apiBasedAutomation.delhivery.claim`; until this existed that
 * setting was quietly ignored here, and a company on the Selenium path had the
 * API flow run on the desktop while the server ran Selenium — one setting, two
 * different claims.
 *
 * SELENIUM, like Flipkart's script runner next door: the sequence it shares with
 * the server is written against a WebDriver, and the app pins both the browser
 * and the matching chromedriver (`browserProvision`), which is what makes that
 * safe on a machine whose Chrome updates itself.
 *
 * ONE SIGN-IN PER ACCOUNT, NOT PER CLAIM. The first version built a driver,
 * signed in and quit it for every claim — so twenty claims on one login meant
 * twenty launches of Chrome and twenty sign-ins, each a minute of nothing.
 * `leasedSession` keeps the signed-in driver for as long as the batch holds the
 * lease, and the processor already orders a selection so one account's claims
 * run together (`groupedByAccount`), which is what makes the reuse actually
 * happen rather than thrashing between two logins.
 *
 * THE KEY CARRIES THE LANE AS WELL AS THE LOGIN. A different account is
 * obviously a different browser — but so is a different `domestic`
 * (EXPRESS / SURFACE), because Delhivery holds that pick SERVER-SIDE for the
 * session. One login with claims on both lanes would otherwise file the second
 * lane's claims against the first, which is a claim raised from the wrong
 * seller and is invisible until somebody reconciles it. Two lanes cost one
 * extra sign-in; getting it wrong costs a claim.
 *
 * Outside a batch — a single claim arriving over the socket — no lease is open
 * and `release()` closes the browser as it always did.
 *
 * THE DOMESTIC ACCOUNT IS SESSION STATE, not a per-claim field. Delhivery holds
 * the pick server-side, so it is set once after sign-in from the row's own
 * `domestic` (EXPRESS / SURFACE). A missing header dropdown is not fatal — some
 * account layouts do not have one, and the active account is then already the
 * right one.
 */

interface Driver {
  quit: () => Promise<void>
  [key: string]: unknown
}

interface DelhiveryScriptUtils {
  buildDriver: () => Promise<Driver>
  delhiveryLogin: (driver: Driver, credentials: { username: string; password?: string }) => Promise<unknown>
  pickDomesticAccount: (driver: Driver, domestic: string) => Promise<void>
  downloadFile: (url: string, filename: string, tempPath: string) => Promise<string | null>
}

interface DelhiveryScriptFlow {
  fileDelhiveryClaimByScript: (
    driver: Driver,
    configEntry: Record<string, unknown>,
    unboxingPaths: string[],
    options?: { log?: unknown }
  ) => Promise<{
    ticketId: string | null
    tab: string | null
    cmsStatus: string | null
    priorClaim: boolean
  }>
}

/**
 * The browser this claim may share: ONE PER ACCOUNT.
 *
 * NOT PER LANE, which is what this was and why every claim still signed in. The
 * lane (EXPRESS / SURFACE) is session state at Delhivery, so putting it in the
 * key looked right — but a batch that mixes lanes, or any row whose Domestic
 * field is blank, then gets a different key for almost every claim and the
 * lease closes the browser each time. Twenty-five claims, twenty-five logins,
 * which is exactly what the lease exists to stop.
 *
 * The lane is handled where it belongs instead: `laneToSwitch` below says when
 * the session has to be moved, and moving it is one dropdown rather than a
 * sign-in.
 */
export const leaseKeyFor = (username: string): string =>
  `delhivery-script:${username.trim().toLowerCase()}`

/** The lane a session is on, normalised — "express" and "EXPRESS " are one. */
const lane = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toUpperCase() : ''

/**
 * Which lane to switch the shared session to, or null to leave it alone.
 *
 * Exported for its test, because both wrong answers are expensive. Switching
 * when nothing changed is a dropdown dance per claim; NOT switching when the
 * lane differs files the claim from the wrong seller — Delhivery holds the pick
 * server-side, so the session stays wherever it was last put.
 *
 * A blank Domestic leaves the session as it is: nothing is known to be wrong
 * with where it stands, and guessing a lane is worse than keeping one.
 */
export const laneToSwitch = (current: unknown, wanted: unknown): string | null => {
  const next = lane(wanted)

  if (!next || next === lane(current)) return null

  return next
}

/**
 * Did the BROWSER die, or did this claim simply not work out?
 *
 * ONE LOGIN PER CREDENTIAL IS THE POINT, and almost nothing should cost it.
 * Delhivery refuses plenty of claims for business reasons — "the claim raise
 * window for this waybill has passed", "a previous claim for this issue wasn't
 * approved", an AWB it will not accept — and a step can fail on a slow page
 * without the session being any the worse. None of that is a reason to throw
 * away a signed-in browser: it is still signed in, still on the right account,
 * and still the cheapest way to file the next claim. Discarding on every
 * failure is what put a sign-in in front of all twenty-five.
 *
 * SO THE ONLY QUESTION IS WHETHER CHROME IS STILL THERE. These are WebDriver's
 * own words for a session that has gone — the window closed, chromedriver
 * exited, the session id no longer exists. Reusing one of those produces a
 * cascade of failures that read like marketplace problems and are not, so the
 * next claim gets a fresh browser; everything else keeps this one.
 *
 * Exported for its test: both wrong answers are expensive, in opposite ways.
 */
export const sessionLooksDead = (error: unknown): boolean => {
  const message = (error as { message?: unknown })?.message

  if (typeof message !== 'string') return false

  return /no such window|target window already closed|web view not found|invalid session id|session deleted|chrome not reachable|disconnected|ECONNREFUSED/i.test(
    message
  )
}

/** Delhivery pads empty evidence slots with a URL ending in "undefined". */
const isPlaceholder = (url: unknown): boolean => {
  if (typeof url !== 'string') return true

  const trimmed = url.trim()

  if (!trimmed) return true

  const last = trimmed.split('?')[0]?.split('/').filter(Boolean).pop() ?? ''

  return /^(undefined|null)$/i.test(last)
}

export const runDelhiveryScriptClaim = async (
  claim: QueuedClaim,
  doc: ClaimDocument
): Promise<ProcessResult> => {
  const username = await requireClaimAccount('delhivery', doc)
  const awb = doc.AWBNumber ?? claim.awbNumber

  if (!awb) throw new Error('The claim has no AWB number')

  const credentials = await claimCredentials('delhivery', username)
  const entry = requireClaimConfig('delhivery', doc)

  await prepareCoreWithBrowser(undefined, 'delhivery')

  const utils = loadCore<DelhiveryScriptUtils>(
    'platforms/delhivery/claim-management/common/utils'
  )
  const flow = loadCore<DelhiveryScriptFlow>(
    'platforms/delhivery/claim-management/script-based-flow/fileClaim'
  )

  const domestic = typeof entry.domestic === 'string' ? entry.domestic : ''

  const { context, release } = await leasedSession(leaseKeyFor(username), async () => {
    const fresh = await utils.buildDriver()

    try {
      await utils.delhiveryLogin(fresh, { username, password: credentials.password })

      /*
       * The account the claim belongs to, set once on the session — which is
       * also why it belongs HERE, inside the lease's create step. Delhivery
       * holds the pick server-side, so a reused browser is already on the right
       * account and re-picking it per claim would be a dropdown dance for
       * nothing.
       *
       * A missing dropdown is survivable and nothing else is: an option that was
       * found and could not be clicked means the session is on the WRONG
       * account, and filing there raises a claim from a seller who did not ship
       * the parcel.
       */
      try {
        await utils.pickDomesticAccount(fresh, domestic)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)

        if (!/Domestic dropdown trigger \(not found/.test(message)) {
          throw new Error(`Picking the Domestic account failed: ${message}`, { cause: error })
        }

        logger.warn(
          `[delhivery-script] no Domestic dropdown on this layout — continuing with the active account`
        )
      }

      /*
       * HOW THE LEASE KNOWS THIS BROWSER IS GONE.
       *
       * It asks `browser.connected` / `page.isClosed()` — Puppeteer's
       * vocabulary. A WebDriver session answers neither, so every dead driver
       * read as alive and the only way to replace one was to discard the lease
       * by hand on any failure, which cost the login on every refusal.
       *
       * This box is the missing signal: the claim marks it when WebDriver says
       * the session has gone, and the lease then replaces the browser by
       * itself. Nothing else has to throw a good login away.
       */
      const health = { dead: false }

      return {
        // The lease speaks Puppeteer; a WebDriver session closes with quit().
        browser: { close: () => fresh.quit(), isConnected: () => !health.dead },
        page: { isClosed: () => health.dead },
        /*
         * `on` is a BOX, not a value: the lease hands the same context object
         * to every claim that reuses this browser, so the lane the session is
         * currently on has to be writable through it. A plain string would be
         * the lane the FIRST claim wanted, for ever.
         */
        context: { driver: fresh, on: { lane: lane(domestic) }, health }
      }
    } catch (error) {
      // The driver belongs to this function until it returns, so a failed
      // sign-in has to close it here — nothing upstream is holding it yet.
      await fresh.quit().catch(() => undefined)

      throw error
    }
  })

  const driver = context.driver

  try {
    /*
     * The shared session may be on another lane — a previous claim in this
     * batch put it there. One dropdown moves it; a sign-in would be a minute.
     */
    const switchTo = laneToSwitch(context.on.lane, domestic)

    if (switchTo) {
      logger.info(`[delhivery-script] moving the session to ${switchTo}`)
      await utils.pickDomesticAccount(driver, switchTo)
      context.on.lane = switchTo
    }


    return await withTempDir(async (tempDir: string) => {
      /*
       * The evidence, on disk. The drawer's file input takes a filesystem path,
       * so every S3 URL is fetched first — and a download that fails is a claim
       * that would be filed with its proof missing, which Delhivery rejects
       * later and nobody connects back to here.
       */
      const urls = Array.isArray(entry.unboxingDoc) ? (entry.unboxingDoc as unknown[]) : []
      const paths: string[] = []

      for (const [index, url] of urls.entries()) {
        if (isPlaceholder(url)) continue

        const local = await utils.downloadFile(String(url), `${awb}_unboxing_${index}`, tempDir)

        if (local) paths.push(local)
      }

      if (paths.length === 0) {
        throw new Error('EVIDENCE_MISSING: no unboxing docs available for this claim.')
      }

      const outcome = await flow.fileDelhiveryClaimByScript(driver, entry, paths, { log: logger })

      /*
       * A FILED CLAIM WITH NO NUMBER IS STILL FILED. The tickets list lags a
       * few seconds behind a submit, so a missing id here is something to go
       * and find — not a reason to report a failure that would have somebody
       * raise the claim a second time.
       */
      if (!outcome.ticketId) {
        throw Object.assign(
          new Error(
            `The claim was submitted but Delhivery's ticket list had not caught up — ` +
              `find the ticket for ${awb} in the portal and record it, rather than filing again.`
          ),
          { code: 'TICKET_READBACK_FAILED' }
        )
      }

      return {
        cmsId: claim.cmsId,
        ticketId: outcome.ticketId,
        message: outcome.priorClaim
          ? `Delhivery already had a ticket for this claim (${outcome.ticketId})`
          : `Delhivery ticket raised (${outcome.ticketId})`,
        // Resolved means approved, Closed means rejected — the freshest
        // statement of where the claim stands, straight off the portal.
        cmsStatus: outcome.cmsStatus
      }
    })
  } catch (error) {
    /*
     * THE LOGIN SURVIVES THIS CLAIM, whatever happened to it. A refusal, a
     * timeout, a step that did not work — none of them say the browser is
     * worse off, and every one of them used to cost a sign-in.
     *
     * The exception marks itself: a session WebDriver says has gone is flagged
     * so the lease replaces it on the next claim. Nothing is discarded here,
     * because discarding is what made a refusal expensive.
     */
    if (sessionLooksDead(error)) {
      context.health.dead = true
      logger.warn('[delhivery-script] the browser session has gone — the next claim will sign in again')
    }

    throw error
  } finally {
    await release()
  }
}
