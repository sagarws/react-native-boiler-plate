import { PLATFORMS } from '@trackvid/automation-core/common/platforms'
import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { captureSession } from './platformSession.service'
import { credentialsFor, refreshCompany } from './company.service'
import { recordCredentialVerdict } from './credentialVerdict.service'
import { broadcast } from '../ipc/broadcast'
import { PLATFORM_SESSION_EVENTS } from '@shared/constants/channels'
import { logger } from './logger'

export interface SignInVerdict {
  /** The sign-in worked and the login is marked verified. */
  verified: boolean
  /** Why it is not verified, in the marketplace's words — null when it is. */
  reason: string | null
}

/**
 * Prove a login by capturing its session EXACTLY AS RE-CAPTURE DOES, then write
 * what that concluded — verified on success, unverified on failure.
 *
 * SAME CALL AS THE BUTTON. Re-capture sends `credentialId` with the username,
 * and the server renewal (`/cms/renew-session`) keys on nothing else — without
 * it, Add and Verify failed with "This credential has no id" on every machine
 * that renews through the backend. The route itself (backend renew, scripted
 * sign-in here, or a window for the operator) is `captureSession`'s decision
 * from `isAutoLoginOnActiveSession`, so it is never re-decided here.
 *
 * Refreshed first: the login was just written to the backend, and both the id
 * and the password are read from the company copy.
 */
export const signInAndRecord = async (platform: string, username: string): Promise<SignInVerdict> => {
  await refreshCompany().catch(error => logger.warn('[verify] could not refresh the company copy', error))

  const wanted = username.trim().toLowerCase()
  const credentialId =
    (await credentialsFor(platform, { includeRefused: true })).find(
      entry => entry.username.trim().toLowerCase() === wanted
    )?.credentialId ?? ''

  const captured = await captureSession({ platform, username, ...(credentialId ? { credentialId } : {}) })

  if (!captured.success) {
    logger.warn(`[verify] ${platform}/${username}: sign-in failed — ${captured.error.message}`)
    await recordCredentialVerdict(platform, username, false)

    return { verified: false, reason: captured.error.message }
  }

  if (!(await recordCredentialVerdict(platform, username, true))) {
    return { verified: false, reason: 'Signed in, but it could not be marked verified. Try Verify again.' }
  }

  return { verified: true, reason: null }
}

/**
 * Correct a marketplace login, then prove it by signing in with it.
 *
 * THE WAY BACK FROM `is_verified: false`. A marketplace that rejects a password
 * — Snapdeal's "Invalid Username or Password", and the equivalents elsewhere —
 * sets that flag, and every automation then leaves the account alone. That is
 * right, and it is a dead end: nothing in the app could ever set it back.
 *
 * THE ORDER MATTERS, and this is the whole design.
 *
 *   1. write the new credentials, UNVERIFIED
 *   2. sign in with them, for real
 *   3. write what that concluded
 *
 * Step 1 cannot be skipped: the sign-in fetches the password from the backend,
 * so the new one has to be stored before it can be tried. Step 1 must write
 * `false`, not `true`: if the app dies between 1 and 3, the account is left
 * exactly as it was found — out of the automations — rather than let back in on
 * the strength of a password nobody has tested. The optimistic order fails the
 * wrong way.
 *
 * NOTHING IS LOST BY OVERWRITING. The account is already refused, so the stored
 * password is already known not to work.
 */
export const verifyCredential = async (payload: unknown): Promise<Result<boolean>> => {
  const { platform, username, newUsername, password } = (payload ?? {}) as {
    platform?: unknown
    username?: unknown
    newUsername?: unknown
    password?: unknown
  }

  if (typeof platform !== 'string' || !PLATFORMS.some(entry => entry.key === platform)) {
    return fail('VALIDATION_ERROR', 'Say which marketplace this login is for.')
  }

  if (typeof username !== 'string' || username.trim() === '') {
    return fail('VALIDATION_ERROR', 'Say which login to verify.')
  }

  const wanted = typeof newUsername === 'string' && newUsername.trim() !== ''
    ? newUsername.trim()
    : username.trim()
  const secret = typeof password === 'string' ? password : ''
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to TrackVid first.')

  const write = async (isVerified: boolean, withSecret: boolean): Promise<Result<true>> => {
    const response = await apiRequest('/cms/credential-update', {
      method: 'POST',
      token,
      body: {
        platform,
        // The OLD username finds the row; the new one may be part of the change.
        username: username.trim(),
        ...(wanted !== username.trim() ? { newUsername: wanted } : {}),
        ...(withSecret && secret ? { password: secret } : {}),
        isVerified
      }
    })

    return response.success ? ok(true) : fail('INTERNAL_ERROR', response.error.message)
  }

  /*
   * 1 — stored, still refused. ONLY WHEN SOMETHING CHANGED.
   *
   * Verify's first press sends no password: the login is tried AS SAVED in the
   * company settings, which is what the sign-in reads anyway. There is nothing
   * to write, and the account is already marked refused. A password is asked
   * for only after the marketplace has turned the saved one down.
   */
  const correcting = secret !== '' || wanted !== username.trim()

  if (correcting) {
    const stored = await write(false, true)

    if (!stored.success) return stored

    logger.info(`[verify] ${platform}/${wanted}: credentials updated — signing in to check them`)
  } else {
    logger.info(`[verify] ${platform}/${wanted}: signing in with the saved login to check it`)
  }

  // 2 + 3 — signed in the way Re-capture signs in, and the outcome written
  // either way. A failure is reported as a non-success so the dialog can show
  // the marketplace's own words rather than "done".
  const verdict = await signInAndRecord(platform, wanted)

  if (!verdict.verified) return fail('INTERNAL_ERROR', verdict.reason ?? 'The sign-in did not complete.')

  logger.info(`[verify] ${platform}/${wanted}: verified — back in the automations`)

  /*
   * ANNOUNCED LAST, and that is the point of announcing at all.
   *
   * The capture in step 2 already told the screens something changed — but the
   * verified flag is written AFTER it, so a list that reloaded on that notice
   * would redraw the account still marked unverified and sit there looking
   * wrong until somebody pressed Refresh.
   */
  broadcast(PLATFORM_SESSION_EVENTS.changed, { platform, username: wanted })

  return ok(true)
}
