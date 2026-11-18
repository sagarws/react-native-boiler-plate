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
 * Fetches the Snapdeal one-time code from the mailbox configured on THIS
 * machine.
 *
 * WHY SNAPDEAL NEEDED THIS. Its login reads the code from the backend: a
 * person is emailed it, types it into a modal in TrackVid, and the run waits.
 * That is the right answer when nobody can read the mailbox, and the wrong one
 * at 02:00 — the browser sits on the OTP box for the whole poll window and
 * fails anyway. Snapdeal mails the same code it texts, so a machine with the
 * mailbox can simply read it.
 *
 * NO TRACKVID RELAY — none of the three platforms has one now; every code is
 * read on this machine, from the TrackVid OTP mailbox baked into the build. With
 * none set up this returns null, and the login falls back to the operator
 * modal exactly as it always has.
 *
 * NULL, NEVER A THROW, for the same reason as the other two: returning nothing
 * is what lets the login fall back to the operator, which is the whole reason
 * the automatic attempt is safe to make at all.
 */

interface OtpPoller {
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
 * @param username  the Snapdeal account being signed in as — mapped to the
 *                  credential's `otpEmail` when the mail goes somewhere else.
 * @param since     ignore anything older. Captured before the login click, so
 *                  the PREVIOUS sign-in's code can never be typed into a fresh
 *                  challenge; every one of these mails shares one subject, so
 *                  without it the newest match is often exactly that.
 * @param timeoutMs how long to poll before giving up — see `OTP_WAIT_MS`.
 */
export const fetchSnapdealOtp = async (
  username: string,
  since?: Date,
  timeoutMs: number = OTP_WAIT_MS
): Promise<string | null> => {
  // Resolved ONCE, not per attempt: whether this app can read the inbox cannot
  // change halfway through a login.
  if (!canReadOtpHere()) {
    logger.info('[snapdeal-otp] no mailbox configured on this machine — asking the operator')

    return null
  }

  const { pollForOtp } = loadCore<OtpPoller>('platforms/snapdeal/common/getOtp')

  // Said plainly, because it has happened on another platform: the module did
  // not export the poller, this called `undefined`, and the packaged build
  // reported "r is not a function" four milliseconds into a two-minute wait,
  // with the browser sitting on the OTP box.
  if (typeof pollForOtp !== 'function') {
    throw new Error(
      "the core's Snapdeal OTP module exposes no pollForOtp — this app and the core are out of step"
    )
  }

  const address = await otpAddressFor('snapdeal', username)

  logger.info(`[snapdeal-otp] reading the mailbox on this machine as ${address}`)

  // A Skip on the Login update abandons this sign-in; the poll must not run on
  // for the rest of OTP_WAIT_MS reading a mailbox for a login nobody wants.
  const skipWatch = whenPlatformSkipped('session-refresh', 'snapdeal')
  let skipped = false

  void skipWatch.promise.then(() => {
    skipped = true
  })

  let otp: string | null

  try {
    otp = await pollForOtp(async attempt => {
      if (skipped) throw new Error('skipped by hand')

      const code = await readOtpLocally('snapdeal', address, since)

      if (!code) await diagnoseOtpWait('snapdeal-otp', attempt, address, since)

      return code
    }, {
      timeoutMs,
      schedule: OTP_POLL_SCHEDULE,
      // The only throw is the Skip above, which must END the wait. A mailbox
      // that refuses one read is not a throw — `readOtpLocally` reports it and
      // returns null, so the poll still tries again.
      retryOnError: false,
      logger
    })
  } finally {
    skipWatch.cancel()
  }

  if (otp) logger.info(`[snapdeal-otp] code received for ${username}`)
  else {
    logger.warn(
      `[snapdeal-otp] no code for ${username} within ${Math.round(timeoutMs / 1000)}s — ` +
        'falling back to the operator'
    )
  }

  return otp
}
