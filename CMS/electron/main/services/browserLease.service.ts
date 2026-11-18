import { logger } from './logger'

/**
 * Keeps ONE signed-in browser alive across a run of claims, instead of opening
 * and closing Chrome for each of them.
 *
 * AJIO is why this exists. Its claim calls have to be made from inside a
 * logged-in page — Akamai wants the HttpOnly `bff_session` and a real TLS
 * fingerprint — so a browser is unavoidable. A browser *per claim* is not: the
 * automation server has always kept one page for a whole batch (`ensureSession`
 * in the AJIO script flow), and the bulk claim keeps one per account. The
 * desktop app was the outlier, launching and tearing down Chrome for every
 * single claim in the queue and paying the hydrate-navigate-probe on each one.
 * Eight queued claims meant eight Chrome launches — visible ones, when the
 * company has scripted sign-in turned off.
 *
 * THE UNIT IS THE DRAIN, NOT THE CLAIM. `drainClaims` opens a lease around its
 * loop and closes it at the end; a claim run outside one — a single Create
 * Ticket click — finds no lease, gets its own browser, and closes it exactly as
 * before. That fallback is what keeps this from being a behaviour change for
 * the one-off case.
 *
 * ONE AT A TIME. Only a single session is held, and asking for a different key
 * closes the previous one. Two marketplace browsers at once is what
 * `withAutomationLock` already prevents, and caching several would quietly
 * re-introduce it.
 */

interface Closable {
  close: () => Promise<void>
  /** Puppeteer ≥23 exposes this as a property; older builds as a method. */
  connected?: boolean
  isConnected?: () => boolean
}

/**
 * Structural, and deliberately open: each runner has its own Page shape and
 * this file only ever asks one question of it. The index signature is what lets
 * a runner's richer type assign here without a cast at every call site.
 */
interface Page extends Record<string, unknown> {
  isClosed?: () => boolean
}

interface Held<C = unknown> {
  key: string
  browser: Closable
  page: Page
  context: C
}

let leaseOpen = false
let held: Held | null = null

/** Is the browser still usable, or did Chrome die under us? */
const alive = (entry: Held): boolean => {
  const connected = entry.browser.connected ?? entry.browser.isConnected?.() ?? true

  return connected && entry.page.isClosed?.() !== true
}

const shut = async (entry: Held, why: string): Promise<void> => {
  try {
    await entry.browser.close()
  } catch (error) {
    // Already gone is the common case and not worth a stack trace.
    logger.warn(`[browser-lease] closing ${entry.key} after ${why}: ${String(error)}`)
  }
}

/** Starts a scope in which browsers are kept between claims. */
export const openClaimLease = (): void => {
  leaseOpen = true
}

/** Ends it, closing whatever is held. Safe to call when nothing is. */
export const closeClaimLease = async (): Promise<void> => {
  leaseOpen = false

  if (!held) return

  const entry = held

  held = null
  logger.info(`[browser-lease] closing the browser for ${entry.key}`)
  await shut(entry, 'the queue emptied')
}

/**
 * Throws away the held session without ending the lease.
 *
 * For a runner that has reason to believe the session is no longer good — a
 * claim that failed for a reason the marketplace did not explain. Carrying a
 * logged-out page forward would fail every remaining claim in the queue with an
 * error that looks nothing like the cause.
 */
export const discardLease = async (): Promise<void> => {
  if (!held) return

  const entry = held

  held = null
  logger.info(`[browser-lease] discarding the browser for ${entry.key} after a failure`)
  await shut(entry, 'a failure')
}

export const leaseState = (): { open: boolean; key: string | null } => ({
  open: leaseOpen,
  key: held?.key ?? null
})

/**
 * A signed-in page for `key`, created only if there isn't one already.
 *
 * @param key    `<platform>:<username>` — a different account means a different
 *               browser, because the session is the whole point of holding it.
 * @param create opens a browser, signs in, and returns the page plus whatever
 *               the runner needs alongside it (AJIO's seller id, say). Called
 *               only on a miss, so a sign-in happens once per account per drain.
 * @returns the session, and a `release` the caller MUST call in a `finally` —
 *          a no-op while a lease is open, a real close when there isn't one.
 */
export const leasedSession = async <C>(
  key: string,
  create: () => Promise<{ browser: Closable; page: Page; context: C }>
): Promise<{ page: Page; context: C; reused: boolean; release: () => Promise<void> }> => {
  if (held && held.key === key && alive(held)) {
    logger.info(`[browser-lease] reusing the open browser for ${key}`)

    return {
      page: held.page,
      context: held.context as C,
      reused: true,
      // Held for the next claim; closed by closeClaimLease.
      release: () => Promise.resolve()
    }
  }

  // A dead browser, or a different account. Either way the old one goes.
  if (held) {
    const stale = held

    held = null
    await shut(stale, stale.key === key ? 'the browser died' : `switching to ${key}`)
  }

  const created = await create()
  const entry: Held<C> = { key, browser: created.browser, page: created.page, context: created.context }

  if (leaseOpen) {
    held = entry

    return { page: entry.page, context: entry.context, reused: false, release: () => Promise.resolve() }
  }

  // No lease: behave exactly as before — this browser belongs to this claim.
  return {
    page: entry.page,
    context: entry.context,
    reused: false,
    release: () => shut(entry, 'the claim finished')
  }
}
