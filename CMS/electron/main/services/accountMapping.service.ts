import { probeOpener } from '../automations/accountMapping/registry'
import type { AccountProbe, MappingCredential } from '../automations/accountMapping/types'
import { logger } from './logger'

/**
 * Opening each of a platform's logins, once, so an AWB can be put to them.
 *
 * WHAT IS LEFT OF THIS FILE. It used to hold the "Map Username" run as well —
 * a second way to answer "which login owns this AWB", with its own progress,
 * its own conflict resolution and its own button. That question is Refill
 * Data's now: its Account field runs the same sweep, and unlike the old run it
 * also writes the POB the sweep found. Two routes to one answer is how they
 * drift, and one of them was already dropping half of it.
 *
 * The pool survives because both callers still need it — the claim processor
 * and the refill sweep each ask accounts about an AWB, and neither should open
 * a browser per row.
 */
/**
 * Opens accounts on demand and remembers what it opened.
 *
 * The laziness is the point: a company with five AJIO logins would otherwise
 * launch five browsers before asking a single question, and four of them would
 * be closed unused when the first account turned out to own every row.
 *
 * A sign-in that FAILS is remembered too, as a failure. Without that, a dead
 * credential is re-attempted once per claim — three hundred sign-in attempts
 * against one broken login, each one slow.
 */
export class ProbePool {
  private readonly open = new Map<string, Promise<AccountProbe>>()

  constructor(private readonly platform: string) {}

  probe(credential: MappingCredential): Promise<AccountProbe> {
    const existing = this.open.get(credential.username)

    if (existing) return existing

    const opener = probeOpener(this.platform)

    if (!opener) {
      return Promise.reject(new Error(`This app cannot map ${this.platform} accounts`))
    }

    logger.info(`[account-map] opening ${this.platform}/${credential.username}`)

    const opening = opener(credential)

    this.open.set(credential.username, opening)

    return opening
  }

  /** Closes every account that was actually opened. Never throws. */
  async closeAll(): Promise<void> {
    for (const [username, opening] of this.open) {
      try {
        const probe = await opening

        await probe.close()
      } catch (error) {
        logger.warn(
          `[account-map] could not close ${this.platform}/${username}: ` +
            (error instanceof Error ? error.message : String(error))
        )
      }
    }

    this.open.clear()
  }
}
