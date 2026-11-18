import type { PlatformCredentials } from '../types/platformSession'
import { healthOf } from './sessionHealth'

/**
 * Which marketplace accounts cannot file a claim right now — checked before
 * Create Ticket starts anything.
 *
 * NARROWER THAN THE BANNER, and that difference is deliberate — do not "fix"
 * it by pointing this at `sessionUpdateTargets`.
 *
 * This answers "can this claim be filed right now", and for an EXPIRING
 * session the answer is yes: it has up to two hours left, which is more than a
 * batch needs, and refusing it would turn work that would have succeeded into
 * work that never ran. The banner answers "what is the app going to
 * re-capture", where an expiring session belongs — it is renewed tonight
 * either way, and starting a long batch on one is worth a warning.
 *
 * So the two say different things about the same account on purpose, and each
 * says the thing its own question needs. What they must never do is disagree
 * about EXPIRED or NEVER-CAPTURED, which is the case where a popup and a banner
 * contradicting each other would teach operators to ignore both.
 *
 * Stopping here is the whole point. A claim started on a dead session signs in
 * from scratch (or fails) per account, mid-batch, long after the operator has
 * walked away — the fix is a re-capture, and it is quicker done first.
 */

export interface AccountRef {
  /** As stored on the claim ("Ajio") — compared case- and space-insensitively. */
  platform: string
  username: string
}

export interface InactiveAccount {
  platform: string
  username: string
  /** Needed to re-capture. Absent when this machine holds no such login. */
  credentialId: string | null
  /**
   * expired / none / dead: re-capture fixes it. missing: the login is not on
   * this machine at all.
   *
   * `dead` cannot be seen from the stored record — it is the marketplace
   * refusing a jar whose stored expiry has not passed yet, which only a probe
   * finds. It arrives from the main process, not from `inactiveAccounts`
   * below.
   */
  state: 'expired' | 'none' | 'missing' | 'dead'
  /**
   * This account can be skipped, and the run will simply leave it out.
   *
   * True for a credential whose sign-in costs a one-time code (`isOtpBased` —
   * Snapdeal, Flipkart and AJIO). Re-capturing one of those is an OTP an operator has
   * to go and fetch, which is a real errand, and the thing they were trying to
   * do rarely needs THAT account — a refill across six logins wants the five
   * that can answer, not to be held up by the sixth.
   *
   * So an optional account is shown, badged, and never the reason the run is
   * stopped. What it is NOT is silently included: an account without a live
   * session is left out of the sweep entirely rather than attempted and failed.
   */
  optional: boolean
}

const platformKey = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, '')

export const inactiveAccounts = (
  accounts: readonly AccountRef[],
  health: readonly PlatformCredentials[],
  now = Date.now()
): InactiveAccount[] => {
  const byPlatform = new Map(health.map(entry => [platformKey(entry.platform), entry]))
  const seen = new Set<string>()
  const inactive: InactiveAccount[] = []

  for (const account of accounts) {
    const key = platformKey(account.platform)
    const username = account.username.trim()

    // A row with no account (Nykaa signs in with the company's own login) has
    // nothing to check here; the claim's own flow handles it.
    if (!key || !username) continue

    const id = `${key}::${username.toLowerCase()}`

    if (seen.has(id)) continue
    seen.add(id)

    const platform = byPlatform.get(key)

    // A platform this app keeps no sessions for is not this check's to block.
    if (!platform) continue

    const credential = platform.credentials.find(c => c.username.trim().toLowerCase() === username.toLowerCase())

    if (!credential) {
      // Not optional: a login this machine does not hold cannot be skipped INTO
      // a run — there is nothing to run as.
      inactive.push({
        platform: platform.platform,
        username,
        credentialId: null,
        state: 'missing',
        optional: false
      })
      continue
    }

    const state = healthOf(credential.session, now)

    if (state === 'expired' || state === 'none') {
      inactive.push({
        platform: platform.platform,
        username: credential.username,
        credentialId: credential.credentialId,
        state,
        optional: credential.isOtpBased === true
      })
    }
  }

  return inactive
}
