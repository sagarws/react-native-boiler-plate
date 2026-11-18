import { loadCore } from '@main/automations/common/coreLoader'
import { prepareCoreWithBrowser } from '@main/automations/common/prepareCore'
import { storedSession } from '@main/services/sessionReuse.service'
import { publishSession } from '@main/services/platformSession.service'
import { fetchCloudflareOtp, fetchTataCliqOtp } from '@main/services/tatacliqOtp.service'
import { OTP_WAIT_MS } from '@main/services/otpSource'
import { credentialFor } from '@main/services/company.service'
import {
  forgetSessionRejected,
  rememberSessionRejected
} from '@main/services/sessionRejection.store'
import { logger } from '@main/services/logger'
import { refuseSignInUnlessAllowed } from '@main/services/signInPolicy'

/**
 * A signed-in Tata CliQ page, reusing the stored session whenever it still works.
 *
 * ONE COPY, used by every Tata CliQ automation on this machine — the claim
 * runner and the slave sweep. Mirrors `openSignedInAjioPage`, because the
 * constraints are AJIO's: sellerzone.tatacliq.com is behind Cloudflare and the
 * slave pick is server-side session state, so every call runs inside a page and
 * a jar is only useful if it can be rehydrated into a real browser.
 *
 *   1. Hydrate the stored jar and PROBE it from inside the page. Tata CliQ
 *      cannot be checked from a jar alone — `common/probeSession.js` omits it
 *      on purpose, as it does AJIO — so the in-page slave-list call IS the
 *      "is the session alive" test.
 *   2. Sign in only if that fails.
 *   3. SAVE what the sign-in produced, WITH the slave list, because the ingest
 *      refuses a session without one and a session that is never saved can
 *      never be reused.
 *
 * REUSE MATTERS MORE HERE THAN FOR ANY OTHER PLATFORM. Signing in costs an
 * emailed OTP: every skipped login is a code not spent and a wait not had, and
 * a session thrown away is the difference between a run that recovers on its
 * own and one that needs a mailbox.
 */

export interface PuppeteerPage extends Record<string, unknown> {
  goto: (url: string, options?: Record<string, unknown>) => Promise<unknown>
}

export interface PuppeteerBrowser {
  newPage: () => Promise<PuppeteerPage>
  close: () => Promise<void>
}

interface BrowserRuntime {
  loadPuppeteer: () => {
    launch: (options: Record<string, unknown>) => Promise<PuppeteerBrowser>
  } | null
  resolveExecutablePath: (fallback?: string) => string | undefined
}

/** One slave, as the portal names it. */
export interface TataCliqSlave {
  id: string
  name: string
  code: string | null
}

interface TataCliqLogin {
  loginTataCliq: (
    page: PuppeteerPage,
    credentials: { username: string; password: string; cloudflareEmail?: string },
    options: {
      fetchOtp: (username: string, since?: Date) => Promise<string | null>
      /** Reads the Cloudflare Access code, mailed to the credential's Cloudflare email. */
      fetchCloudflareOtp?: (email: string, since?: Date, timeoutMs?: number) => Promise<string | null>
      otpWaitMs?: number
      isSignedIn?: (page: PuppeteerPage) => Promise<boolean>
      logger?: unknown
    }
  ) => Promise<{ ok: true }>
}

interface TataCliqSlaveSync {
  /**
   * Every slave, with the ids setSession needs — not the nine the search box
   * volunteers.
   *
   * COSTS A PAGE WALK PLUS A LOOKUP PER SLAVE the type-ahead withheld, so it is
   * run ONLY by Sync slaves (`sweep: true`). A claim reads the list this wrote
   * onto the credential.
   */
  fetchAllSlaves: (
    page: PuppeteerPage,
    options?: { logger?: unknown; maxPages?: number }
  ) => Promise<TataCliqSlave[]>
}

interface TataCliqSessionStore {
  reuseSessionRecord: (
    page: PuppeteerPage,
    record: unknown,
    options: {
      username: string
      onVerdict?: (verdict: 'unreachable' | 'signed-out', detail?: string) => void
    }
  ) => Promise<{ jar: unknown[]; slaves: TataCliqSlave[] } | null>
  harvestCookies: (page: PuppeteerPage, options?: { logger?: unknown }) => Promise<unknown[]>
  probeSessionInPage: (page: PuppeteerPage) => Promise<{ alive: boolean; slaves: TataCliqSlave[] }>
}

export interface SignedInTataCliqPage {
  browser: PuppeteerBrowser
  page: PuppeteerPage
  /** The slaves this login can see. A claim searches under exactly one of them. */
  slaves: TataCliqSlave[]
  /** True when the stored session was good and no sign-in — and no OTP — happened. */
  reused: boolean
}

/**
 * Ships the session this run signed in with, so the next call skips the login.
 *
 * The slave list goes with it, and not as a nicety: the ingest refuses a
 * session without one, because a session pointed at no slave searches nothing.
 *
 * Best-effort — a session that could not be saved costs the next call a login.
 * Failing the work in hand over it would cost considerably more, and here it
 * would cost an OTP too.
 */
const keepSession = async (
  username: string,
  page: PuppeteerPage,
  slaves: TataCliqSlave[],
  harvestCookies: TataCliqSessionStore['harvestCookies']
): Promise<void> => {
  try {
    if (slaves.length === 0) {
      logger.warn(
        `[tatacliq-session] no slaves for ${username} — the session cannot be saved in a reusable ` +
          'shape, so the next run will sign in again and spend another OTP.'
      )

      return
    }

    const jar = await harvestCookies(page, { logger })
    const saved = await publishSession('tatacliq', username, jar as never, { slaves })

    if (saved.success) {
      logger.info(
        `[tatacliq-session] saved the session for ${username} ` +
          `(${jar.length} cookies, ${slaves.length} slaves)`
      )
    } else {
      logger.warn(`[tatacliq-session] could not save the session: ${saved.error.message}`)
    }
  } catch (error) {
    logger.warn(
      `[tatacliq-session] could not save the session: ` +
        (error instanceof Error ? error.message : String(error))
    )
  }
}

/**
 * Launches a browser and brings it to a signed-in Tata CliQ page.
 *
 * The browser is the CALLER'S once this returns — close it, or hand it to the
 * lease. On any failure before returning it is closed here, because nothing
 * upstream is holding it yet.
 */
/**
 * What the type-ahead answers an EMPTY query with, whatever the seller has.
 *
 * Nine. It is a search box, not a list endpoint, and it has no "everything"
 * mode — so a slave count at or below this is the probe's own ceiling rather
 * than a measurement of the account.
 */
const PROBE_SLAVE_CEILING = 9

/**
 * The slave list already on the credential, written by Sync slaves.
 *
 * Each entry carries the numeric id `setSlaveSession` needs — which is the
 * whole reason the directory sweep existed — and the list is ordered by
 * `lastUsed`, so a claim tries the warehouse that answered last time first.
 */
const storedSlaves = async (username: string): Promise<TataCliqSlave[]> => {
  const credential = await credentialFor('tatacliq', username)

  return (credential?.slaves ?? []).map(slave => ({
    id: slave.id,
    name: slave.name,
    ...(slave.code ? { code: slave.code } : {})
  })) as TataCliqSlave[]
}

export const openSignedInTataCliqPage = async (input: {
  username: string
  password: string
  /**
   * Read the FULL slave list from the portal rather than the credential.
   *
   * Sync slaves only. It is a page walk plus one lookup per slave the
   * type-ahead withholds, and on a large seller that is minutes — which is why
   * a claim, which opens a session every run, does not do it.
   */
  sweep?: boolean
  /**
   * May this open SIGN IN when the stored session will not do?
   *
   * FALSE FOR EVERY CLAIM, and that is a rule rather than a tuning knob. Tata
   * CliQ's sign-in costs an emailed one-time code, and a claim runs unattended
   * — at 23:00, in a batch nobody is watching. A run that renews the session
   * mid-batch spends that code, can stall for two minutes waiting for it, and
   * leaves the operator with a claim that failed for a reason that has nothing
   * to do with the claim.
   *
   * When it is false and the stored session will not serve, this throws
   * `TATACLIQ_SESSION_EXPIRED` — which the claim reports as a session to
   * re-capture, and which the pre-flight gate uses to show the same
   * "Update sessions first" dialog every other platform gets.
   *
   * TRUE only where a person asked for something and is waiting: Sync slaves,
   * and capturing a session on purpose.
   */
  allowSignIn?: boolean
}): Promise<SignedInTataCliqPage> => {
  await prepareCoreWithBrowser(undefined, 'tatacliq')

  const runtime = loadCore<BrowserRuntime>('common/browserRuntime')
  const { isHeadless } = loadCore<{ isHeadless: (platform?: string) => boolean }>('common/headless')
  const { loginTataCliq } = loadCore<TataCliqLogin>('platforms/tatacliq/common/login')
  const { reuseSessionRecord, harvestCookies, probeSessionInPage } =
    loadCore<TataCliqSessionStore>('platforms/tatacliq/common/sessionStore')
  const { fetchAllSlaves } = loadCore<TataCliqSlaveSync>('platforms/tatacliq/common/slaveSync')

  /**
   * THE COMPLETE SLAVE LIST — from the credential first, the portal last.
   *
   * WHAT THIS USED TO DO, AND WHAT IT COST. It swept the portal's paged
   * directory on EVERY session open — every claim, every refill — and then
   * asked the type-ahead, one request at a time, for the id of each slave the
   * directory listed and the type-ahead had not volunteered. On a seller with
   * 373 slaves that is 364 sequential round trips: **eight minutes** before any
   * work began, measured on a real run, which then resolved none of them and
   * carried on with the same nine it started with.
   *
   * The right place for a full directory sweep is the explicit "Sync slaves"
   * action, which already exists and already writes the result — WITH ids —
   * onto the credential (`slaves`, `slavesSyncedAt`). This reads that.
   *
   * THE ORDER IS THE WHOLE FIX:
   *
   *   1. the credential's stored list, if it has more than the probe returned.
   *      Already resolved, already ordered by `lastUsed`, costs nothing.
   *   2. the probe's own nine, if nothing is stored.
   *
   * The live sweep is NOT attempted here any more. A session open must not be
   * the thing that spends eight minutes, and a list that is stale is a reason
   * to press Sync slaves — not a reason to re-derive it at the front of every
   * claim.
   */
  const completeSlaves = async (
    signedInPage: PuppeteerPage,
    fallback: TataCliqSlave[]
  ): Promise<TataCliqSlave[]> => {
    /**
     * THE SWEEP, and the ONE caller that asks for it.
     *
     * Sync slaves is a deliberate action: somebody pressed it, it has somewhere
     * to show progress, and its whole purpose is to write the full list onto
     * the credential. So it reads the portal.
     *
     * A CLAIM NEVER DOES. It opens a session per run, and a page walk plus a
     * lookup per withheld slave cost eight minutes there — before any work
     * began, every time.
     *
     * This flag was missing for two runs and Sync slaves became a no-op: it
     * read the stored nine and wrote the same nine back, so the list could
     * never grow and the claim kept missing the warehouse holding the return.
     */
    if (input.sweep) {
      try {
        const swept = await fetchAllSlaves(signedInPage, { logger })

        if (swept.length > 0) return swept

        logger.warn('[tatacliq-session] the sweep returned nothing — keeping what is known')
      } catch (error) {
        logger.warn(
          '[tatacliq-session] could not sweep the slave list: ' +
            (error instanceof Error ? error.message : String(error))
        )
      }
    }

    try {
      const stored = await storedSlaves(input.username)

      if (stored.length > fallback.length) {
        logger.info(
          `[tatacliq-session] using ${stored.length} stored slave(s) for ${input.username} ` +
            `(the probe returned ${fallback.length})`
        )

        return stored
      }

      // Nothing better on record. Say so once, with the action that fixes it —
      // nine is the type-ahead's answer to an empty query, not the seller's
      // real list, and a claim that sweeps nine misses the slave holding the
      // return and reports the AWB as belonging to nobody.
      if (fallback.length <= PROBE_SLAVE_CEILING) {
        logger.warn(
          `[tatacliq-session] only ${fallback.length} slave(s) known for ${input.username} — ` +
            'run Sync slaves on this account, or a claim may not find its return'
        )
      }

      return fallback
    } catch (error) {
      logger.warn(
        '[tatacliq-session] could not read the stored slave list — using what the probe returned: ' +
          (error instanceof Error ? error.message : String(error))
      )

      return fallback
    }
  }

  const puppeteer = runtime.loadPuppeteer()

  if (!puppeteer) throw new Error('No browser available for Tata CliQ')

  const browser = await puppeteer.launch({
    headless: isHeadless('tatacliq'),
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
    // returns null on ANY doubt, so the sign-in below proceeds as though
    // nothing had been tried.
    const stored = await storedSession('tatacliq', input.username)
    /**
     * WHY it could not be reused, because the two reasons are not the same.
     *
     * "signed-out" is the portal answering with an empty slave list — evidence
     * about the SESSION, and the only verdict worth recording.
     *
     * "unreachable" is a navigation timeout: evidence about the PORTAL. The
     * first version of this stamped both, so one slow night would record a
     * perfectly good session as dead and stop every claim on the account until
     * somebody re-captured it.
     */
    let verdict: 'unreachable' | 'signed-out' | null = null

    const reused = stored
      ? await reuseSessionRecord(page, stored, {
          username: input.username,
          onVerdict: (which) => {
            verdict = which
          }
        })
      : null

    if (reused) {
      logger.info(
        `[tatacliq-session] reused the saved session for ${input.username} — no OTP spent`
      )

      // Whatever the stored record said, this page has just proved the session
      // works. Clearing the stamp is what lets a re-captured account stop
      // blocking Create Ticket.
      await forgetSessionRejected('tatacliq', input.username).catch(() => undefined)

      return { browser, page, slaves: await completeSlaves(page, reused.slaves), reused: true }
    }

    /**
     * THE PROBE SAID NO — RECORD IT, because nothing else can.
     *
     * Tata CliQ has no HTTP identity endpoint, so every pre-flight session
     * check lands on "unverifiable" and lets the run start. The only thing that
     * can judge this session is the page above, asking for the slave list — and
     * it has just answered "not signed in".
     *
     * Until this stamp existed that discovery was thrown away: the run signed
     * in fresh, spending an emailed OTP mid-batch with nobody watching, and the
     * NEXT run made the same discovery all over again. Stamped, the session
     * reads as dead everywhere it is asked about — so the operator gets the
     * same "Update sessions first" dialog every other platform produces, before
     * anything opens a browser.
     *
     * It is cleared above the moment a session is reused successfully, so a
     * re-capture ends the block.
     */
    if (stored && verdict === 'signed-out') {
      await rememberSessionRejected(
        'tatacliq',
        input.username,
        'the saved login did not answer the slave list — it is signed out'
      ).catch(() => undefined)
    }

    /**
     * THE STORED SESSION DID NOT SERVE — and a claim stops here.
     *
     * Signing in would cost an emailed code on a run nobody is watching. The
     * row is failed with a reason an operator can act on instead, and the
     * session is left exactly as it was: re-capturing is a decision, not
     * something a batch does to itself at 23:00.
     */
    if (input.allowSignIn === false) {
      const expired = new Error(
        'The saved Tata CliQ login is no longer usable — re-capture it, then run this again'
      )

      ;(expired as { code?: string }).code = 'TATACLIQ_SESSION_EXPIRED'

      throw expired
    }

    // Only session capture signs in (signInPolicy).
    refuseSignInUnlessAllowed('tatacliq', input.username, 'the saved login is no longer usable')

    // The seller zone is sometimes behind Cloudflare Access, which mails its own
    // code to a second inbox stored on the credential. Empty: the core default.
    const cloudflareEmail = (await credentialFor('tatacliq', input.username).catch(() => null))?.cloudflareEmail ?? ''

    await loginTataCliq(
      page,
      { username: input.username, password: input.password, ...(cloudflareEmail ? { cloudflareEmail } : {}) },
      {
        // Both codes are read from the OTP mailbox on THIS machine — see
        // tatacliqOtp.service.
        fetchOtp: fetchTataCliqOtp,
        fetchCloudflareOtp,
        otpWaitMs: OTP_WAIT_MS,
        isSignedIn: async (signedInPage) => (await probeSessionInPage(signedInPage)).alive,
        logger
      }
    )
    logger.info(`[tatacliq-session] signed in as ${input.username}`)

    // The slave list is both the proof the session works and the thing a claim
    // cannot proceed without, so it is read once here and carried.
    const probed = await probeSessionInPage(page)
    const slaves = await completeSlaves(page, probed.slaves)

    if (slaves.length === 0) {
      throw new Error(
        `Signed in to Tata CliQ as ${input.username} but the login lists no slaves — ` +
          'there is nothing to search under'
      )
    }

    // THE STEP THAT IS EASY TO OMIT. Without it every entry point signs in,
    // works, throws the session away, and the next one spends another OTP.
    await keepSession(input.username, page, slaves, harvestCookies)

    return { browser, page, slaves, reused: false }
  } catch (error) {
    await browser.close().catch(() => undefined)

    throw error
  }
}
