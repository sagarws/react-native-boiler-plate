import { recallSession, type SessionJar } from './localSession.store'
import { reusableSession, storedSession } from './sessionReuse.service'
import { credentialFor } from './company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { logSignInRefused, SIGN_IN_REFUSED, signInAllowed } from './signInPolicy'
import { logger } from './logger'

/** The core's own table of what each platform's session must carry. */
interface ClaimContext {
  missingContextFields: (platform: string, record: Record<string, unknown> | null) => string[]
}
import { autoLoginEnabled } from './automationRouting.service'
import { captureSession } from './platformSession.service'

/**
 * The session a claim runner should file with.
 *
 * TWO stores hold sessions on this machine and the claim runners only ever read
 * one of them:
 *
 *   localSession.store  — jars captured BY this app (Sessions page, or a run
 *                         that signed in). Encrypted with safeStorage.
 *   the company document — every session the backend knows about, including
 *                         ones minted by the automation server. This is what
 *                         the master import reads, and why it can reuse a
 *                         Myntra session while a claim for the same account
 *                         reported "No local Myntra session".
 *
 * Both are on this machine and neither needs the network. Reading only the
 * first meant a perfectly good session sitting in the local copy of the company
 * was invisible to every claim.
 *
 * ORDER MATTERS: a locally captured jar wins. It was minted on this machine's
 * own connection, which is the one that will file the claim — and for a
 * platform that ties a session to its egress IP, a server-minted jar from the
 * company document may not work here even though it is newer.
 */

export interface ClaimSession {
  jar: SessionJar
  /** Where it came from — logged, and useful when a run behaves oddly. */
  source: 'local-capture' | 'company-document'
}

export const claimSession = async (
  platform: string,
  username: string
): Promise<ClaimSession | null> => {
  // TEMPORARY DIAGNOSTIC — remove once desktop claims are proven end to end.
  // Says which of the two stores was consulted and what each held, so "no
  // session" can never again mean "looked in one place and stopped".
  const local = await recallSession(platform, username)

  if (local) {
    logger.info(`[claim-session] ${platform}/${username}: using the locally captured session`)

    return { jar: local, source: 'local-capture' }
  }

  const stored = await storedSession(platform, username)
  // The company document holds each platform's OWN jar shape — a cookie array
  // for AJIO, a name-value map for the rest (see `jarFormat` in the core's
  // platform registry). That is exactly the shape that platform's login
  // expects, so it is passed through rather than reshaped here.
  const jar = stored?.jar as SessionJar | undefined
  const cookies = jar ? (Array.isArray(jar) ? jar.length : Object.keys(jar).length) : 0

  /**
   * AN EMPTY JAR IS NOT AN EMPTY SESSION on every platform.
   *
   * Delhivery and Xbees are bearer-token APIs: their session is an access
   * token, their jar is legitimately empty, and the core marks them `jarless`
   * (common/claimContext). Counting cookies threw those sessions away — a
   * capture would succeed, store its tokens, and every run afterwards was told
   * there was no session at all.
   */
  const { missingContextFields } = loadCore<ClaimContext>('common/claimContext')
  const missing = stored ? missingContextFields(platform, stored) : ['a login']

  if (!stored || missing.includes('jar') || missing.includes('accessToken')) {
    logger.warn(
      `[claim-session] ${platform}/${username}: nothing usable — ` +
        `local capture: no, company document: ${stored ? `missing ${missing.join(', ')}` : 'no session'}`
    )

    return null
  }

  logger.info(
    `[claim-session] ${platform}/${username}: using the session from the company document ` +
      `(source "${typeof stored?.source === 'string' ? stored.source : 'unknown'}", ` +
      `${cookies} cookie(s))`
  )

  // A jarless platform has no cookies to hand back, and an empty map is the
  // honest shape for that: the runner reads its token off the record through
  // the core's own context builder, not from here.
  return { jar: jar ?? {}, source: 'company-document' }
}

/**
 * How long a claim will hold the automation lock waiting for a person.
 *
 * Long enough to walk over and sign in, short enough that an unattended machine
 * recovers on its own instead of blocking every other claim and the bulk run
 * behind a login page nobody is going to complete.
 */
const MANUAL_SIGN_IN_WAIT_MS = 5 * 60_000

/**
 * Get this account back to a usable session, however the company said to.
 *
 * `settings.isAutoLoginOnActiveSession.<platform>` is the whole decision, and
 * until now nothing on the claim path read it:
 *
 *   true   sign in by script — no operator, no window
 *   false  a person signs in, in a window this app opens
 *
 * WHAT THIS FIXES. With auto-login off, the backend refuses to hand out the
 * password (`/cms/credential-secret` gates on the same flag), so a claim whose
 * session had expired went into a scripted sign-in with no credentials and
 * failed with "Missing username or password". Correct, in that it did not sign
 * in — useless, in that it never asked the person sitting right there. The
 * setting said "a human does this" and nothing ever asked a human.
 *
 * The routing itself is NOT re-implemented here: `captureSession` already picks
 * between the automation server, a scripted sign-in on this machine, and a
 * manual window, using this same flag. This just calls it from the one place a
 * claim discovers it needs a session — which is what was missing.
 *
 * Returns null when a session still could not be obtained; the caller decides
 * what that means.
 *
 * Exported for the claim processor's retry: a session can be alive when the
 * pre-flight probe asks and dead by the time the claim asks, and the two
 * questions are not even the same one — Myntra's probe reads the partner boot
 * payload while a claim calls the SPF API, and the first can answer while the
 * second says expired.
 */
export const renewForClaim = async (
  platform: string,
  username: string,
  credentialId: string | undefined,
  why: string
): Promise<ClaimSession | null> => {
  /*
   * NOT IN A RUN THAT DOES NOT SIGN IN — by script OR BY WINDOW.
   *
   * Checked here, where every route to a sign-in meets, not by each caller:
   * one caller checked, the others did not, and a Status change sweep on a
   * platform with auto-login OFF opened AJIO's manual sign-in window on the
   * operator's screen in the middle of the night's run — MAIN_VITE_HEADLESS
   * cannot hide it, it is the app's own window, not the automation browser.
   */
  if (!signInAllowed(platform)) {
    logSignInRefused(platform, username)

    return null
  }

  const automatic = await autoLoginEnabled(platform)

  /*
   * NEVER A WINDOW FROM A RUNNING PROCESS. Permission granted per platform —
   * a claim batch's auto-login platforms, or AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS
   * — is permission to sign in BY SCRIPT. If the setting has since been switched
   * to manual, the route below would open a sign-in window in the middle of
   * background work; refused instead, unless the work opted into every sign-in.
   */
  if (!automatic && !signInAllowed()) {
    logger.info(
      `[claim-session] ${platform}/${username}: ${why} — auto-login is off for this platform, ` +
        'so a person re-captures it on the Login page'
    )

    return null
  }

  logger.info(
    `[claim-session] ${platform}/${username}: ${why} — ` +
      (automatic
        ? 'signing in by script (auto-login is on for this platform)'
        : 'asking the operator to sign in (auto-login is off for this platform)')
  )

  const captured = await captureSession({
    platform,
    username,
    ...(credentialId ? { credentialId } : {}),
    // Only the manual route can hang, and only it uses this.
    waitMs: MANUAL_SIGN_IN_WAIT_MS,
    // Signing in on a per-platform permission (a claim batch, or
    // AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS) is scripted or nothing: the
    // capture never falls back to a window in the middle of running work.
    ...(signInAllowed() ? {} : { unattended: true })
  })

  if (!captured.success) {
    logger.warn(`[claim-session] ${platform}/${username}: could not renew — ${captured.error.message}`)

    return null
  }

  // Read it back rather than trusting the capture's own report: what matters is
  // what actually landed in a store this machine reads.
  const renewed = await claimSession(platform, username)

  if (!renewed) {
    logger.warn(
      `[claim-session] ${platform}/${username}: the sign-in reported success but no session was stored`
    )
  }

  return renewed
}

/**
 * @throws with a message that says what to do, when there is no session at all.
 */
export const requireClaimSession = async (
  platform: string,
  username: string,
  credentialId?: string
): Promise<SessionJar> => {
  const found = await claimSession(platform, username)

  if (found) return found.jar

  // Said in the words `marketplaceDidNotAnswer` keys on, so the row is not
  // charged a refill attempt for a question nobody asked.
  if (!signInAllowed(platform)) {
    logSignInRefused(platform, username)

    throw new Error(`${SIGN_IN_REFUSED} — no ${platform} login is saved on this machine for ${username}`)
  }

  // Nothing stored at all. Rather than telling the operator to go and do it on
  // another page, do it now — by script or by asking them, per the company's
  // setting for this platform.
  const renewed = await renewForClaim(platform, username, credentialId, 'no login on this machine')

  if (renewed) return renewed.jar

  throw new Error(
    `No ${platform} login for ${username} — none captured on this machine, none in the company ` +
      'data, and signing in again did not produce one. Capture it on the Login page.'
  )
}

/**
 * Everything a claim login needs, from the local company data.
 *
 * The three pieces travel TOGETHER because a login needs all of them and the
 * runners kept taking one:
 *
 *   jar          reuse it and there is no sign-in at all
 *   password     for when the jar is stale and the core signs in anyway
 *   credentialId matches the credential exactly; without it the core's session
 *                store falls back to matching on username
 *
 * The claim runners passed only `{ username, _id: doc.account?._id }` — and
 * `doc.account` does not exist on a claim document, so that was
 * `{ username, _id: undefined }` with no password. A stale jar therefore took
 * the core into a fresh login it had no credentials for, and it failed with
 * "LOGIN_FAILED: Missing username or password" while the password sat in the
 * local company document the whole time.
 *
 * This is the same source the master import reads (`credentialFor` →
 * `company.service`), which is why that flow never hit this.
 */
export interface ClaimCredentials {
  username: string
  password: string
  credentialId: string | undefined
  jar: SessionJar
  /**
   * What that platform's login would have returned, rebuilt from the stored
   * session — or null when the session cannot stand in for a sign-in.
   *
   * Only `loginSnapdealApi` accepts a `session` option; the other six ignore
   * the jar handed to them and sign in regardless, which is why a browser
   * opened for every claim while a good session sat in the company document.
   * A runner uses this when it is there and calls its login when it is not.
   */
  context: unknown
}

export const claimCredentials = async (
  platform: string,
  username: string
): Promise<ClaimCredentials> => {
  let credential = await credentialFor(platform, username)
  let jar = await requireClaimSession(platform, username, credential?.credentialId)

  // IS THE SESSION ACTUALLY ALIVE? Ask the marketplace before filing anything.
  //
  // Having a jar is not having a session. Every master import has checked this
  // for months (`reusableSession`); no claim ever did — so a Myntra jar that
  // looked complete went into the runner and came back
  // "fetchNewClaim: session expired (HTTP 101)", nine times in a row, with the
  // renewal machinery sitting right here unused.
  //
  // Only a DEAD verdict renews. "Cannot tell" must not: AJIO has no jar-only
  // probe by design — its check needs a live page, which its runner has and
  // this does not — so treating unverifiable as dead would re-sign-in before
  // every AJIO claim and throw away a session that works.
  const liveness = await reusableSession(platform, username)

  if (liveness.reason === 'dead') {
    /*
     * SOME WORK MUST NOT SIGN IN.
     *
     * Refill Data is the case: it asks marketplaces for the blanks on hundreds
     * of rows, and meeting a dead session used to mean a scripted sign-in —
     * one browser, one real login, per account — in the middle of that sweep.
     * Re-capturing logins is the Login update's job and it runs first for
     * exactly this reason.
     *
     * Thrown rather than returned empty: a caller handed credentials that
     * cannot authenticate will ask the marketplace anyway and report whatever
     * confusing refusal comes back. The row should fail here, saying why.
     */
    if (!signInAllowed(platform)) {
      logSignInRefused(platform, username)

      throw new Error(`${SIGN_IN_REFUSED} — ${liveness.detail}`)
    }

    const renewed = await renewForClaim(
      platform,
      username,
      credential?.credentialId,
      `the marketplace says the saved login is expired — ${liveness.detail}`
    )

    if (renewed) {
      jar = renewed.jar
      credential = await credentialFor(platform, username)
    }
  }
  const { claimContextFromSession, missingContextFields, isPageProbed } = loadCore<{
    claimContextFromSession: (platform: string, record: unknown) => unknown
    missingContextFields: (platform: string, record: unknown) => string[]
    isPageProbed: (platform: string) => boolean
  }>('common/claimContext')

  // The whole stored record, not just the jar: Meesho's supplier ids, Flipkart's
  // csrf token, Nykaa's portal id and the OAuth tokens all live alongside it and
  // are exactly what a login would have returned.
  let record = (await storedSession(platform, username)) ?? { jar }
  let context = claimContextFromSession(platform, record)

  if (context) {
    logger.info(`[claim-credentials] ${platform}/${username}: signing in is not needed — reusing the stored session`)
  } else {
    // The MESSAGE differs, the path does not.
    //
    // AJIO and Tata CliQ have no jar-plus-token context that could stand in for
    // a login — every call is a fetch from inside a logged-in page — so
    // declining here is the design, not a verdict on the stored session, and
    // the runner still opens the page and tries the cookies first. Saying
    // "will sign in" was wrong twice over: it contradicted its own second half
    // ("missing nothing — Tata CliQ is probed inside the browser page
    // instead") and it contradicted what happened, which was a reuse with no
    // sign-in at all.
    //
    // What follows is unchanged for both kinds: a platform whose session cannot
    // stand in for a login may still need the operator asked, and which of the
    // two this is does not change that.
    logger.info(
      isPageProbed(platform)
        ? `[claim-credentials] ${platform}/${username}: the stored session is judged in the ` +
            'browser page, not here — the runner will try it before signing in'
        : `[claim-credentials] ${platform}/${username}: will sign in — the stored session is ` +
            `missing ${missingContextFields(platform, record).join(', ') || 'nothing identifiable'}`
    )

    // A session that cannot stand in for a login means the runner is about to
    // attempt one. When the company has auto-login OFF that attempt cannot
    // succeed — the backend withholds the password on the same setting — so it
    // would fail on a credential it was never going to be given. Renew here
    // instead, which asks the operator when that is what the setting means.
    if (!(await autoLoginEnabled(platform))) {
      const renewed = await renewForClaim(
        platform,
        username,
        credential?.credentialId,
        'the stored login cannot stand in for a sign-in'
      )

      if (renewed) {
        jar = renewed.jar
        credential = await credentialFor(platform, username)
        record = (await storedSession(platform, username)) ?? { jar }
        context = claimContextFromSession(platform, record)
      }
    }
  }

  /*
   * NO USABLE SESSION, AND THIS WORK MAY NOT SIGN IN — which, by default, is
   * every automation (signInPolicy). Handing back the password here is what
   * let a runner sign in on its own; refused instead, saying so. AJIO and Tata
   * CliQ are judged in their browser page, whose own sign-in is gated there.
   */
  if (!context && !isPageProbed(platform) && !signInAllowed(platform)) {
    logSignInRefused(platform, username)

    throw new Error(
      `${SIGN_IN_REFUSED} — the saved ${platform} login for ${username} cannot be reused. ` +
        'Re-capture it on the Login page, or let the Login update run'
    )
  }

  if (!context && !credential?.password) {
    logger.warn(
      `[claim-credentials] ${platform}/${username}: no usable session and no password — ` +
        'the sign-in this run is about to attempt has nothing to sign in with'
    )
  }

  return {
    context,
    username,
    password: credential?.password ?? '',
    // undefined rather than '': the core treats a missing id as "match by
    // username", and an empty string would match nothing at all.
    credentialId: credential?.credentialId || undefined,
    jar
  }
}
