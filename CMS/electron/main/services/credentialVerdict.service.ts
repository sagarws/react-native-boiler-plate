import { applyVerdictLocally } from './company.service'
import { loadCore } from '@main/automations/common/coreLoader'
import { apiRequest } from './httpClient'
import { getAccessToken, getSession } from './session.store'
import { broadcast } from '../ipc/broadcast'
import { PLATFORM_SESSION_EVENTS } from '@shared/constants/channels'
import { logger } from './logger'
import { ok, type Result } from '@shared/types/result'

/**
 * Record what a sign-in concluded about the CREDENTIAL, not the session.
 *
 * WHY THIS EXISTS. The Login update signed in to three Snapdeal accounts, was
 * told `Invalid Username or Password` by the portal each time, and the Login
 * page went on showing all three as **Verified** — because nothing on the
 * capture path ever wrote the flag. So every automation kept using passwords
 * the marketplace had already refused, and the one screen that could have said
 * so showed the opposite.
 *
 * ONE SEAM, EVERY PLATFORM. `loginLocally` is what each platform's scripted
 * sign-in runs through, so a verdict written there covers all of them —
 * including the ones added later, which is the half that a per-platform fix
 * always loses.
 *
 * ONLY A CREDENTIAL VERDICT, never a session one. A timeout, a captcha, a
 * portal 5xx and an OTP challenge all say nothing about whether the password is
 * right, and marking an account unverified on one of those would take a working
 * login out of every automation until somebody noticed. The error has to be the
 * marketplace actually rejecting it.
 */

/**
 * Did the marketplace say the credential itself is wrong?
 *
 * `INVALID_CREDENTIALS:` is the prefix every platform's login throws with, and
 * the same string their own `loginErrors.js` classifiers key on — so this is
 * that shared vocabulary rather than a second opinion about it. The phrasings
 * below are for the paths that report the portal's words without the prefix.
 */
/**
 * The platform's OWN verdict on its own wording, where it has one.
 *
 * ASKED OF THE CORE, not re-decided here. AJIO has spent months accumulating
 * what its SSO says — "Your account is locked. Please reset your password",
 * `PASSWORD_RESET_REQUIRED`, "The password you entered is incorrect" — in
 * `platforms/ajio/common/loginErrors.js`, with a comment explaining why each
 * pattern is anchored the way it is. Myntra has its own. Keeping a second
 * opinion in this file would mean every new phrasing has to be learned twice,
 * and the copy that was forgotten is the one that quietly stops working.
 *
 * Loaded per platform and per call: a missing module is simply a platform that
 * has not written one yet, and the generic rule below still applies.
 */
const CLASSIFIERS: Record<string, { module: string; fn: string }> = {
  ajio: { module: 'platforms/ajio/common/loginErrors', fn: 'isBadCredentials' },
  myntra: { module: 'platforms/myntra/common/loginErrors', fn: 'isCredentialErrorBanner' },
  snapdeal: { module: 'platforms/snapdeal/common/loginErrors', fn: 'isInvalidCredentialsError' }
}

const platformSaysSo = (platform: string, message: string): boolean => {
  const entry = CLASSIFIERS[platform]

  if (!entry) return false

  try {
    // A literal specifier per platform, never a computed one: the main process
    // is bundled and a bundler cannot follow `require(variable)`.
    const core = loadCore<Record<string, (value: unknown) => boolean>>(entry.module)
    const classify = core[entry.fn]

    // Snapdeal's takes an Error, the other two take the text. Both are handed
    // something they can read.
    return typeof classify === 'function'
      ? classify(message) === true || classify(new Error(message)) === true
      : false
  } catch {
    return false
  }
}

export const isCredentialRefusal = (
  message: string,
  code?: string,
  platform?: string
): boolean =>
  code === 'INVALID_CREDENTIALS' ||
  message.includes('INVALID_CREDENTIALS') ||
  (platform !== undefined && platformSaysSo(platform, message)) ||
  // The generic floor, for the platforms with no classifier of their own.
  /invalid\s+(user\s?name|username|email|login|credential)/i.test(message) ||
  /(incorrect|wrong|invalid)\s+(password|user\s?name|username|credential)/i.test(message) ||
  /password\s+(is\s+)?(incorrect|wrong|invalid)/i.test(message)

/**
 * Write `is_verified` for one login.
 *
 * BEST EFFORT, ALWAYS. This runs in the middle of a sign-in that has already
 * failed; a backend that cannot be reached must not turn a reported failure
 * into a thrown one. The next run asks again.
 */
/**
 * A refusal, written through the endpoint that exists for it.
 *
 * `/cms/credential-update` answered 404 for a long time — it was only added to
 * the backend later, for setting a login back to verified and for the Verify
 * dialog — so every refused password was logged as "could not record it" and the login
 * stayed Verified, to be tried and refused again on the next run (Delhivery
 * locked an account after five of those). `/master-setting/mark-credentials-
 * unverified` is the one the automation server and this app's own claim path
 * already use. Its answer is reshaped to `updated`, which the caller reads to
 * tell "flagged" from "matched nothing".
 */
const markUnverified = async (
  platform: string,
  username: string,
  token: string
): Promise<Result<{ updated: number }>> => {
  const session = getSession()
  const response = await apiRequest<{ updatedCount?: number }>(
    '/master-setting/mark-credentials-unverified',
    {
      method: 'POST',
      token,
      body: {
        items: [
          {
            ...(session ? { companyId: session.user.companyId, trackVidEmail: session.user.email } : {}),
            platform,
            username
          }
        ]
      }
    }
  )

  return response.success ? ok({ updated: response.data?.updatedCount ?? 0 }) : response
}

/**
 * Resolves `true` when the backend accepted the write — callers that report the
 * verdict to an operator need to know; the sign-in seam ignores it.
 */
export const recordCredentialVerdict = async (
  platform: string,
  username: string,
  isVerified: boolean
): Promise<boolean> => {
  const token = getAccessToken()

  if (!token) return false

  try {
    const response = isVerified
      ? await apiRequest<{ matched?: number; updated?: number }>('/cms/credential-update', {
          method: 'POST',
          token,
          body: { platform, username, isVerified }
        })
      : await markUnverified(platform, username, token)

    if (!response.success) {
      logger.warn(
        `[credential-verdict] ${platform}/${username}: could not record it — ${response.error.message}`
      )

      return false
    }

    /*
     * "ACCEPTED" IS NOT "CHANGED".
     *
     * The write is matched by the stored username, exactly — and a stored
     * `CKRITIKALA@GMAIL.COM` against a login reported as `ckritikala@gmail.com`
     * finds nothing while answering 200. Without this the log said "marked
     * unverified", the screen went on saying Verified, and the two could not
     * both be checked from one place.
     */
    if (response.data?.updated === 0) {
      logger.warn(
        `[credential-verdict] ${platform}/${username}: the backend changed nothing — ` +
          'the stored username probably differs from the one signed in with'
      )

      // Accepted, and possibly already in that state — not a failure to report.
      return true
    }

    logger.info(
      isVerified
        ? `[credential-verdict] ${platform}/${username}: the marketplace accepted it — marked verified`
        : `[credential-verdict] ${platform}/${username}: the marketplace refused the password — ` +
            'marked unverified, and the automations will now skip it'
    )

    /*
     * TELL THE SCREENS, or the fix is invisible.
     *
     * This runs inside a sign-in that has already failed, and a failed capture
     * announces nothing — so the Login page kept the list it read on mount and
     * showed three accounts as Verified that the database had just marked
     * otherwise. Every screen re-reads on this event.
     */
    /*
     * AND THE LOCAL COPY, which is what the automations actually read.
     *
     * `company()` is local-first by design — "the record automations run from,
     * patched on every write this app makes, refreshed on Sync". A verdict
     * written only to the backend leaves every automation on this machine using
     * the refused password until the next Sync, hours away, while the server
     * and the screen both say it is refused.
     */
    const patched = await applyVerdictLocally(platform, username, isVerified)

    if (!patched) {
      logger.warn(
        `[credential-verdict] ${platform}/${username}: the backend has it, but this machine's ` +
          'company copy could not be patched — automations here follow on the next Sync'
      )
    }

    broadcast(PLATFORM_SESSION_EVENTS.changed, { platform, username })

    return true
  } catch (error) {
    logger.warn(`[credential-verdict] ${platform}/${username}: could not record it`, error)

    return false
  }
}
