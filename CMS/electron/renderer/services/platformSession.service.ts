import { PLATFORM_SESSION_CHANNELS } from '@shared/constants/channels'
import type {
  CaptureSessionInput,
  CaptureSessionResult,
  PeekedOtp,
  PlatformCredentials,
  PlatformDescriptor
} from '@shared/types/platformSession'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'
import { notifySessionsChanged } from './sessionEvents'

/** Renderer-side wrapper over the platform-session IPC channels. */

export const listPlatforms = (): Promise<Result<PlatformDescriptor[]>> =>
  invoke<PlatformDescriptor[]>(PLATFORM_SESSION_CHANNELS.list)

/**
 * Resolves only once the operator closes the sign-in window, which can be
 * minutes. Callers must keep the row in a pending state for the whole wait
 * rather than assuming a quick round trip.
 */
export const captureSession = (input: CaptureSessionInput): Promise<Result<CaptureSessionResult>> =>
  invoke<CaptureSessionResult>(PLATFORM_SESSION_CHANNELS.capture, input)

export const cancelCapture = (platform: string): Promise<Result<{ cancelled: boolean }>> =>
  invoke<{ cancelled: boolean }>(PLATFORM_SESSION_CHANNELS.cancel, { platform })

/** Every platform's credentials with their session summary — what the stale-session banner reads. */
/**
 * Correct a marketplace login and prove it by signing in with it.
 *
 * Resolves false-y only by FAILING: the error carries the marketplace's own
 * refusal, which is the one thing that tells an operator what to change.
 */
export const verifyCredential = (input: {
  platform: string
  username: string
  newUsername: string
  password: string
}): Promise<Result<boolean>> =>
  invoke<boolean>(PLATFORM_SESSION_CHANNELS.verifyCredential, input)

/**
 * Adds a marketplace login, then signs in with it to verify it. Resolves with
 * `verified: false` and the reason when the login was saved but did not sign in.
 */
export const addCredential = (input: {
  platform: string
  username: string
  password: string
  accountType?: string
  phoneNumber?: string
  vendorCode?: string
  cloudflareEmail?: string
}): Promise<Result<{ platform: string; username: string; verified: boolean; reason: string | null }>> =>
  invoke(PLATFORM_SESSION_CHANNELS.addCredential, input)

/** Removes one marketplace login from the company, with its saved session. */
export const removeCredential = (input: {
  platform: string
  username: string
}): Promise<Result<{ platform: string; username: string }>> =>
  invoke(PLATFORM_SESSION_CHANNELS.removeCredential, input)

export const sessionHealth = (): Promise<Result<PlatformCredentials[]>> =>
  invoke<PlatformCredentials[]>(PLATFORM_SESSION_CHANNELS.health)

/**
 * Removes one credential's saved session.
 *
 * The account and its password are untouched — this drops the SESSION, so the
 * next automation signs in again rather than replaying a jar the marketplace
 * has stopped honouring.
 */
export const clearPlatformSession = (
  platform: string,
  username: string
): Promise<Result<{ platform: string }>> =>
  invoke<{ platform: string }>(PLATFORM_SESSION_CHANNELS.clear, { platform, username })

/** The same for every credential on every platform. Its own channel; see the constant. */
export const clearAllPlatformSessions = (): Promise<Result<{ cleared: boolean }>> =>
  invoke<{ cleared: boolean }>(PLATFORM_SESSION_CHANNELS.clearAll)

export interface RecaptureTarget {
  platform: string
  username: string
  credentialId: string
}

/**
 * Re-captures sessions one after another — shared by the stale-session banner
 * and Create Ticket's session check.
 *
 * Sequential, not parallel: every sign-in drives a real browser, several at once
 * would fight for the screen (and on Myntra, for the mouse), and one at a time
 * keeps a failure attributable to the account it came from.
 *
 * Announces a change after EVERY capture, success or not, so whatever shows
 * session health re-reads as it goes instead of only at the end of a long batch.
 *
 * `unattended` asks for the scripted sign-in only — an account that cannot sign
 * itself in fails at once, naming itself, instead of opening a window. Checked
 * between accounts, `shouldStop` ends the batch after the one in flight.
 */
export const recaptureSessions = async <T extends RecaptureTarget>(
  targets: readonly T[],
  {
    onStart,
    onResult,
    unattended,
    shouldStop
  }: {
    onStart?: (target: T) => void
    onResult?: (target: T, result: Result<CaptureSessionResult>) => void
    unattended?: boolean
    shouldStop?: () => boolean
  } = {}
): Promise<{ failed: number }> => {
  let failed = 0

  for (const target of targets) {
    if (shouldStop?.()) break

    onStart?.(target)

    const response = await captureSession({
      platform: target.platform,
      username: target.username,
      credentialId: target.credentialId,
      ...(unattended ? { unattended: true } : {})
    })

    if (!response.success) failed += 1
    onResult?.(target, response)
    notifySessionsChanged()
  }

  return { failed }
}

/**
 * Records whether one credential's sign-in costs a one-time code.
 *
 * Snapdeal and Flipkart only — see the main-process service for why those two.
 */
export const setCredentialOtpMode = (input: {
  platform: string
  credentialId: string
  isOtpBased: boolean
}): Promise<Result<{ isOtpBased: boolean }>> =>
  invoke<{ isOtpBased: boolean }>(PLATFORM_SESSION_CHANNELS.otpMode, input)

/** The newest one-time code in the mailbox for one account, and when it arrived. */
export const peekOtp = (input: { platform: string; username: string }): Promise<Result<PeekedOtp>> =>
  invoke<PeekedOtp>(PLATFORM_SESSION_CHANNELS.peekOtp, input)

/**
 * One login's stored password, for the Login page. Refused unless Visible Login
 * info is on.
 */
export const revealPassword = (input: {
  platform: string
  username: string
}): Promise<Result<{ password: string }>> =>
  invoke<{ password: string }>(PLATFORM_SESSION_CHANNELS.revealPassword, input)

/** Turn automatic sign-in on or off for one platform of this company. */
export const setAutoLogin = async (input: {
  platform: string
  enabled: boolean
}): Promise<Result<{ platform: string; enabled: boolean }>> => {
  const response = await invoke<{ platform: string; enabled: boolean }>(PLATFORM_SESSION_CHANNELS.autoLogin, input)

  // Every row of that platform, and the banner's "needs a person" count, read
  // the flag — so the page reloads rather than patching one cell.
  if (response.success) notifySessionsChanged()

  return response
}
