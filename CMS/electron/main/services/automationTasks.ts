import type { ScheduledTaskId, TaskOutcome } from '@shared/types/automationSchedule'
import type { CmsRow } from '@shared/types/cmsList'
import type { JobSucceededRow } from '@shared/types/jobs'
import { SCHEDULED_TASK_IDS } from '@shared/constants/automationSchedule'
import {
  refillBlankFieldsFor,
  refillExhausted,
  refillStatusFieldsFor
} from '@shared/constants/refill'
import { sessionUpdateTargets } from '@shared/utils/sessionTargets'
import { platformTally } from '@shared/utils/platformTally'
import type { SessionTarget } from '@shared/utils/sessionTargets'
import { canAuthenticateNow, healthOf } from '@shared/utils/sessionHealth'
import { refillPlatform } from '@main/automations/refill/registry'
import { loadCore } from '@main/automations/common/coreLoader'
import { processClaims } from './claimProcessor.service'
import {
  claimsAwaitingStatus,
  fileableClaims,
  pendingClaims,
  splitFileable
} from './pendingClaims.service'
import {
  abandonScriptedSignIns,
  announceSessionCapturing,
  captureSession,
  sessionHealth,
  verifySavedSessions
} from './platformSession.service'
import { reusableSession } from './sessionReuse.service'
import { runDailyBackup } from './masterBackup.service'
import { runDailySnapdealBackup } from './snapdealBackup.service'
import { runDailyFlipkartBackup } from './flipkartBackup.service'
import { runRefill } from './refill.service'

import { broadcast } from '../ipc/broadcast'
import { CLAIM_REFILL_EVENTS } from '@shared/constants/channels'
import type { RefillPassProgress, RefillPlatformProgress } from '@shared/types/refill'
import { credentialsFor } from './company.service'
import { cronLog } from './cronLog.store'
import { platformSkipped, whenPlatformSkipped } from './platformSkip.store'
import { getAccessToken } from './session.store'
import { OTP_FETCHERS } from './localLogin.service'
import { OTP_WAIT_MS } from './otpSource'
import { logger } from './logger'

/**
 * The four adapters — the ONLY place that knows what a scheduled task actually
 * calls.
 *
 * THIS FILE IS THE SEAM, and it is the answer to "will this break when a service
 * changes". The scheduler knows how to tell the time and how to write a job; it
 * does not know that AJIO has reports or that claims have statuses. Everything
 * service-shaped lives here, in four functions of the same type. So a change to
 * `runRefill`'s payload, or a new argument on `captureSession`, surfaces as a
 * TYPE ERROR in one twenty-line adapter — not as a scheduled run that quietly
 * stopped working at 3am and was noticed a fortnight later.
 *
 * Two rules hold that guarantee up, and both are worth keeping:
 *
 *   NO WORK IS IMPLEMENTED HERE. Every adapter calls the same service the
 *   button calls. A scheduled run that had its own copy of the work would drift
 *   from the button, and the button is the one that gets exercised.
 *
 *   NO TASK KNOWS ABOUT ANOTHER. They are ordered (see SCHEDULED_TASK_INFO) but
 *   never chained: each one is useful alone, and a night where sessions failed
 *   still gets a Refill run that may well work on the sessions that are fine.
 */

/**
 * One adapter. Throws to fail the run; the scheduler turns that into a job row.
 *
 * `shouldStop` is asked between the units of work a task loops over — between
 * the accounts of a Session update, between marketplaces on a refill, between
 * claims on the nightly run. Never inside one: a sign-in abandoned half-way, or
 * a claim abandoned half-filed, is the kind of thing that leaves a marketplace
 * and this machine disagreeing about what happened.
 *
 * PASSED IN, NOT READ FROM A MODULE. It is per run, because the scheduler runs
 * a manual "Run now" on one task while a scheduled task is going — the `running`
 * guard only stops a task racing ITSELF. A shared flag would have let the manual
 * run, which is not stoppable by the schedule's switch, turn stopping off for
 * the scheduled one going alongside it.
 *
 * Defaulted so a caller with no opinion — every existing test, and any future
 * one-off — runs to completion.
 */
export type TaskRunner = (shouldStop?: () => boolean) => Promise<TaskOutcome>

const number = (value: number): string => value.toLocaleString()

/** The platform key a marketplace name resolves to — "Tata CliQ" → "tatacliq". */
const keyOf = (platform: string): string => {
  const { platformKey } = loadCore<{ platformKey: (value: string) => string }>('common/platforms')

  return platformKey(platform)
}

/** Does this app keep sessions for the platform at all? The registry decides. */
const knownPlatform = (key: string): boolean => {
  const { getPlatform } = loadCore<{ getPlatform: (key: string) => unknown }>('common/platforms')

  return Boolean(getPlatform(key))
}

/* -------------------------------------------------------------------------- *
 * 1. Sessions
 * -------------------------------------------------------------------------- */

/**
 * The most this run will spend on ONE account before moving to the next.
 *
 * A sign-in that hangs does not just fail its own account, it holds every
 * account behind it: Xbees answered "LOGIN_TIMEOUT: token endpoint never fired"
 * after seventy-two seconds, and for those seventy-two seconds a run with two
 * more expired logins to fix was doing nothing at all. Whatever is wrong with
 * one credential, the other two are still worth trying.
 *
 * A minute is enough for every sign-in this app can do unattended — the scripted
 * ones take seconds, and the slow paths are slow because they are waiting for a
 * person who is not there at 02:00.
 */
const PER_ACCOUNT_MS = Number(process.env['SESSION_UPDATE_ACCOUNT_MS'] ?? 60_000)

/**
 * The deadline the sign-in itself is given.
 *
 * `captureSession` waits for a PERSON when a scripted sign-in is unavailable,
 * which is right at a desk and useless at 02:00. This is the bound it applies
 * to that wait, and it sits comfortably inside PER_ACCOUNT_MS so a capture gets
 * to close its own window and report properly, rather than being abandoned
 * mid-flight by the outer race below. It used to be four minutes — long enough
 * for one stuck account to be most of the run.
 */
const UNATTENDED_WINDOW_MS = Math.max(10_000, PER_ACCOUNT_MS - 10_000)

/**
 * The budget for one account of THIS platform.
 *
 * A platform that waits for an emailed code (Flipkart, Tata CliQ, Snapdeal —
 * every platform with an OTP reader) is given the whole OTP wait plus room to
 * boot a browser and type a password. A minute was shorter than the mail: the
 * run moved on while the sign-in was still waiting for a code that came.
 */
const accountBudgetMs = (platform: string): number =>
  OTP_FETCHERS[platform] ? Math.max(PER_ACCOUNT_MS, OTP_WAIT_MS + 3 * 60_000) : PER_ACCOUNT_MS

/** A marker only `withDeadline` can produce, so a real result cannot imitate it. */
const TIMED_OUT = Symbol('timed-out')

/** The operator pressed Skip on this marketplace while its sign-in was in flight. */
const SKIPPED_MID_SIGN_IN = Symbol('skipped-mid-sign-in')

/**
 * Runs `work`, or gives up on it after `ms`.
 *
 * THE WORK IS NOT CANCELLED — nothing here can cancel an HTTP request or a
 * browser window, and pretending otherwise would be worse than saying so. What
 * this bounds is how long the RUN waits. An abandoned sign-in that later
 * succeeds still stores its session, which is a good outcome arriving late; one
 * that later fails logs its own error against its own account.
 */
const withDeadline = async <T>(ms: number, work: () => Promise<T>): Promise<T | typeof TIMED_OUT> => {
  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      work(),
      new Promise<typeof TIMED_OUT>(resolve => {
        timer = setTimeout(() => resolve(TIMED_OUT), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Re-captures logins that have expired, are about to, or were never captured.
 *
 * THE SAME SET THE BANNER NAMES, which it was not. The banner flags `expired`
 * and `none`; this flagged `expired` and `expiring` and skipped `none` — so a
 * Snapdeal account this machine had never signed in was listed in red at the
 * top of the screen while the job that exists to fix it reported "Every session
 * was still good". Two rules for one question, and the operator reasonably
 * believed the one that said nothing was wrong.
 *
 * `none` was excluded on the grounds that a first sign-in needs a person. That
 * is true of a first sign-in the app cannot SCRIPT — and it is exactly the same
 * condition that makes an expired one need a person, so it is now checked per
 * account rather than assumed from the state. An account that cannot be signed
 * in unattended is reported by name, immediately, instead of holding a window
 * open for four minutes waiting for somebody who is asleep.
 *
 * `expiring` stays in: a session that dies in an hour still works now, and
 * renewing it before the claim run is the whole point of doing this at 02:00.
 */
/**
 * Did the marketplace accept the session we just captured?
 *
 * THE DISAGREEMENT THIS SETTLES. A run reported "1 updated" at 18:54 and the
 * card's Check now, pressed at 19:40, listed the same Delhivery account as
 * Rejected. Both were reading their own evidence honestly: the run trusted
 * `captureSession` returning success, and Check now had ASKED DELHIVERY.
 *
 * They come apart because a capture's success means "a session was signed in
 * for and stored", not "the marketplace honours it". The browser path does
 * check — it refuses to save a jar the portal answers anonymously to — but the
 * token platforms go through `publishSession`, which stores what it was given.
 * Delhivery is one of those: a token accepted at sign-in and refused on the
 * next request is saved, reported as fixed, and found dead by the first thing
 * that tries to use it.
 *
 * So the run now asks, on exactly the accounts it just changed. `reusableSession`
 * reads the LOCAL company copy, which `rememberCompanySession` has already
 * updated, so it is the NEW session being probed — and it writes its own verdict
 * to the rejection store, which is what leaves the card, the banner and the next
 * run agreeing with this job instead of contradicting it twenty minutes later.
 *
 * ONLY `dead` counts. "Cannot tell" — AJIO, whose probe needs a live page, or a
 * network that dropped — is not evidence of a bad capture, and treating it as
 * one would mark good sessions red every night.
 */
const refusedAfterCapture = async (target: SessionTarget): Promise<string | null> => {
  const verdict = await reusableSession(target.platform, target.username)

  return verdict.reason === 'dead' ? verdict.detail : null
}

/**
 * Drop the logins no sign-in could fix.
 *
 * A credential the marketplace has REFUSED cannot be re-captured — the password
 * is wrong, and every attempt opens a browser, drives a full sign-in and is
 * told the same thing. Three Snapdeal accounts did exactly that, every run, for
 * about a minute each, and the only outcome was three more identical failures
 * in the log.
 *
 * ASKED OF `credentialsFor`, which already excludes them, so the rule lives in
 * one place and legacy credentials are safe: that function compares against
 * `false` on the RAW company document, where absent still means "nobody has
 * said". The session-health rows cannot be used for this — the backend collapses
 * an absent flag into `false` on the way out, so filtering on those would drop
 * every credential written before the field existed, and the Login update would
 * stop re-capturing anything at all.
 *
 * IT ALSO KEEPS THE SCHEDULE FROM STICKING. The automatic pause waits for the
 * Login update to fix every outstanding login; one that can never be fixed
 * would hold the whole schedule off for ever. These are reported on the Login
 * page instead, where the Verify button is.
 */
const signableOnly = async (targets: SessionTarget[]): Promise<SessionTarget[]> => {
  /** Platform → the logins still worth signing in with; null when unknowable. */
  const byPlatform = new Map<string, Set<string> | null>()
  const kept: SessionTarget[] = []

  for (const target of targets) {
    const key = keyOf(target.platform)

    if (!byPlatform.has(key)) {
      /*
       * FAILS OPEN, deliberately.
       *
       * `null` means the company copy could not be read at all — not signed in
       * yet, a store that has not been written, a test with no Electron around
       * it. Keeping every target then is the behaviour this task had before
       * the filter existed; the alternative is a run that silently re-captures
       * nothing because a local file was unavailable, which is the far more
       * expensive way to be wrong.
       */
      byPlatform.set(
        key,
        await Promise.all([credentialsFor(key), credentialsFor(key, { includeRefused: true })])
          .then(([signable, everyLogin]) =>
            /*
             * AN EMPTY LIST IS NOT "ALL REFUSED" — so ask both questions.
             *
             * `credentialsFor` answers `[]` for a company copy that is missing,
             * not yet synced, or unreadable, and ALSO for a platform whose every
             * login was refused. Telling them apart needs the list with the
             * refused ones left in: if THAT is empty too, this file could not
             * see the company's logins and the run keeps every target (see
             * above). If it is not, the platform really has no login worth
             * signing in with.
             *
             * The second case used to be read as the first. A company with a
             * single Tata CliQ login marked `is_verified: false` had it signed
             * in to on every run, because one refused login out of one looked
             * exactly like an unreadable file.
             */
            everyLogin.length === 0
              ? null
              : new Set(signable.map(credential => credential.username.trim().toLowerCase()))
          )
          .catch(() => null)
      )
    }

    const signable = byPlatform.get(key)

    if (!signable || signable.has(target.username.trim().toLowerCase())) {
      kept.push(target)

      continue
    }

    logger.info(
      `[session-update] ${target.label} · ${target.username}: left out — the marketplace has ` +
        'refused this login, so signing in again cannot fix it'
    )
  }

  return kept
}

/**
 * The logins still outstanding, in the words the sidebar will show.
 *
 * REPORTS, DOES NOT DECIDE. The scheduler owns the switch, and this file is
 * what the scheduler runs — reaching back into it from here would be an import
 * cycle, which in a bundled main process is how a function arrives undefined
 * at the one moment it is called.
 *
 * The rule is `sessionUpdateTargets`, the same one the banner, the Settings
 * card and this task's own queue read, so nothing can say "paused because of
 * logins" about a set no other screen agrees is broken.
 */
/**
 * Is the app allowed to stop the schedule when logins cannot be re-captured?
 *
 * `AUTOMATION_PAUSE_ON_SESSION_FAIL` in the core's constants, so both runners
 * read one switch rather than each growing its own.
 *
 * READ AT THE MOMENT OF THE DECISION, like the other core flags here: a value
 * captured at startup would need a restart to change its mind, and this is a
 * flag somebody flips precisely when a marketplace is misbehaving.
 *
 * DEFAULTS TO ON if the constant cannot be read. The flag chooses between
 * "stop and tell me" and "carry on regardless"; a core that failed to load is
 * not a reason to pick the riskier one on the operator's behalf.
 */
export const sessionPauseEnabled = (): boolean => {
  try {
    const { AUTOMATION_PAUSE_ON_SESSION_FAIL } = loadCore<{
      AUTOMATION_PAUSE_ON_SESSION_FAIL: boolean
    }>('common/constants')

    return AUTOMATION_PAUSE_ON_SESSION_FAIL !== false
  } catch (error) {
    logger.warn('[schedule] could not read AUTOMATION_PAUSE_ON_SESSION_FAIL — assuming on', error)

    return true
  }
}

export const outstandingSessions = async (): Promise<{ count: number; detail: string }> => {
  const health = await sessionHealth()

  if (!health.success) return { count: 0, detail: '' }

  /*
   * THE SAME RULE THE RUN USES, and it has to be.
   *
   * This count is what pauses the schedule and what un-pauses it. A login the
   * marketplace has refused can never be re-captured, so counting it here would
   * hold every automation off for ever, waiting for a Login update that cannot
   * succeed — the one failure mode that turns a safety feature into a stoppage.
   */
  const outstanding = await signableOnly(sessionUpdateTargets(health.data, knownPlatform))

  if (outstanding.length === 0) return { count: 0, detail: '' }

  const names = [...new Set(outstanding.map(target => target.label))]
  /*
   * NAMED, BUT NOT ALL OF THEM. This sentence is read in a 200px sidebar, and
   * all nine marketplaces spelled out is five lines of wrapped text where two
   * will do. Three names say which kind of problem it is; the Settings card
   * lists every one, with its account and its state, for anyone who needs the
   * rest.
   */
  const shown = names.slice(0, 3).join(', ')
  const rest = names.length - 3

  return {
    count: outstanding.length,
    detail:
      `${outstanding.length} login${outstanding.length === 1 ? '' : 's'} still need re-capturing` +
      ` (${shown}${rest > 0 ? ` +${rest} more` : ''})`
  }
}

const refreshSessions: TaskRunner = async (shouldStop = () => false) => {
  const health = await sessionHealth()

  if (!health.success) throw new Error(health.error.message)

  /*
   * THE MARKETPLACE DECIDES, NOT THE DATE — every run, for every session.
   *
   * `expiresAt` is not measured. It is a TTL from a constant applied when the
   * session was captured, and the constant is wrong, so it is wrong in both
   * directions at once: a session it calls expired may be perfectly good, and
   * one it calls active may have been revoked hours ago.
   *
   * Both are expensive. Believing "expired" re-captures a working session —
   * a browser sign-in, and on Tata CliQ an emailed one-time code, for nothing.
   * Believing "active" is worse: this task found nothing to do while Auto
   * claim, two hours later, passed the account's claims over because the
   * marketplace refused that exact jar.
   *
   * So the check runs first and asks about EVERY stored session. Asking is one
   * request; guessing is a sign-in.
   */
  const verdicts = await verifySavedSessions(health.data)
  const refused = verdicts.filter(entry => !entry.usable && !entry.unreachable)

  /*
   * HOW LONG EACH REFUSED SESSION ACTUALLY LASTED.
   *
   * The measurement the constant was guessing at. Written where it can be read
   * at a glance, because it is the number that says whether the TTL is nearly
   * right or nowhere near — and nothing else in the app records it.
   */
  for (const entry of refused) {
    if (entry.maintainedHours === null) continue

    cronLog(
      'info',
      'Login update',
      `Session maintained for ${entry.maintainedHours} hour${entry.maintainedHours === 1 ? '' : 's'}`,
      {
        taskId: 'session-refresh',
        detail: `${entry.platform} · ${entry.username} — ${entry.detail ?? 'the marketplace refused it'}`
      }
    )
  }

  for (const entry of verdicts.filter(item => item.unreachable)) {
    // Said, but never acted on: "could not ask" is not "the session is bad".
    cronLog('waiting', 'Login update', 'Could not check a session', {
      taskId: 'session-refresh',
      detail: `${entry.platform} · ${entry.username} — left as it is rather than re-captured on a guess`
    })
  }

  /*
   * THE LIST TO RE-CAPTURE, from the check rather than from the dates.
   *
   * `sessionUpdateTargets` is still the shared rule the Settings card renders,
   * so the card and the run agree — and it now agrees with the marketplace
   * too, because `verifySavedSessions` has just stamped every refusal and
   * cleared every session that was accepted. What it returns after that pass
   * is "no session, or one the marketplace just turned down".
   */
  const stale = await signableOnly(sessionUpdateTargets(health.data, knownPlatform))

  /*
   * WAS THERE AN OPERATOR WHEN THIS STARTED? Compared against the token during
   * the loop, so "signed out mid-run" is distinguishable from "never had a
   * token" — a server-side or test context where the absence means nothing and
   * must not abandon the work.
   */
  const signedInAtStart = Boolean(getAccessToken())
  const rows: JobSucceededRow[] = []
  let succeeded = 0
  let timedOut = 0
  /** Captured and saved, and the marketplace still says no. */
  let hollow = 0

  // Sequential, like the banner's "Update now": each opens a real browser
  // window, and two at once compete for the screen and for the same profile.
  /** Set when the master switch stopped this run part-way. */
  let stoppedAfter: number | null = null

  /** Marketplaces an operator passed over while the run was going. */
  let skippedByHand = 0

  /** Per marketplace, for the run's history row. */
  const perPlatform = platformTally()

  for (const [index, target] of stale.entries()) {
    /*
     * THE MASTER SWITCH, CHECKED BETWEEN ACCOUNTS.
     *
     * This is one task that signs in to seven marketplaces in a row, and a
     * check that only happened between TASKS stopped nothing for several
     * minutes — the switch said "Stopping…" while the loop carried on through
     * every remaining login. Here is the boundary that actually means
     * something: the account in flight finishes, and the rest are left.
     */
    if (shouldStop()) {
      stoppedAfter = index

      logger.info(
        `[session-update] stopped by the master switch after ${index} of ${stale.length}`
      )
      break
    }

    // THE HEARTBEAT. One line before each account, naming it and its place in
    // the queue. Without it a run that stalls is indistinguishable in the log
    // from a run that finished — the last thing written is whatever the
    // previous account said, and the next line does not arrive.
    logger.info(
      `[session-update] ${index + 1}/${stale.length} — ${target.label} · ${target.username}`
    )

    /**
     * A PLATFORM WHOSE COMPANY SWITCH IS OFF NEVER REACHES THIS LOOP.
     *
     * `isAutoLoginOnActiveSession[platform] === false` means the company wants
     * that platform's logins left to a person, and `sessionUpdateTargets` drops
     * them before the queue is built — so the run, the Settings card and the
     * schedule's outstanding-logins gate all agree. Everything that does reach
     * here is attempted; MAIN_VITE_SESSION_UPDATE_AUTOMATICALLY is this
     * computer's own consent to drive a browser unattended.
     *
     * `unattended` also means no window is ever opened: one nobody can complete
     * would hold the account's whole budget and fail anyway. An account that
     * genuinely cannot be signed in without a person comes back as a failure
     * naming itself, in the same minute, instead of being passed over in advance.
     */
    /*
     * PASSED OVER BY HAND. The operator watching the panel pressed Skip on
     * this marketplace: leave its accounts alone and get on with the others.
     *
     * Counted as SKIPPED, never failed. Nobody tried, so nothing was learned
     * about the login — and an account marked failed here would spend its
     * retry budget on a decision a person made for unrelated reasons.
     */
    if (platformSkipped('session-refresh', keyOf(target.platform))) {
      skippedByHand += 1

      logger.info(`[session-update] ${target.label} skipped by hand`)
      continue
    }

    // THE SAME HEARTBEAT, ON THE SCREEN. The log line above tells whoever reads
    // the file; this tells whoever is watching the Settings card, which is the
    // person actually waiting. Cleared in the `finally` below so no chip can be
    // left spinning over a run that has moved on or ended.
    announceSessionCapturing({ platform: target.platform, username: target.username })

    const startedAt = Date.now()
    let result:
      | Awaited<ReturnType<typeof captureSession>>
      | typeof TIMED_OUT
      | typeof SKIPPED_MID_SIGN_IN

    /*
     * SKIP ALSO ENDS THE SIGN-IN IN FLIGHT. Checking only before each account
     * left the button on "Skipping" for as long as the current one took — up
     * to the whole OTP wait when the code never comes. A sign-in is safe to
     * abandon: nothing is half-written at the marketplace, and the stored
     * session is untouched.
     */
    const skipWatch = whenPlatformSkipped('session-refresh', keyOf(target.platform))

    try {
      result = await Promise.race([
        withDeadline(accountBudgetMs(keyOf(target.platform)), () =>
          captureSession({
            platform: target.platform,
            username: target.username,
            credentialId: target.credentialId,
            waitMs: UNATTENDED_WINDOW_MS,
            unattended: true
          })
        ),
        skipWatch.promise.then((): typeof SKIPPED_MID_SIGN_IN => SKIPPED_MID_SIGN_IN)
      ])
    } finally {
      skipWatch.cancel()
      announceSessionCapturing(null)
    }

    const took = Math.round((Date.now() - startedAt) / 1000)

    if (result === SKIPPED_MID_SIGN_IN) {
      // The abandoned capture settles on its own once its browser is gone;
      // nothing here waits for it, and nothing it says is recorded against
      // the account — a person decided this, not the login.
      await abandonScriptedSignIns(`${target.label} skipped by hand`)
      skippedByHand += 1

      logger.info(
        `[session-update] ${target.label} · ${target.username}: skipped by hand after ${took}s — ` +
          'sign-in abandoned, moving on'
      )
      continue
    }

    /*
     * SIGNED OUT WHILE THIS ACCOUNT WAS IN FLIGHT.
     *
     * Not a failure, and it must not be recorded as one: the operator left, the
     * token this would be saved with was cleared, and the sign-in was ended
     * underneath us on purpose (see auth.service → abandonSignIns). Counting it
     * would put a real-looking failure against an account nothing was wrong
     * with, and push the task's retry backoff out over a decision somebody made
     * deliberately.
     */
    if (signedInAtStart && !getAccessToken()) {
      stoppedAfter = index

      logger.info(
        `[session-update] abandoned at ${target.label} · ${target.username} — the app was signed out`
      )
      break
    }

    if (result === TIMED_OUT) {
      timedOut += 1
      perPlatform.add(keyOf(target.platform), { total: 1, failed: 1 })
      logger.warn(
        `[session-update] ${target.label} · ${target.username}: gave up after ${took}s — ` +
          'moving on to the next account'
      )
      rows.push({
        ref: `${target.label} · ${target.username}`,
        ticketId: null,
        note:
          `Gave up after ${took}s. The sign-in did not finish in time, so the rest of the ` +
          'accounts were not held up. Nothing was saved — the previous login is untouched.'
      })

      continue
    }

    if (result.success) {
      const refusedDetail = await refusedAfterCapture(target)

      if (refusedDetail) {
        hollow += 1
        perPlatform.add(keyOf(target.platform), { total: 1, failed: 1, detail: refusedDetail })
        logger.warn(
          `[session-update] ${target.label} · ${target.username}: signed in and saved, but ` +
            `${target.label} still refuses the session — ${refusedDetail} (${took}s)`
        )
        rows.push({
          ref: `${target.label} · ${target.username}`,
          ticketId: null,
          note:
            `Signed in and saved a new login, but ${target.label} refuses it: ${refusedDetail}. ` +
            'The account stays marked for re-capture rather than being reported as fixed — this ' +
            'usually means the credentials need checking, or the sign-in needs watching from the ' +
            'Login page.'
        })

        continue
      }

      succeeded += 1
      perPlatform.add(keyOf(target.platform), { total: 1, succeeded: 1 })
    } else {
      perPlatform.add(keyOf(target.platform), { total: 1, failed: 1, detail: result.error.message })
    }

    logger.info(
      `[session-update] ${target.label} · ${target.username}: ` +
        `${result.success ? 'updated' : `failed — ${result.error.message}`} (${took}s)`
    )
    rows.push({
      ref: `${target.label} · ${target.username}`,
      ticketId: null,
      note: result.success ? result.data.message : result.error.message
    })
  }

  // A timeout is its own bucket, not lumped in with a refusal: "Meesho said no"
  // and "the sign-in never came back" lead to completely different places.
  // `hollow` needs no term of its own: it is neither a success nor a timeout, so
  // it already lands here. It is named separately BELOW because "Delhivery would
  // not take the new session" and "the sign-in failed" send somebody to two
  // different places.
  // What was ATTEMPTED, which is not the whole list when the switch stopped it
  // part-way. Counting against `stale.length` there would report every account
  // nobody got to as a failure.
  const attempted = stoppedAfter ?? stale.length
  // Skipped by hand is not attempted and not failed — nobody tried — so it
  // comes off the total rather than counting against the run.
  const failed = attempted - succeeded - timedOut - skippedByHand

  /*
   * NOTHING BELOW THIS TASK CAN WORK ON A LOGIN THE MARKETPLACE REFUSES.
   *
   * The Login update runs first for exactly that reason, and until now a run
   * that fixed none of them was followed by the refill and the claims anyway:
   * a night of opening browsers, each claim burning an attempt against a dead
   * session, every row ending Failed for a reason that has nothing to do with
   * the claim.
   *
   * So the app stops the schedule itself and says why. Read AFTER the loop
   * from the same rule everything else uses, not from the counters above — a
   * capture can succeed and still leave the marketplace refusing the session,
   * and `sessionUpdateTargets` is the one place that knows the difference.
   */
  return {
    // "Every session was still good" only when that is true of ALL of them.
    // A skipped account is not a good session — it is the one the banner is
    // still going to be red about in the morning, and the previous wording
    // reported it as nothing to do.
    detail:
      stale.length === 0
        ? 'Every login was still good'
        : [
            stoppedAfter !== null
              ? `stopped after ${number(stoppedAfter)} of ${number(stale.length)}`
              : '',
            succeeded > 0 ? `${number(succeeded)} updated` : '',
            failed > 0 ? `${number(failed)} failed` : '',
            timedOut > 0 ? `${number(timedOut)} timed out` : '',
            // Worth its own words: these are the sessions the marketplace
            // turned down when it was asked, whatever their expiry said.
            refused.length > 0
              ? `${number(refused.length)} refused by the marketplace`
              : '',
            // The one an operator must not read as fixed.
            hollow > 0 ? `${number(hollow)} still refused after re-capturing` : '',
            // Said plainly, because it is the one line that explains a login
            // the run reached and left alone.
            skippedByHand > 0 ? `${number(skippedByHand)} skipped by hand` : ''
          ]
            .filter(Boolean)
            .join(', '),
    total: stale.length,
    succeeded,
    // Counted as failures for the job's own tally: nothing was fixed, and a
    // task that reported them as successes would show a green run beside a red
    // banner — which is the bug this whole change is about.
    failed: failed + timedOut,
    summary: [
      { label: 'Logins needing attention', value: number(stale.length) },
      { label: 'Refused by the marketplace', value: number(refused.length) },
      { label: 'Updated', value: number(succeeded) },
      { label: 'Failed', value: number(failed) },
      ...(hollow > 0
        ? [{ label: 'Still refused after re-capturing', value: number(hollow) }]
        : []),
      ...(timedOut > 0
        ? [{ label: 'Timed out', value: number(timedOut) }]
        : [])
    ],
    rows,
    platforms: perPlatform.list()
  }
}

/* -------------------------------------------------------------------------- *
 * 2. The AJIO backup
 * -------------------------------------------------------------------------- */

/**
 * Re-reads both AJIO reports, for every AJIO account, into the local backup —
 * each from where it last left off (see `runDailyBackup`).
 *
 * Both reports in one task rather than two, because they are one question —
 * "is the backup current?" — and splitting them would let an operator schedule
 * half an answer.
 */
const syncAjioReports: TaskRunner = async (shouldStop = () => false) => {
  const reports = await runDailyBackup(shouldStop)

  if (reports.length === 0) {
    throw new Error('This company has no AJIO account to read the reports as')
  }

  const added = reports.reduce((total, report) => total + report.added, 0)
  const skipped = reports.reduce((total, report) => total + report.skipped, 0)
  const failed = reports.reduce((total, report) => total + report.failed, 0)
  const named = (report: BackupReportName): string => (report === 'forward' ? 'Forward' : 'Return')
  // Added up across the accounts: the operator still reads two numbers.
  const byReport = (['forward', 'return'] as const).map(report => ({
    report,
    added: reports.filter(entry => entry.report === report).reduce((total, entry) => total + entry.added, 0)
  }))

  return {
    // The two numbers the operator asked to see, named: a single total would
    // hide one report failing entirely behind the other's good night.
    detail: byReport.map(entry => `${named(entry.report)} ${number(entry.added)}`).join(' · '),
    total: added + skipped,
    succeeded: added,
    failed,
    summary: [
      ...byReport.map(entry => ({
        label: `${named(entry.report)} report — records synced`,
        value: number(entry.added)
      })),
      { label: 'Already held', value: number(skipped) },
      ...(failed > 0 ? [{ label: 'Pages failed', value: number(failed) }] : [])
    ],
    // One row per account and report, so one account failing is visible.
    rows: reports.map(report => ({
      ref: `${named(report.report)} report${report.username ? ` — ${report.username}` : ''}`,
      ticketId: null,
      note:
        `${number(report.added)} saved, ${number(report.skipped)} already held` +
        (report.failed > 0 ? `, ${report.failed} page(s) failed` : '') +
        (report.error ? ` — ${report.error}` : '')
    }))
  }
}

type BackupReportName = 'forward' | 'return'

/* -------------------------------------------------------------------------- *
 * 3. The Snapdeal report sync
 * -------------------------------------------------------------------------- */

/**
 * Collects the Snapdeal reports that have finished building, then asks for the
 * last few days again.
 *
 * TWO HALVES, AND THE PASS IS A SUCCESS WITH EITHER OF THEM EMPTY. Snapdeal
 * builds a report server-side over minutes, so a night that sends four
 * requests and collects nothing is the system working — the files arrive on
 * the next pass. A night that collects nothing AND has nothing outstanding is
 * the one worth reading twice, which is why "still building" is reported as
 * its own number rather than folded into the total.
 *
 * The only real failure here is having no account chosen: a pass that quietly
 * does nothing every night while reporting success is exactly the blindness
 * this backup exists to remove.
 */
const syncSnapdealReports: TaskRunner = async (shouldStop = () => false) => {
  const results = await runDailySnapdealBackup(shouldStop)

  // No Snapdeal login at all is nothing to do, not a failure: a company that
  // does not sell on Snapdeal must not show a red run, retried every check.
  if (results.length === 0) {
    return {
      detail: 'No Snapdeal account — nothing to sync',
      total: 0,
      succeeded: 0,
      failed: 0,
      summary: [{ label: 'Snapdeal accounts', value: '0' }],
      rows: []
    }
  }

  const total = (pick: (result: (typeof results)[number]) => number): number =>
    results.reduce((sum, result) => sum + pick(result), 0)
  const sent = total(result => result.request?.sent ?? 0)
  const skipped = total(result => result.request?.skipped ?? 0)
  const stored = total(result => result.collect?.stored ?? 0)
  const added = total(result => result.collect?.added ?? 0)
  const pending = total(result => result.collect?.pending ?? 0)
  const failed = total(result => (result.request?.failed ?? 0) + (result.collect?.failed ?? 0))

  return {
    detail:
      [
        `${number(stored)} collected`,
        `${number(added)} row(s) saved`,
        sent > 0 ? `${number(sent)} requested` : '',
        pending > 0 ? `${number(pending)} still building` : ''
      ]
        .filter(Boolean)
        .join(' · '),
    total: sent + stored + pending,
    succeeded: stored,
    failed,
    summary: [
      { label: 'Reports collected', value: number(stored) },
      { label: 'Records saved', value: number(added) },
      { label: 'Windows requested', value: number(sent) },
      { label: 'Windows already covered', value: number(skipped) },
      { label: 'Still building at Snapdeal', value: number(pending) },
      ...(failed > 0 ? [{ label: 'Failed', value: number(failed) }] : [])
    ],
    // One row per account, so one account failing is visible.
    rows: results.map(result => {
      const accountSent = result.request?.sent ?? 0
      const accountPending = result.collect?.pending ?? 0
      const error = result.collect?.error ?? result.request?.error ?? null

      return {
        ref: `Return report — ${result.username}`,
        ticketId: null,
        note:
          `${number(result.collect?.stored ?? 0)} report(s) collected, ` +
          `${number(result.collect?.added ?? 0)} row(s) saved` +
          (accountSent > 0 ? `, ${number(accountSent)} window(s) requested` : '') +
          (accountPending > 0 ? `, ${number(accountPending)} still building` : '') +
          (error ? ` — ${error}` : '')
      }
    })
  }
}

/* -------------------------------------------------------------------------- *
 * Claims waiting to be filed — `pendingClaims.service`, shared with the
 * Settings card so the row cannot list a different set from the one that runs.
 * -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- *
 * 3. Refill Data
 * -------------------------------------------------------------------------- */

/**
 * Asks each marketplace for the blanks on its Pending claims.
 *
 * Grouped by platform because that is how `runRefill` works and how the
 * marketplaces work — one sign-in answers a platform's whole list. Platforms
 * with nothing offered to refill are skipped rather than called with an empty
 * field list.
 *
 * ONE PLATFORM'S FAILURE IS NOT THE RUN'S. A marketplace that is down at 03:00
 * is recorded against its own row and the next platform is still tried: the
 * alternative loses four working platforms to one that is not.
 */
/**
 * The platforms holding at least one session that could answer right now.
 *
 * Returns null when the question cannot be asked at all — no token, or the
 * health endpoint unreachable. A caller must treat that as "do not gate", never
 * as "nothing is live": the two are indistinguishable from the answer alone,
 * and only one of them is safe to act on.
 *
 * A credential hidden in Monitor (`visible === false`) is not a session this
 * machine may use, so it cannot keep its platform in the run.
 */
const platformsWithLiveSession = async (): Promise<Set<string> | null> => {
  const health = await sessionHealth()

  if (!health.success) {
    logger.warn(
      `[schedule] could not read session health (${health.error.message}) — ` +
        'refill will try every platform rather than skip on a guess'
    )

    return null
  }

  const live = new Set<string>()

  for (const entry of health.data) {
    const usable = entry.credentials.some(
      credential =>
        credential.visible !== false && canAuthenticateNow(healthOf(credential.session))
    )

    if (usable) live.add(keyOf(entry.platform))
  }

  return live
}

/**
 * The two passes Refill Data makes, and why they are not one.
 *
 *   blanks  — what a claim needs BEFORE it can be filed, over `Pending` rows.
 *             Only empty fields are filled.
 *   status  — where an already-filed ticket now stands, over the rows whose
 *             status can still move.
 *
 * THE BUG THAT SPLIT THEM. One pass asked for every field, over Pending rows
 * only. `statusChange` was therefore asked for rows that had no ticket yet —
 * nothing to report — and NEVER asked for the rows that had one, because those
 * are not Pending. The claim status was, in practice, never refreshed.
 */
export type RefillPhase = 'blanks' | 'status'

const refillPass = async (
  phase: RefillPhase,
  shouldStop: () => boolean = () => false
): Promise<TaskOutcome> => {
  const statusPass = phase === 'status'
  const sweep = statusPass ? await claimsAwaitingStatus() : null
  const claims = sweep ? sweep.rows : await pendingClaims()
  const fieldsFor = statusPass ? refillStatusFieldsFor : refillBlankFieldsFor
  const byPlatform = new Map<string, CmsRow[]>()

  /** Rows the nightly run has already asked about MAX_REFILL_ATTEMPTS times. */
  let capped = 0

  for (const row of claims) {
    const platform = keyOf(row.platform)

    /*
     * NOTHING TO ASK THIS PLATFORM IN THIS PASS.
     *
     * Nykaa has only a claim status, so the blanks pass skips it entirely;
     * Tata CliQ and Xbees have no status at all, so the status pass does.
     * Checked per pass rather than per platform, because "this app refills
     * this marketplace" and "this pass has a question for it" are different
     * facts and only the second one decides whether a row is carried.
     */
    if (fieldsFor(platform).length === 0) continue

    /*
     * PAST ITS BUDGET, so the sweep does not carry it at all.
     *
     * The run itself would skip this row after reading it, but a nightly sweep
     * over a back catalogue would then spend one request per dead row, every
     * night, for ever. Dropped here it costs nothing — and the count is
     * reported, because "fewer rows than I expected" needs an answer.
     */
    /*
     * THE BUDGET IS THE BLANKS PASS'S ALONE.
     *
     * Three fruitless asks about an AWB means the number is wrong, and a
     * fourth answers nothing — that is what the cap is for. "Still In Review"
     * is not a fruitless ask; it is the ANSWER, and the next night's answer
     * may differ. Capping the status pass would stop tracking a ticket after
     * three nights, which is the one thing it exists to do.
     */
    if (!statusPass && refillExhausted(row.refillAttempts)) {
      capped += 1

      continue
    }

    byPlatform.set(platform, [...(byPlatform.get(platform) ?? []), row])
  }

  /**
   * WHAT THE CARD SHOWS WHILE THIS RUNS.
   *
   * Every marketplace the pass will reach, listed before the first one starts
   * — so the operator can see the six waiting behind the one that is working,
   * rather than a single chip that moves and gives no idea how far along it
   * is. The claim-by-claim event carries the live numbers for whichever one is
   * running; this carries the shape around it.
   */
  /*
   * EVERY PLATFORM THE PASS TOUCHES, including the ones it touches by
   * deciding not to.
   *
   * A marketplace whose every claim was answered within the window has no rows
   * in `byPlatform` at all, so it used to vanish from the panel — and "Myntra
   * is not listed" reads as "Myntra was forgotten", which is the opposite of
   * what happened. It is listed, with the count and its own badge.
   */
  const upToDate = sweep?.upToDate ?? new Map<string, number>()
  const platforms = [...new Set([...byPlatform.keys(), ...upToDate.keys()])]

  const progress: RefillPlatformProgress[] = platforms.map(platform => ({
    platform,
    state: byPlatform.has(platform) ? 'waiting' : 'skipped',
    checked: 0,
    changed: 0,
    skipped: 0,
    // Answered within the last few days, so not asked again this run. Its own
    // number, never folded into `skipped`: "nothing to tell us" and "we
    // already know" are different answers and only one of them is work.
    upToDate: upToDate.get(platform) ?? 0,
    note: null
  }))

  const announce = (running = true): void => {
    broadcast(CLAIM_REFILL_EVENTS.pass, {
      running,
      phase,
      /*
       * A COPY, not the live array. `progress` is mutated in place as the run
       * moves, so sending it hands every listener the same object — and any
       * that keeps one is holding something that changes under it. It survives
       * today only because IPC serialises on the way out, which is a property
       * of the transport rather than of this code.
       */
      platforms: progress.map(entry => ({ ...entry }))
    } satisfies RefillPassProgress)
  }

  const mark = (
    platform: string,
    patch: Partial<RefillPlatformProgress>
  ): void => {
    const entry = progress.find(row => row.platform === platform)

    if (entry) Object.assign(entry, patch)

    announce()
  }

  announce()

  const rows: JobSucceededRow[] = []
  /** Per platform, for the one-line detail — "ajio 41 · meesho 12". */
  const counts: { platform: string; filled: number }[] = []
  /** Per platform, for the run's history row. */
  const perPlatform = platformTally()
  let filled = 0
  let attempted = 0
  let failed = 0
  /** Rows on a platform that had no session to ask with. */
  let unauthenticated = 0

  /**
   * Which platforms hold a session worth asking with — read ONCE, not per
   * platform, because `sessionHealth` is one call covering all of them.
   *
   * WHY THE RUN GATES ON THIS. Without it a platform whose every session is
   * dead was still swept: `mappingAccounts` only drops accounts that need a
   * one-time code, so a password-only login with an expired jar is kept and
   * the run tries to sign it in — a real browser, a real marketplace, minutes
   * of it, per account, before the first row is even asked about. At 23:00 that
   * is time taken from the platforms that CAN answer.
   *
   * `null` means the question could not be asked (offline, or no token). The
   * gate is then skipped entirely rather than guessed: refusing every platform
   * because the health endpoint was briefly unreachable would turn a transient
   * fault into a silent night of no work at all.
   */
  const live = await platformsWithLiveSession()

  /** Set when the master switch stopped this run part-way. */
  let stoppedEarly = false

  for (const [platform, claimRows] of byPlatform) {
    // Between marketplaces: each one signs in and sweeps its rows, so this is
    // the boundary where stopping costs nothing and leaves nothing half-asked.
    if (shouldStop()) {
      stoppedEarly = true

      logger.info('[refill] stopped by the master switch')
      break
    }

    const usable = claimRows.filter(row => row.returnAwb)

    if (usable.length === 0) {
      mark(platform, {
        state: 'skipped',
        skipped: claimRows.length,
        note: 'No row here carries a return AWB to ask about'
      })

      continue
    }

    mark(platform, { state: 'running' })

    /*
     * SKIPPED BEFORE ANYTHING OPENS, and it costs one Set lookup.
     *
     * The offline platforms are exempt: AJIO's refill reads the local report
     * backup and never signs in, so "no session" is not a reason to pass over
     * the one platform that needs none. `useApis` is not in play here — the
     * scheduled run never sets it.
     */
    if (live !== null && !live.has(platform) && !refillPlatform(platform)?.offline) {
      unauthenticated += usable.length
      counts.push({ platform, filled: 0 })
      rows.push({
        ref: platform,
        ticketId: null,
        note: 'Skipped — no account on this platform has a usable login'
      })
      logger.info(
        `[schedule] refill skipping ${platform}: ${usable.length} row(s) waiting, no live session to ask with`
      )
      mark(platform, {
        state: 'skipped',
        skipped: usable.length,
        note: 'No account on this platform has a usable login'
      })

      continue
    }

    attempted += usable.length

    const result = await runRefill({
      platform,
      claims: usable.map(row => ({ cmsId: row.id, awb: row.returnAwb })),
      fields: fieldsFor(platform),
      // The status pass keeps asking for as long as a ticket can move; only
      // the blanks pass spends a row's budget.
      countsAttempt: !statusPass,
      // Checked per row as well as here between marketplaces.
      shouldStop
    })

    if (!result.success) {
      failed += usable.length
      counts.push({ platform, filled: 0 })
      perPlatform.add(platform, { total: usable.length, failed: usable.length, detail: result.error.message })
      rows.push({ ref: platform, ticketId: null, note: `Failed — ${result.error.message}` })
      logger.warn(`[schedule] refill for ${platform} failed: ${result.error.message}`)
      mark(platform, {
        state: 'done',
        checked: usable.length,
        skipped: usable.length,
        note: result.error.message
      })

      continue
    }

    filled += result.data.filled
    failed += result.data.failed
    counts.push({ platform, filled: result.data.filled })
    perPlatform.add(platform, {
      total: result.data.filled + result.data.untouched + result.data.notFound + result.data.failed,
      succeeded: result.data.filled,
      failed: result.data.failed,
      detail:
        `${number(result.data.filled)} filled, ${number(result.data.untouched)} unchanged` +
        (result.data.notFound > 0 ? `, ${number(result.data.notFound)} not found` : '')
    })
    mark(platform, {
      state: 'done',
      checked:
        result.data.filled + result.data.untouched + result.data.notFound + result.data.failed,
      changed: result.data.filled,
      // "Nothing to write" and "nobody had it" are both rows this pass reached
      // and left as they were — which is what an operator means by skipped.
      skipped: result.data.untouched + result.data.notFound,
      note: null
    })
    rows.push({
      ref: platform,
      ticketId: null,
      note:
        `${number(result.data.filled)} filled, ${number(result.data.untouched)} unchanged` +
        (result.data.notFound > 0 ? `, ${number(result.data.notFound)} not found` : '') +
        (result.data.failed > 0 ? `, ${number(result.data.failed)} failed` : '')
    })
  }

  // Cleared so no chip is left looking like it is still working after the
  // pass has moved on or ended.
  announce(false)

  return {
    // Per platform, which is what was asked for: "412 filled" across five
    // marketplaces does not tell anybody which one stopped answering.
    detail:
      counts.length === 0
        ? stoppedEarly
          ? 'Stopped before any marketplace was asked'
          : 'No claims were waiting'
        : [
            counts.map(count => `${count.platform} ${number(count.filled)}`).join(' · '),
            // Said in the job row, so a short night is not read as a quiet one.
            stoppedEarly ? 'stopped early' : ''
          ]
            .filter(Boolean)
            .join(' · '),
    total: attempted,
    succeeded: filled,
    failed,
    summary: [
      { label: 'Claims looked at', value: number(attempted) },
      { label: 'Records refilled', value: number(filled) },
      // Said plainly: a night that looked at forty rows out of three hundred is
      // not a night that went wrong, and without this it reads like one.
      { label: 'Past their refill limit', value: number(capped) },
      // Named rather than folded into "failed": these rows were never asked
      // about, and the fix is a re-capture, not a retry.
      { label: 'Waiting on a login', value: number(unauthenticated) },
      { label: 'Platforms', value: number(byPlatform.size) }
    ],
    rows,
    platforms: perPlatform.list()
  }
}

/* -------------------------------------------------------------------------- *
 * 4. The claims
 * -------------------------------------------------------------------------- */

/**
 * Files the Pending claims that are ready to file, on every platform —
 * `fileableClaims`. Failed to Proceed is left to the operator.
 *
 * THE GATE IS `selectionBlockReason`, the same rule that decides whether the
 * Claims page will even let an operator tick a row — a claim already being
 * filed, one past the retry cap, one with no account, no POB ID or no sub-order
 * number. Reusing it rather than writing a second list of conditions here is the
 * whole reason that rule lives in `shared/`: an unattended run is exactly where
 * a divergence would be most expensive, because filing a claim twice raises a
 * second ticket for the same return and that is the one action nobody can undo.
 *
 * It also explains the order. Refill Data runs an hour earlier because it
 * repairs the very fields this gate refuses on, so a row blocked at 03:00 for a
 * missing POB ID is usually fileable by 04:00.
 */
const fileReadyClaims = async (
  taskId: ScheduledTaskId,
  shouldStop: () => boolean
): Promise<TaskOutcome> => {
  const split = splitFileable(await fileableClaims())
  const ready = split.ready
  const blocked: JobSucceededRow[] = split.blocked.map(({ row, reason }) => ({
    ref: row.returnAwb || row.id,
    ticketId: null,
    note: reason
  }))

  if (ready.length === 0) {
    return {
      detail:
        blocked.length > 0
          ? `Nothing ready — ${number(blocked.length)} claim(s) not fileable yet`
          : 'No claims were waiting',
      total: 0,
      succeeded: 0,
      failed: 0,
      summary: [
        { label: 'Claims processed', value: '0' },
        { label: 'Waiting, not yet fileable', value: number(blocked.length) }
      ],
      // Capped: the point is to show WHY nothing ran, and twenty rows says that
      // as well as two thousand.
      rows: blocked.slice(0, 20)
    }
  }

  const result = await processClaims(
    ready.map(row => ({
      cmsId: row.id,
      platform: row.platform,
      awbNumber: row.returnAwb,
      username: row.username
    })),
    // AN EXPIRED SESSION SKIPS ITS OWN CLAIMS AND NOTHING ELSE.
    //
    // The operator's Create Ticket refuses the whole batch and offers to
    // re-capture, which is right when somebody is at the machine. At 04:00 it
    // is not: nobody answers a one-time code, so the run refused everything
    // over one stale login — a night's work lost to an account that might not
    // even own most of the claims. The claims of a dead account are passed
    // over instead, with SKIPPED_SESSION_EXPIRED on the row and no attempt
    // charged, and every other account is filed as usual.
    {
      onDeadSession: 'skip',
      // The row the operator pressed Skip on: this task's, not the other one
      // that files through the same batch.
      skipTaskId: taskId,
      // The master switch. Between claims, so the one in flight finishes —
      // abandoning it half-filed is how a claim ends up on the marketplace
      // with no ticket recorded here.
      shouldStop
    }
  )

  if (!result.success) throw new Error(result.error.message)

  // `done` from processClaims is the number that SUCCEEDED, not the number
  // attempted — the progress tick it publishes says so (`succeeded: done`).
  // Read as "processed" it would report every failure twice.
  const { done: succeeded, ticketless, failed, failures, skipped, platforms } = result.data
  const passedOver = skipped.reduce((total, account) => total + account.claims, 0)

  return {
    detail:
      `${number(succeeded)} successful` +
      // NAMED ON THE HEADLINE, because "filed" used to include these and the
      // number could not be reconciled with the claim list: a run reported 46
      // filed over a list holding 6 tickets. A claim with no ticket id wrote
      // nothing back to TrackVid, so it is the one an operator has to go and
      // look up at the marketplace.
      (ticketless > 0 ? `, ${number(ticketless)} successful with no ticket id` : '') +
      (failed > 0 ? `, ${number(failed)} failed` : '') +
      // Named on the headline, not buried in the rows: a night that filed
      // nothing because every session had expired reads as a night with no
      // work in it unless this says otherwise.
      (passedOver > 0 ? `, ${number(passedOver)} skipped — no login` : '') +
      (blocked.length > 0 ? `, ${number(blocked.length)} not yet fileable` : ''),
    total: ready.length,
    succeeded,
    failed,
    summary: [
      { label: 'Claims processed', value: number(succeeded + ticketless + failed) },
      { label: 'Filed', value: number(succeeded) },
      // Its own row rather than a footnote: these may exist at the marketplace
      // with nothing recorded here, and that is the one an operator must check
      // by hand before anything retries them.
      ...(ticketless > 0
        ? [{ label: 'Filed with no ticket id', value: number(ticketless) }]
        : []),
      { label: 'Failed', value: number(failed) },
      { label: 'Skipped — no login', value: number(passedOver) },
      { label: 'Waiting, not yet fileable', value: number(blocked.length) }
    ],
    rows: [
      ...failures.map(message => ({ ref: 'Failed', ticketId: null, note: message })),
      // The accounts, before the blocked rows: this is the one thing on the
      // list somebody can fix in a minute, by re-capturing a session.
      ...skipped.map(account => ({
        ref: `${account.platform} (${account.username})`,
        ticketId: null,
        note:
          `${number(account.claims)} claim(s) skipped — ${account.detail}. ` +
          'No attempt was charged; re-capture the login and they will file on the next run.'
      })),
      ...blocked.slice(0, 20)
    ],
    // Per marketplace, from the batch's own tally: what each was given, what it
    // filed, what failed and what was passed over for a dead login.
    platforms: platforms.map(entry => ({
      platform: entry.platform.toLowerCase(),
      total: entry.total + entry.skipped,
      succeeded: entry.succeeded + entry.ticketless,
      failed: entry.failed,
      detail:
        [
          entry.ticketless > 0 ? `${number(entry.ticketless)} with no ticket id` : '',
          entry.skipped > 0 ? `${number(entry.skipped)} skipped — no login` : ''
        ]
          .filter(Boolean)
          .join(', ') || null
    }))
  }
}

const claimPending: TaskRunner = (shouldStop = () => false) =>
  fileReadyClaims('auto-claim', shouldStop)

/**
 * Proceed eligible claims — the same filing, at the FRONT of the sequence.
 *
 * "Eligible" is exactly the gate above: `selectionBlockReason`, via
 * `splitFileable`. A claim with its account, POB ID and sub-order number is
 * filed; one missing any of them is listed as waiting and left for Refill Data
 * to repair and Auto claim to pick up. Not a second list of conditions — a
 * second one would be the one that drifts, and drifting here files twice.
 *
 * It runs BEFORE the Login update, on the sessions that are live now. A claim
 * whose login has expired is passed over with no attempt charged (the same
 * `onDeadSession: 'skip'`), and is filed by Auto claim once the Login update
 * has re-captured it.
 */
const claimEligible: TaskRunner = (shouldStop = () => false) =>
  fileReadyClaims('eligible-claims', shouldStop)

/** One pass, on its own. The two scheduled tasks below are each one of these. */
export const runRefillPhase = (
  phase: RefillPhase,
  shouldStop: () => boolean = () => false
): Promise<TaskOutcome> => refillPass(phase, shouldStop)

/**
 * The two passes are two TASKS, each with its own schedule and Run now.
 *
 * They used to be one task on one time, blanks then status. But they ask
 * different questions of different rows, and an operator usually wants only
 * the second — "has that ticket moved yet?" — without re-sweeping every
 * Pending row's AWB to find out. Separate tasks also mean a marketplace that
 * refuses status lookups no longer fails, and blocks, the blanks work.
 */
const refillBlanks: TaskRunner = shouldStop => refillPass('blanks', shouldStop)

const refreshClaimStatus: TaskRunner = shouldStop => refillPass('status', shouldStop)

/* -------------------------------------------------------------------------- *
 * 4. The Flipkart report sync
 * -------------------------------------------------------------------------- */

/**
 * Collects the Flipkart Orders and Returns reports that have finished building,
 * then asks for the days since each was last stored.
 *
 * Snapdeal's shape: a pass that only requests is the system working — Flipkart
 * builds a report over about half an hour and the next pass collects it. "Still
 * building" is its own number for that reason.
 */
const syncFlipkartReports: TaskRunner = async (shouldStop = () => false) => {
  const results = await runDailyFlipkartBackup(shouldStop)

  // No Flipkart login is nothing to do, not a failure.
  if (results.length === 0) {
    return {
      detail: 'No Flipkart account — nothing to sync',
      total: 0,
      succeeded: 0,
      failed: 0,
      summary: [{ label: 'Flipkart accounts', value: '0' }],
      rows: []
    }
  }

  const total = (pick: (result: (typeof results)[number]) => number): number =>
    results.reduce((sum, result) => sum + pick(result), 0)
  const sent = total(result => result.sent)
  const skipped = total(result => result.skipped)
  const stored = total(result => result.stored)
  const added = total(result => result.added)
  const pending = total(result => result.pending)
  // An account that could not run at all (no session, a refused list call) is
  // a failure of its own, beside the windows that failed.
  const failed = total(result => result.failed + (result.error ? 1 : 0))

  return {
    detail:
      [
        `${number(stored)} collected`,
        `${number(added)} row(s) saved`,
        sent > 0 ? `${number(sent)} requested` : '',
        pending > 0 ? `${number(pending)} still building` : ''
      ]
        .filter(Boolean)
        .join(' · '),
    total: sent + stored + pending,
    succeeded: stored,
    failed,
    summary: [
      { label: 'Reports collected', value: number(stored) },
      { label: 'Records saved', value: number(added) },
      { label: 'Windows requested', value: number(sent) },
      { label: 'Windows already covered', value: number(skipped) },
      { label: 'Still building at Flipkart', value: number(pending) },
      ...(failed > 0 ? [{ label: 'Failed', value: number(failed) }] : [])
    ],
    rows: results.map(result => ({
      ref: `Orders + Returns — ${result.username}`,
      ticketId: null,
      note:
        `${number(result.stored)} report(s) collected, ${number(result.added)} row(s) saved` +
        (result.sent > 0 ? `, ${number(result.sent)} window(s) requested` : '') +
        (result.pending > 0 ? `, ${number(result.pending)} still building` : '') +
        (result.error ? ` — ${result.error}` : '')
    }))
  }
}

/**
 * The registry. One entry per task, and the union makes it exhaustive: a new
 * `ScheduledTaskId` will not compile until it has a runner here.
 */
export const TASK_RUNNERS: Record<ScheduledTaskId, TaskRunner> = {
  'eligible-claims': claimEligible,
  'session-refresh': refreshSessions,
  'ajio-master-data': syncAjioReports,
  'snapdeal-master-data': syncSnapdealReports,
  'flipkart-master-data': syncFlipkartReports,
  'refill-data': refillBlanks,
  'auto-claim': claimPending,
  'status-change': refreshClaimStatus
}

export const taskRunner = (id: ScheduledTaskId): TaskRunner => TASK_RUNNERS[id]

/** Every task this build can run, in the order they run. */
export const runnableTasks = (): readonly ScheduledTaskId[] => SCHEDULED_TASK_IDS
