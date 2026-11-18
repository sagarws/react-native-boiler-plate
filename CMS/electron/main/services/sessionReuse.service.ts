import { loadCore } from '@main/automations/common/coreLoader'
import { credentialFor } from './company.service'
import {
  forgetSessionRejected,
  rememberSessionRejected,
  sessionRejectionKey,
  sessionRejections
} from './sessionRejection.store'
import { logger } from './logger'

/**
 * A stored session an automation can use instead of signing in.
 *
 * The jar is already on this machine — `company.service` reads it out of the
 * encrypted local company document — so the only question is whether it still
 * works. That question is answered by actually asking the marketplace, not by
 * looking at an expiry date: a session can be revoked, invalidated by a login
 * elsewhere, or tied to an IP that has changed, and every one of those leaves
 * `expiresAt` looking healthy.
 *
 * THE RULE: a stored session is used ONLY when the probe explicitly says it
 * works. `false` and "cannot tell" both mean sign in.
 *
 * That is deliberately strict. The alternative — use it and recover when it
 * turns out to be dead — sounds cheaper but is not: an expired marketplace
 * session does not announce itself. It answers 302 to a login page, or returns
 * an empty report, or fails three calls later with a 403. Snapdeal's ingest
 * will even accept a downloaded HTML login page as a report. Chasing that
 * across four platforms buys a few seconds and costs a class of silent bad
 * data, so the probe is paid up front and the fallback is simply a login.
 *
 * AJIO always falls through to signing in: its probe needs a live browser page,
 * so a caller holding only a jar gets "cannot tell" — see the core's
 * probeSession.js, where AJIO is absent on purpose.
 */

interface ClaimContext {
  missingContextFields: (platform: string, record: Record<string, unknown> | null) => string[]
}

interface ProbeSession {
  probePlatformSession: (
    platform: string,
    jar: unknown,
    extra?: Record<string, unknown>
  ) => Promise<boolean | null>
}

interface SessionIdentity {
  checkSessionIdentity: (
    platform: string,
    record: unknown,
    options?: { logger?: unknown }
  ) => Promise<{ ok: true | false | null; who: string | null; detail: string }>
}

/** The stored record, as the platform's ingest wrote it. */
export interface StoredSession {
  jar: unknown
  [field: string]: unknown
}

/** Why a run did or did not skip its sign-in — reported, not just logged. */
export type ReuseReason =
  | 'reused'
  | 'none-stored'
  | 'empty-jar'
  | 'dead'
  | 'unverifiable'
  | 'probe-failed'

export interface ReuseOutcome {
  session: StoredSession | null
  reason: ReuseReason
  /** One line an operator can act on, for the run's progress. */
  detail: string
}

/**
 * The stored record, WITHOUT the liveness check.
 *
 * For the one caller that can do better than `reusableSession`: AJIO's probe
 * needs a live logged-in page, which `reusableSession` does not have and the
 * AJIO runner does. It takes the record from here and probes it inside its own
 * browser, so the jar-only "cannot tell" that would otherwise force a sign-in
 * on every single run never arises.
 *
 * Nothing else should use this. A caller holding only a jar must go through
 * `reusableSession`, where an unverifiable session means sign in.
 */
export const storedSession = async (
  platform: string,
  username: string
): Promise<StoredSession | null> => {
  const credential = await credentialFor(platform, username)
  const session = credential?.session

  if (!session) {
    logger.info(
      `[session-reuse] ${platform}/${username}: none-stored — no session in the local company copy`
    )

    return null
  }

  return session as StoredSession
}

export const reusableSession = async (
  platform: string,
  username: string
): Promise<ReuseOutcome> => {
  // One exit, one log line. Two of these branches previously returned in
  // silence — including "no session in the local copy", the likeliest reason a
  // run signs in when the Sessions page says Active — so the decision could not
  // be explained after the fact.
  const decide = (outcome: ReuseOutcome): ReuseOutcome => {
    const line = `[session-reuse] ${platform}/${username}: ${outcome.reason} — ${outcome.detail}`

    if (outcome.reason === 'reused') logger.info(line)
    else if (outcome.reason === 'probe-failed') logger.warn(line)
    else logger.info(line)

    /**
     * THE VERDICT IS KEPT, not just logged.
     *
     * This is the only place in the app that finds out what the marketplace
     * thinks, and for a long time a log line was all that came of it: the
     * Sessions page, the banner and the Session update card went on comparing
     * `expiresAt` to the clock and reporting "Saved" for a jar this function
     * had just watched Snapdeal refuse. So the night's Auto claim skipped the
     * account for having no usable session while the card that exists to fix
     * that said there was nothing to do.
     *
     * ONLY `dead` and `reused` write anything. The rest — `unverifiable`,
     * `probe-failed` — mean the question was never answered, and painting the
     * Sessions page red on those would be worse than the bug being fixed.
     * A `reused` clears any earlier rejection: the marketplace has just said
     * yes to this very session.
     */
    if (outcome.reason === 'dead') void rememberSessionRejected(platform, username, outcome.detail)
    else if (outcome.reason === 'reused') void forgetSessionRejected(platform, username)

    return outcome
  }

  const credential = await credentialFor(platform, username)
  const session = credential?.session

  if (!session) {
    return decide({
      session: null,
      reason: 'none-stored',
      // Names the likeliest cause. The Sessions page reads the SERVER, while
      // this reads the local copy, so a session captured after the last Sync is
      // visible there and absent here — which looks like the reuse is broken.
      detail: `no ${platform} login in the local company copy — press Sync if one was just captured`
    })
  }

  const stored = session as StoredSession
  const jar = stored.jar

  /**
   * IS THERE ANYTHING TO AUTHENTICATE WITH? Not: are there cookies.
   *
   * Most portals hand out a cookie jar, and for years that was the only shape
   * this understood. Delhivery and Xbees do not: they are bearer-token APIs,
   * their session is `accessToken` + `refreshToken` + `realm`, and their jar is
   * legitimately EMPTY. The probes know that — the comment below says so, and
   * they read the token off the record — but this check ran first and threw
   * every one of those sessions away as "no cookies".
   *
   * The damage was invisible and permanent: a Delhivery capture succeeded,
   * stored its tokens, and was then reported as having no session at all. The
   * gate blocked every run on the account, and re-capturing produced another
   * perfectly good token session that was rejected the same way. Nothing said
   * why, because from the outside it looked exactly like a capture that had
   * never happened.
   *
   * So the question is the core's own: does this record carry what THIS
   * platform's context needs — `jarless` plus `required` in common/claimContext,
   * which is the same table the probes and the runners read.
   */
  const { missingContextFields } = loadCore<ClaimContext>('common/claimContext')
  const missing = missingContextFields(platform, stored)

  if (missing.includes('jar') || missing.includes('accessToken')) {
    return decide({
      session: null,
      reason: 'empty-jar',
      detail: `the stored login is missing ${missing.join(', ')}`
    })
  }

  /**
   * THE DIRECT QUESTION FIRST: who does the marketplace say this session is?
   *
   * Every portal has one endpoint whose only job is to name the account behind
   * a session, and it is a far better question than the business endpoints the
   * per-platform probes use. A business endpoint can fail for business reasons
   * — no returns this week, a header it wanted and did not get — and every one
   * of those failures reads as "signed out". That is not theoretical: Flipkart's
   * probe was refused 403 EBADCSRFTOKEN over a missing header, and the app
   * reported a perfectly healthy session as dead every time it was asked.
   *
   * An identity endpoint either names the seller or it does not.
   *
   * It also reaches somewhere nothing else could. AJIO's business calls need a
   * live browser page, so `probePlatformSession` has always answered `null` for
   * it and an AJIO session could only ever be judged by its expiry date. Its
   * `/malekith/auth/me` answers from cookies alone.
   *
   * NULL FALLS THROUGH, deliberately. No identity endpoint for this platform, a
   * record missing what the request is addressed by, a timeout — none of those
   * is evidence, so the old probe still gets its turn and nothing is made worse
   * for the platforms this does not cover.
   */
  const { checkSessionIdentity } = loadCore<SessionIdentity>('common/sessionIdentity')

  try {
    const identity = await checkSessionIdentity(platform, stored, { logger })

    if (identity.ok === true) {
      return decide({ session: stored, reason: 'reused', detail: identity.detail })
    }

    if (identity.ok === false) {
      return decide({ session: null, reason: 'dead', detail: identity.detail })
    }

    logger.info(`[session-reuse] ${platform}/${username}: identity check — ${identity.detail}`)
  } catch (error) {
    // Never fatal: this is an improvement on the probe below, not a
    // replacement for it.
    logger.info(
      `[session-reuse] ${platform}/${username}: identity check could not run — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )
  }

  const { probePlatformSession } = loadCore<ProbeSession>('common/probeSession')

  let alive: boolean | null

  try {
    // The WHOLE record, not just the jar.
    //
    // Every platform's probe takes a record and reads more than cookies from
    // it: Meesho needs `supplierId` for the request body, Nykaa `portalId`,
    // Delhivery and Xbees the bearer `accessToken`. Passing the jar alone left
    // those fields undefined, so the probe asked a question that could only be
    // answered "no" and every run signed in with a perfectly good session
    // sitting in the document.
    alive = await probePlatformSession(platform, jar, session)
  } catch (error) {
    // A probe that throws tells us nothing about the session — the network may
    // simply be down — so it is treated as "cannot tell" and we sign in.
    const message = error instanceof Error ? error.message : String(error)

    return decide({
      session: null,
      reason: 'probe-failed',
      detail: `the login check failed: ${message}`
    })
  }

  if (alive === true) {
    return decide({
      session: session as StoredSession,
      reason: 'reused',
      detail: 'the saved login works — no sign-in needed'
    })
  }

  // `expiresAt` in the future is NOT liveness — it is the only thing the
  // Sessions page checks, which is why a card can read "Saved, expires in 24
  // hours" while the marketplace has already invalidated the cookies.
  //
  // Where it was minted is worth REPORTING but is not a verdict. Myntra *can*
  // bind a session to the egress IP that created it, and an earlier version of
  // this file turned that into "a server session cannot be reused here" — which
  // was wrong, and wrong in a way that hid a real bug: the automation server
  // reused the very session this app had just called dead, minutes apart. The
  // probe decides; the source is context for whoever reads the line.
  const source = typeof session.source === 'string' ? session.source : null
  const origin = source && source !== 'cms-desktop' ? ` (captured by "${source}")` : ''

  const detail =
    alive === false
      ? `the marketplace rejected the saved login${origin} — it is dead despite its expiry date`
      : `the saved login could not be verified${origin}`

  if (alive === false) return decide({ session: null, reason: 'dead', detail })

  /**
   * CANNOT VERIFY — BUT SOMETHING ALREADY DID, AND IT SAID NO.
   *
   * A platform with no HTTP identity endpoint always lands on `unverifiable`:
   * AJIO by design, and Tata CliQ because the only thing that can judge its
   * session is a browser page asking for the slave list. `unverifiable` does
   * not block, so Create Ticket started, opened a browser, found the session
   * dead, and spent an emailed OTP signing in again — mid-batch, with nobody
   * watching, on an account the app had ALREADY discovered was signed out.
   *
   * That discovery is recorded: whatever proves a session dead stamps it, and
   * the stamp is cleared the moment one is reused successfully. So a stamp
   * that is still there is the most recent evidence there is, and it is
   * evidence of death — reported as `dead` rather than thrown away because
   * this particular check has no endpoint of its own to ask.
   *
   * The operator gets the same "Update sessions first" dialog every other
   * platform's dead session produces, BEFORE anything starts.
   */
  const stamp = (await sessionRejections()).get(sessionRejectionKey(platform, username))

  if (stamp) {
    return decide({
      session: null,
      reason: 'dead',
      detail:
        `the marketplace refused this login earlier${origin} and nothing since has proved ` +
        'otherwise — re-capture it'
    })
  }

  return decide({ session: null, reason: 'unverifiable', detail })
}
