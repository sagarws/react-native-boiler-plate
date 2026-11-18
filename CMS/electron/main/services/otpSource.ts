import { loadCore } from '@main/automations/common/coreLoader'
import type { PeekedOtp } from '@shared/types/platformSession'
import { fail, ok, type Result } from '@shared/types/result'
import { env } from '../config/env'
import { credentialFor, type CredentialRecord } from './company.service'
import { logger } from './logger'
import { whenPlatformSkipped } from './platformSkip.store'
/**
 * Where a one-time code comes from — the same mailbox, whoever reads it.
 *
 * Flipkart and Tata CliQ both email a code, and the automation server reads it
 * over IMAP with `GetFlipKartOTP` / `GetTataCliqOTP`. Those functions live in
 * the CORE, which this app already loads, so there was never a reason for the
 * server to be the one calling them — only a reason it had the credentials and
 * this app did not.
 *
 * Given them, this app calls the same functions against the same inbox, and a
 * sign-in needs nothing else running. EVERY CODE IS READ HERE: there is no
 * TrackVid relay any more. Without a mailbox login in the build the pollers
 * return null and the sign-in falls back to asking the operator.
 *
 * ONE SOURCE FOR BOTH PLATFORMS. They differ by which reader is called and
 * nothing else: same mailbox, same credentials, same fallback. Flipkart looked
 * like it worked differently for weeks, and it never did — it simply is not
 * challenged on every account, so most of its sign-ins never ask for a code at
 * all.
 */

/**
 * HOW LONG A SIGN-IN WAITS FOR ITS CODE, and how often it looks — one policy
 * for Flipkart, Tata CliQ and Snapdeal.
 *
 * Twenty minutes, because an OTP mail is sometimes minutes late and a login
 * that gives up at ninety seconds fails an account that would have signed in.
 * The reads are at 20s, 40s, 60s and then every 15s: the first mail rarely
 * lands sooner, and after a minute a slow one is worth checking more often.
 */
export const OTP_WAIT_MS = 20 * 60_000
export const OTP_POLL_SCHEDULE = [20_000, 20_000, 20_000, 15_000]

/** The core's reader for one platform — both take the same shape. */
type MailReader = (
  to: string,
  options: { since?: Date; account?: { user: string; password: string } }
) => Promise<string | null>

/**
 * One mailbox code source: the core reader that parses it, and whose inbox it
 * is sent to.
 *
 * Usually the key is a platform and the inbox is the credential's OTP address.
 * Tata CliQ has a SECOND code — Cloudflare Access, in front of the seller zone —
 * sent to a different inbox, so a source may name the platform its credential
 * belongs to and how to read the address off it. Kept as data here rather than
 * an `if (platform === …)` anywhere else.
 */
interface ReaderEntry {
  module: string
  fn: string
  /** The platform whose credential this code belongs to, when not the key itself. */
  credentialPlatform?: string
  /** The inbox, from the credential; the default is its OTP address, else the login id. */
  addressOf?: (credential: CredentialRecord | null, username: string) => string
}

/** The Cloudflare Access code source, by its key. Shared with tatacliqOtp.service. */
export const TATACLIQ_CLOUDFLARE_OTP = 'tatacliq-cloudflare'

/**
 * The inbox Cloudflare Access mails this login's code to: the credential's own,
 * else the core's default. One rule, so the Login page shows the address the
 * reader actually looks in.
 */
export const cloudflareInboxOf = (credential: CredentialRecord | null): string =>
  credential?.cloudflareEmail ||
  loadCore<{ DEFAULT_TO: string }>('platforms/tatacliq/common/cloudflareOTP').DEFAULT_TO

const READERS: Record<string, ReaderEntry> = {
  flipkart: { module: 'platforms/flipkart/common/getOtp', fn: 'GetFlipKartOTP' },
  tatacliq: { module: 'platforms/tatacliq/common/getOtp', fn: 'GetTataCliqOTP' },
  // Cloudflare Access in front of sellerzone.tatacliq.com: its own sender and
  // subject, mailed to the credential's Cloudflare email — not its login id.
  [TATACLIQ_CLOUDFLARE_OTP]: {
    module: 'platforms/tatacliq/common/cloudflareOTP',
    fn: 'GetCloudflareOTP',
    credentialPlatform: 'tatacliq',
    addressOf: credential => cloudflareInboxOf(credential)
  },
  // Snapdeal mails the same code it texts. Unlike the two above it has no
  // TrackVid relay — it already has an operator modal for the machines that
  // cannot read the mailbox, and two backend paths for one code would race.
  snapdeal: { module: 'platforms/snapdeal/common/getOtp', fn: 'GetSnapdealOTP' },
  // AJIO's Reliance SSO challenges some accounts with "Verify your identity"
  // and mails the code (no-reply_sellercentral@ril.com, "OTP AUTHENTICATION").
  ajio: { module: 'platforms/ajio/common/getOtp', fn: 'GetAjioOTP' }
}

/**
 * The TrackVid OTP mailbox, or null when the build carries none.
 *
 * The same arrangement as the standalone check-otp tool: ONE shared inbox,
 * whose login is baked into the build (`.env` for dev,
 * `.env.production.local` for an installer), and every read filtered to the
 * one credential's address — so an account only ever sees its own codes.
 * There is no server fallback; every code is read on this machine.
 */
const mailbox = (): { user: string; password: string } | null =>
  env.gmailImapUser && env.gmailImapPassword
    ? { user: env.gmailImapUser, password: env.gmailImapPassword }
    : null

/** Can this machine read the codes itself? */
export const canReadOtpHere = (): boolean => mailbox() !== null

const readerFor = (platform: string): MailReader | null => {
  const entry = READERS[platform]

  if (!entry) return null

  // A literal specifier per platform, never a computed one: the main process is
  // bundled and a bundler cannot follow `require(variable)`.
  const core = loadCore<Record<string, MailReader>>(entry.module)
  const reader = core[entry.fn]

  return typeof reader === 'function' ? reader : null
}

/**
 * Where the portal actually sends the code.
 *
 * The credential's own OTP address when it has one, and the login id otherwise
 * — the same rule the server applies, so both routes look in the same place.
 */
export const otpAddressFor = async (platform: string, username: string): Promise<string> => {
  const entry = READERS[platform]
  const credential = await credentialFor(entry?.credentialPlatform ?? platform, username).catch(() => null)

  return entry?.addressOf ? entry.addressOf(credential, username) : credential?.otpEmail || username
}

/**
 * One attempt at the mailbox. Null when this machine cannot read it, or when
 * nothing has arrived yet.
 *
 * Never throws for a mail problem: a refused or slow mailbox is reported and
 * the caller falls through to the relay, which is a second opinion worth having
 * before a login is abandoned.
 */
export const readOtpLocally = async (
  platform: string,
  address: string,
  since?: Date
): Promise<string | null> => {
  const account = mailbox()

  if (!account) return null

  const reader = readerFor(platform)

  if (!reader) return null

  try {
    return await reader(address, { ...(since ? { since } : {}), account })
  } catch (error) {
    logger.warn(
      `[otp] the mailbox on this machine did not answer for ${platform} — ` +
        `${error instanceof Error ? error.message : String(error)}`
    )

    return null
  }
}

/**
 * After this many empty mailbox reads (~60s on `OTP_POLL_SCHEDULE`), say what
 * the mailbox does hold for the address. Once, not every read: the answer only
 * changes when a mail arrives, and then the code is found anyway.
 */
const DIAGNOSE_AFTER_ATTEMPT = 3

/**
 * Called after each empty local read with the poller's attempt number; on the
 * one that crosses `DIAGNOSE_AFTER_ATTEMPT` it logs what the mailbox holds for
 * the address — `[<tag>] no code yet — newest mail to … is from …`. The same
 * line for every platform, so one grep finds a dead forward on any of them.
 */
export const diagnoseOtpWait = async (
  tag: string,
  attempt: number,
  address: string,
  since?: Date
): Promise<void> => {
  if (attempt !== DIAGNOSE_AFTER_ATTEMPT) return

  const seen = await describeLatestOtpMail(address, since)

  if (seen) logger.warn(`[${tag}] no code yet — ${seen}`)
}

interface OtpPoller {
  pollForOtp: (
    fetchOnce: (attempt: number) => Promise<string | null>,
    options?: { timeoutMs?: number; schedule?: number[]; retryOnError?: boolean; logger?: unknown }
  ) => Promise<string | null>
}

/**
 * Waits for one platform's mailed code on THIS machine — the whole of what
 * `fetchSnapdealOtp` / `fetchFlipkartOtp` / `fetchTataCliqOtp` each do, for any
 * platform in `READERS`. A new OTP platform is a `READERS` entry plus
 * `(u, s, t) => pollMailedOtp('<platform>', u, s, t)`, not a fourth copy.
 *
 * Null, never a throw, when no mailbox is configured or nothing arrives in
 * time: returning nothing is what lets the login fail cleanly (or hand over to
 * the operator), which is why the automatic attempt is safe to make at all.
 * A Skip on the Login update ends the wait at the next read.
 *
 * @param since     ignore anything older — captured before the login submit,
 *                  so the PREVIOUS sign-in's code can never be typed.
 * @param timeoutMs how long to poll before giving up — see `OTP_WAIT_MS`.
 */
export const pollMailedOtp = async (
  platform: string,
  username: string,
  since?: Date,
  timeoutMs: number = OTP_WAIT_MS
): Promise<string | null> => {
  const tag = `${platform}-otp`

  if (!canReadOtpHere()) {
    logger.info(`[${tag}] this build carries no OTP mailbox login — no code can be read here`)

    return null
  }

  // A literal specifier: the poller is the shared one every platform's reader
  // re-exports, so loading it from its home needs no per-platform branch.
  const { pollForOtp } = loadCore<OtpPoller>('platforms/flipkart/common/getOtp')

  if (typeof pollForOtp !== 'function') {
    throw new Error("the core's OTP module exposes no pollForOtp — this app and the core are out of step")
  }

  const address = await otpAddressFor(platform, username)

  logger.info(`[${tag}] reading the mailbox on this machine as ${address}`)

  const skipWatch = whenPlatformSkipped('session-refresh', platform)
  let skipped = false

  void skipWatch.promise.then(() => {
    skipped = true
  })

  let otp: string | null

  try {
    otp = await pollForOtp(async attempt => {
      if (skipped) throw new Error('skipped by hand')

      const code = await readOtpLocally(platform, address, since)

      if (!code) await diagnoseOtpWait(tag, attempt, address, since)

      return code
    }, {
      timeoutMs,
      schedule: OTP_POLL_SCHEDULE,
      // The only throw is the Skip above, which must END the wait; a refused
      // mailbox read is reported by `readOtpLocally` and returns null instead.
      retryOnError: false,
      logger
    })
  } finally {
    skipWatch.cancel()
  }

  if (otp) logger.info(`[${tag}] code received for ${username}`)
  else logger.warn(`[${tag}] no code for ${username} within ${Math.round(timeoutMs / 1000)}s`)

  return otp
}

interface GmailReader {
  fetchEmails: (
    filters: { to?: string; limit?: number },
    options?: { account?: { user: string; password: string } }
  ) => Promise<{ from: string; subject: string; date: Date | null; text?: string; html?: string }[]>
}

/**
 * One line saying what the mailbox DOES hold for this address — for a sign-in
 * that has been waiting with nothing found.
 *
 * "No code yet" reads the same whether the mail is a minute late or will never
 * come. Naming the newest mail to the address, and when it arrived, tells
 * those apart: a code from yesterday means the portal stopped mailing this
 * account (or the forward to this inbox broke), not that the reader is wrong.
 *
 * Searched by recipient only, with no sender or subject filter, so it needs
 * nothing platform-specific and also catches a portal that changed its wording.
 * Never throws; null when this machine cannot read the mailbox.
 */
export const describeLatestOtpMail = async (
  address: string,
  since?: Date
): Promise<string | null> => {
  const account = mailbox()

  if (!account) return null

  try {
    const { fetchEmails } = loadCore<GmailReader>('common/gmailReader')
    const [latest] = await fetchEmails({ to: address, limit: 1 }, { account })
    const cutoff = since ? ` — nothing since the login at ${since.toISOString()}` : ''

    if (!latest) return `no mail to ${address} in ${account.user} at all${cutoff}`

    const when = latest.date ? new Date(latest.date).toISOString() : 'an unknown time'
    // The subject usually carries the code itself; a stale one is no secret
    // worth keeping, but there is no reason to print it either.
    const subject = latest.subject.replace(/\d{4,8}/g, '######')

    return `newest mail to ${address} in ${account.user} is from ${when} ("${subject}")${cutoff}`
  } catch (error) {
    return `could not look for mail to ${address} — ${error instanceof Error ? error.message : String(error)}`
  }
}

/** How many recent mails to the address are searched for the one carrying the code. */
const PEEK_SEARCH_DEPTH = 10

/**
 * Tries for "Get OTP", and the pause between them.
 *
 * Gmail sometimes takes longer than the IMAP client's fixed 5s to accept a
 * login — most often when the same mailbox is being signed into repeatedly.
 * A sign-in rides through that because its poller simply reads again 15–20s
 * later (`readOtpLocally` swallows the error). "Get OTP" is one press with no
 * poller behind it, so it retries here instead of failing on the first slow
 * login.
 */
const PEEK_ATTEMPTS = 3
const PEEK_RETRY_DELAY_MS = 2_000

/**
 * The imap client's own timeouts — `timeout` (TCP connect) and `timeout-auth`
 * (greeting + login) on `error.source`. Only these are retried: a refused
 * password or a missing mailbox fails the same way every time.
 */
const isMailboxTimeout = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  typeof (error as { source?: unknown }).source === 'string' &&
  (error as { source: string }).source.startsWith('timeout')

const retryOnMailboxTimeout = async <T>(read: () => Promise<T>): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await read()
    } catch (error) {
      if (attempt >= PEEK_ATTEMPTS || !isMailboxTimeout(error)) throw error

      logger.warn(
        `[otp] mailbox timed out (attempt ${attempt} of ${PEEK_ATTEMPTS}) — ` +
          `${error instanceof Error ? error.message : String(error)}; trying again`
      )
      await new Promise(resolve => setTimeout(resolve, PEEK_RETRY_DELAY_MS))
    }
  }
}

/** When the newest mail carrying `otp` arrived, or null when none of the recent ones does. */
const arrivalOf = async (
  otp: string,
  address: string,
  account: { user: string; password: string }
): Promise<string | null> => {
  const { fetchEmails } = loadCore<GmailReader>('common/gmailReader')
  const recent = await retryOnMailboxTimeout(() =>
    fetchEmails({ to: address, limit: PEEK_SEARCH_DEPTH }, { account })
  )
  // Sorted here: the reader returns them in the order they finished parsing,
  // which is not reliably newest first once there is more than one.
  const carrying = recent
    .filter(mail => [mail.subject, mail.text ?? '', mail.html ?? ''].join('\n').includes(otp))
    .map(mail => (mail.date ? new Date(mail.date).getTime() : 0))
    .sort((a, b) => b - a)[0]

  return carrying ? new Date(carrying).toISOString() : null
}

/**
 * "Get OTP" — the newest code in the mailbox for one account, and when it came.
 *
 * NO `since`, on purpose. This is for a person who has just pressed "send
 * code" on the marketplace and wants to read it; the arrival time is shown
 * beside the code so they can tell a fresh one from yesterday's themselves.
 *
 * The CODE comes from the core's own reader for the platform, so it is the
 * exact value an automated sign-in would type. The core does not say when that
 * mail arrived, so the time is found by reading the newest few mails to the
 * address and taking the newest one that contains the code — recipient only,
 * nothing platform-specific copied here.
 */
export const peekLatestOtp = async (payload: unknown): Promise<Result<PeekedOtp>> => {
  const input = (payload ?? {}) as { platform?: unknown; username?: unknown }
  const platform = typeof input.platform === 'string' ? input.platform.trim().toLowerCase() : ''
  const username = typeof input.username === 'string' ? input.username.trim() : ''

  if (!READERS[platform]) return fail('VALIDATION_ERROR', `No OTP reader for ${platform || 'that platform'}`)
  if (!username) return fail('VALIDATION_ERROR', 'Choose the account to read the code for')

  const account = mailbox()

  /*
   * A build made without the mailbox login (see `mailbox`) has nothing to
   * read. Said as the fix, not the fault: "no mailbox configured" left
   * operators with nowhere to go.
   */
  if (!account) {
    return fail(
      'VALIDATION_ERROR',
      'This build has no OTP mailbox login — set MAIN_VITE_GMAIL_IMAP_USER / MAIN_VITE_GMAIL_IMAP_PASSWORD in .env.production.local and rebuild'
    )
  }

  const reader = readerFor(platform)

  if (!reader) return fail('INTERNAL_ERROR', "The core's OTP reader for this platform is missing")

  const address = await otpAddressFor(platform, username)

  try {
    const otp = await retryOnMailboxTimeout(() => reader(address, { account }))

    if (!otp) return ok({ otp: null, receivedAt: null, address })

    // The code is in hand; the arrival time is only a label beside it. A slow
    // mailbox on this second read shows the code without a time rather than
    // throwing away a code that was already read.
    const receivedAt = await arrivalOf(otp, address, account).catch((error: unknown) => {
      logger.warn(
        `[otp] Get OTP for ${platform} · ${address}: code read, arrival time not — ` +
          `${error instanceof Error ? error.message : String(error)}`
      )

      return null
    })

    return ok({ otp, receivedAt, address })
  } catch (error) {
    logger.warn(`[otp] Get OTP for ${platform} · ${address} failed`, error)

    return fail(
      'INTERNAL_ERROR',
      `Could not read the mailbox — ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
