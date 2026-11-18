import { loadCore } from '@main/automations/common/coreLoader'
import {
  canReadOtpHere,
  diagnoseOtpWait,
  OTP_POLL_SCHEDULE,
  OTP_WAIT_MS,
  otpAddressFor,
  readOtpLocally,
  TATACLIQ_CLOUDFLARE_OTP
} from './otpSource'
import { whenPlatformSkipped } from './platformSkip.store'
import { logger } from './logger'

/**
 * Fetches the Tata CliQ one-time code from the mailbox set up on THIS machine.
 *
 * Mirrors `flipkartOtp.service`, and matters more: Flipkart raises its OTP
 * sometimes, Tata CliQ raises one on EVERY login, so a machine without an OTP
 * mailbox login in its build cannot sign in to Tata CliQ unattended.
 * The code is read here — no TrackVid relay; the inbox login is entered per
 * machine and never shipped in a build.
 *
 * Shaped to match the core's `loginTataCliq` contract exactly: poll until a
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
 * Polls this machine's mailbox for one code source until a code arrives, the
 * wait runs out, or the operator presses Skip.
 *
 * Shared by the two codes a Tata CliQ sign-in can need — the portal's own OTP
 * and the Cloudflare Access code in front of it — so both wait the same way.
 */
const pollMailbox = async (
  source: string,
  address: string,
  since: Date | undefined,
  timeoutMs: number,
  label: string
): Promise<string | null> => {
  // Resolved ONCE, not per attempt: whether this app can read the inbox cannot
  // change halfway through a login.
  if (!canReadOtpHere()) {
    logger.info(`[tatacliq-otp] this build carries no OTP mailbox login — no ${label} can be read here`)

    return null
  }

  const { pollForOtp } = loadCore<OtpPoller>('platforms/tatacliq/common/getOtp')

  // Said plainly, because it has already happened: the module did not export
  // the poller, this called `undefined`, and the packaged build reported it as
  // "r is not a function" — four milliseconds into a two-minute wait, with the
  // browser sitting on the OTP box.
  if (typeof pollForOtp !== 'function') {
    throw new Error(
      "the core's Tata CliQ OTP module exposes no pollForOtp — this app and the core are out of step"
    )
  }

  logger.info(`[tatacliq-otp] reading the mailbox on this machine for the ${label} as ${address}`)

  // A Skip on the Login update abandons this sign-in; the poll must not run on
  // for the rest of OTP_WAIT_MS reading a mailbox for a login nobody wants.
  const skipWatch = whenPlatformSkipped('session-refresh', 'tatacliq')
  let skipped = false

  void skipWatch.promise.then(() => {
    skipped = true
  })

  let otp: string | null

  try {
    otp = await pollForOtp(
      async attempt => {
        if (skipped) throw new Error('skipped by hand')

        const code = await readOtpLocally(source, address, since)

        if (!code) await diagnoseOtpWait('tatacliq-otp', attempt, address, since)

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

  if (otp) logger.info(`[tatacliq-otp] ${label} received for ${address}`)
  else logger.warn(`[tatacliq-otp] no ${label} for ${address} within ${Math.round(timeoutMs / 1000)}s`)

  return otp
}

/**
 * The seller zone's own login OTP.
 *
 * @param username  the Tata CliQ account being signed in as; mapped to the
 *                  credential's `otpEmail` when the mail goes somewhere else.
 * @param since     ignore anything older — the cutoff is captured before the
 *                  login click, so a stale code from a previous attempt can
 *                  never be typed into a fresh challenge.
 * @param timeoutMs how long to poll before giving up — see `OTP_WAIT_MS`. The
 *                  core's Tata CliQ login passes what is left of its own
 *                  deadline here.
 */
export const fetchTataCliqOtp = async (
  username: string,
  since?: Date,
  timeoutMs: number = OTP_WAIT_MS
): Promise<string | null> =>
  pollMailbox('tatacliq', await otpAddressFor('tatacliq', username), since, timeoutMs, 'login OTP')

/**
 * The Cloudflare Access code in front of sellerzone.tatacliq.com.
 *
 * The core's login calls this with the INBOX (the credential's Cloudflare
 * email, or the address Cloudflare said it mailed), not the login id — so the
 * address is used as given.
 */
export const fetchCloudflareOtp = async (
  email: string,
  since?: Date,
  timeoutMs: number = OTP_WAIT_MS
): Promise<string | null> => pollMailbox(TATACLIQ_CLOUDFLARE_OTP, email, since, timeoutMs, 'Cloudflare Access code')
