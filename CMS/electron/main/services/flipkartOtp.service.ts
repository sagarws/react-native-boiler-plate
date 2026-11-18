import { loadCore } from '@main/automations/common/coreLoader'
import {
  canReadOtpHere,
  diagnoseOtpWait,
  OTP_POLL_SCHEDULE,
  OTP_WAIT_MS,
  otpAddressFor,
  readOtpLocally
} from './otpSource'
import { whenPlatformSkipped } from './platformSkip.store'
import { logger } from './logger'

/**
 * Fetches the Flipkart one-time code from the mailbox set up on THIS machine.
 *
 * Flipkart gates its seller-portal login behind a code emailed to the account.
 * The login for that inbox is never in a build (one inbox serves every seller);
 * it is the TrackVid OTP mailbox baked into the build, and the code is read
 * here — no TrackVid relay. With no mailbox set up this returns null at once.
 *
 * Shaped to match the core's `fetchLatestFlipkartOtp` exactly: poll until a
 * fresh code appears, return null when none does. Returning null rather than
 * throwing is what lets the login fall back to asking the operator, which is
 * the whole reason this can be attempted automatically at all.
 */

interface OtpPoller {
  /**
   * The waiting, the shape check and the quiet give-up — shared with the
   * automation server's own lookup, which polls Gmail directly. Only the fetch
   * differs, and it has to: those IMAP credentials cannot ship in this app.
   */
  pollForOtp: (
    fetchOnce: (attempt: number) => Promise<string | null>,
    options?: {
      timeoutMs?: number
      schedule?: number[]
      retryOnError?: boolean
      logger?: unknown
    }
  ) => Promise<string | null>
}

/**
 * @param username  the Flipkart account being signed in as. The server maps it
 *                  to the credential's `otpEmail` when the mail goes somewhere
 *                  else.
 * @param since     ignore anything older — the cutoff is captured before the
 *                  login click, so a stale code from a previous attempt can
 *                  never be typed into a fresh challenge.
 * @param timeoutMs how long to poll before giving up — see `OTP_WAIT_MS`.
 */
export const fetchFlipkartOtp = async (
  username: string,
  since?: Date,
  timeoutMs: number = OTP_WAIT_MS
): Promise<string | null> => {
  // Resolved ONCE, not per attempt: whether this app can read the inbox cannot
  // change halfway through a login.
  if (!canReadOtpHere()) {
    logger.info('[flipkart-otp] this build carries no OTP mailbox login — asking the operator')

    return null
  }

  const { pollForOtp } = loadCore<OtpPoller>('platforms/flipkart/common/getOtp')

  const address = await otpAddressFor('flipkart', username)

  logger.info(`[flipkart-otp] reading the mailbox on this machine as ${address}`)

  // A Skip on the Login update abandons this sign-in; the poll must not run on
  // for the rest of OTP_WAIT_MS reading a mailbox for a login nobody wants.
  const skipWatch = whenPlatformSkipped('session-refresh', 'flipkart')
  let skipped = false

  void skipWatch.promise.then(() => {
    skipped = true
  })

  let otp: string | null

  try {
    otp = await pollForOtp(
      async attempt => {
        if (skipped) throw new Error('skipped by hand')

        const code = await readOtpLocally('flipkart', address, since)

        if (!code) await diagnoseOtpWait('flipkart-otp', attempt, address, since)

        return code
      },
      // The only throw is the Skip above, which must END the wait. A mailbox
      // that refuses one read is not a throw — `readOtpLocally` reports it and
      // returns null, so the poll still tries again.
      { timeoutMs, schedule: OTP_POLL_SCHEDULE, retryOnError: false, logger }
    )
  } finally {
    skipWatch.cancel()
  }

  if (otp) {
    logger.info(`[flipkart-otp] code received for ${username}`)
  } else {
    logger.warn(
      `[flipkart-otp] no code for ${username} within ${Math.round(timeoutMs / 1000)}s — ` +
        'falling back to the operator'
    )

  }

  return otp
}
