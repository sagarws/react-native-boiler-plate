import type { PlatformCredentials } from '../types/platformSession'
import { healthOf } from './sessionHealth'
import type { SessionHealth } from '../types/platformSession'
import { platformKey } from './platformKey'

/**
 * Which credentials the Session update will work on.
 *
 * ONE RULE, IN ONE PLACE, and that is the point of this file. The nightly task
 * had its own copy and the banner had another, and they disagreed: the banner
 * flagged a never-captured session, the task skipped it, and the operator got
 * "Every session was still good" under a red banner naming the account it had
 * just declined to touch. The Settings card that lists the work needs the same
 * answer as the job that does it, so there is now nowhere for a third copy to
 * live.
 *
 * `expiring` is included — a session that dies in an hour still works now, and
 * renewing it before the claim run is the whole point of running at 02:00 —
 * which is why this is not simply the banner's rule re-used.
 */

export interface SessionTarget {
  /** Canonical key, for `captureSession`. */
  platform: string
  /** As the marketplace is written on screen. */
  label: string
  username: string
  credentialId: string
  state: SessionHealth
  /**
   * Whether this can be signed in with nobody present.
   *
   * Straight from the health row, which already accounts for the company's
   * switch, this machine's flag, and whether this build can script the
   * platform's login at all. False means the job reports it rather than
   * holding a browser window open for somebody who is asleep.
   */
  unattended: boolean
  /**
   * WHICH of the three reasons, when it cannot.
   *
   * The bare boolean above was not enough, and the gap showed: a scheduled run
   * skipped Myntra and Tata CliQ, reported both as "need a person", and told
   * the operator to turn on auto-login in Monitor. That was right for Myntra,
   * whose switch was off, and wrong for Tata CliQ, whose switch was already on
   * — this build simply has no scripted sign-in for it. Two different problems,
   * one message, and it fitted the one nobody needed to be told about.
   */
  blockedBy?: 'company' | 'machine' | 'no-script'
}

/**
 * Why an account cannot be signed in with nobody present — in the operator's
 * terms, and in ONE place.
 *
 * Read by the Sessions page badge, the scheduled run's log line, and the job
 * row it writes. It lived only in the Sessions page, so the job carried a
 * vaguer copy that named the wrong fix for one of the three cases.
 */
export const MANUAL_REASON: Record<'company' | 'machine' | 'no-script', string> = {
  company:
    'Automatic sign-in is off for this platform. Turn it on with the Sign-in switch on the Login ' +
    'page (or in Trackvid-Monitor) and the nightly Login update will do this account without ' +
    'anybody present.',
  machine: 'Automatic sign-in is turned off on this installation.',
  'no-script':
    'This build has no scripted sign-in for this platform — its login needs a one-time code that ' +
    'only the automation server can read. Re-capture it here, or renew it from Monitor.'
}

/**
 * Platforms whose Sign-in switch the Login page shows but will not let an
 * operator flip — the setting is changed in Trackvid-Monitor only. Keyed by
 * platform key; adding one is one entry here.
 */
export const SIGN_IN_SWITCH_LOCKED: ReadonlySet<string> = new Set(['myntra'])

/** The sentence for a target that needs a person. */
export const manualReason = (target: Pick<SessionTarget, 'blockedBy'>): string =>
  MANUAL_REASON[target.blockedBy ?? 'company']

/**
 * The states that mean a session cannot be relied on for tonight's run.
 *
 * `rejected` is the one that was missing, and its absence is what let the card
 * report "nothing to update" on the same evening Auto claim passed a
 * marketplace over for having no usable session. The claim asked the
 * marketplace; this list only knew about dates.
 */
const NEEDS_WORK: readonly SessionHealth[] = ['expired', 'expiring', 'rejected', 'none']

export const needsSessionUpdate = (state: SessionHealth): boolean => NEEDS_WORK.includes(state)

/**
 * @param health   every platform bucket, as `sessionHealth` returns it
 * @param isKnown  does this app keep sessions for the platform at all? The
 *   main process asks the core's registry; the renderer asks the platform list
 *   it already holds. Passed in rather than imported, because `shared` cannot
 *   load the core and must not carry a second list of platform names.
 */
export const sessionUpdateTargets = (
  health: readonly PlatformCredentials[],
  isKnown: (platformKey: string) => boolean
): SessionTarget[] =>
  health
    // A platform with no login this app can capture has no business in the
    // job's queue: the credentials endpoint returns a bucket for every
    // platform the company has configured, Amazon and "Other" included.
    .filter(entry => isKnown(platformKey(entry.platform)))
    /*
     * THE COMPANY SAID NO AUTOMATIC SIGN-IN for this platform
     * (`settings.isAutoLoginOnActiveSession[platform] === false`, set in
     * Trackvid-Monitor). Its logins are left to a person: the Login update does
     * not touch them, the card does not list them as work, and — because the
     * schedule's "logins outstanding" gate reads this same rule — they do not
     * hold the other tasks back waiting for a re-capture that will never run.
     * The Login page still shows each one's real state.
     *
     * Only the COMPANY switch. `machine` and `no-script` stay in, reported as
     * needing a person, because those are this installation's limits rather
     * than the company's decision.
     */
    .filter(entry => entry.autoLoginBlockedBy !== 'company')
    .flatMap(entry =>
      entry.credentials
        .filter(credential => credential.visible !== false)
        // The marketplace refused this password (`is_verified: false`). Signing
        // in again only repeats the refusal — it waits for the password to be
        // fixed, and must not hold the schedule's outstanding-logins gate.
        .filter(credential => credential.refused !== true)
        .filter(credential => needsSessionUpdate(healthOf(credential.session)))
        .map(credential => ({
          platform: platformKey(entry.platform),
          label: entry.platform,
          username: credential.username,
          credentialId: credential.credentialId,
          state: healthOf(credential.session),
          unattended: entry.autoLogin,
          ...(entry.autoLoginBlockedBy ? { blockedBy: entry.autoLoginBlockedBy } : {})
        }))
    )
