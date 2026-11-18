import { usesApiFlow } from './automationRouting.service'
import { dependsOnStoredSession, resolveClaimRunner } from '@main/automations/registry'
import { reusableSession } from './sessionReuse.service'
import { renewForClaim } from './claimSession.service'
import { credentialFor } from './company.service'
import { logger } from './logger'
import { platformKey } from '@shared/utils/platformKey'
import type { BlockedAccount } from '@shared/types/claimQueue'

/**
 * No claim is filed through a session the marketplace has already rejected.
 *
 * The rule, in one place, because it has to hold in two: a batch pressed from
 * the Claims page, and a single claim the socket dispatched. Without it a run
 * opens a browser, signs nothing in, files nothing, and reports a failure per
 * claim — burning an attempt each time — for a reason the operator could have
 * been told before it started, and which the banner at the top of the screen
 * was already telling them.
 *
 * WHAT COUNTS AS "NOT ACTIVE" is deliberately narrow. Only a verdict the probe
 * actually reached blocks:
 *
 *   none-stored / empty-jar  there is no session at all
 *   dead                     the marketplace refused it
 *
 * `unverifiable` and `probe-failed` never block. AJIO has no jar-only probe by
 * design — its check needs a live page — so every AJIO account lands there, and
 * treating "cannot tell" as "dead" would stop AJIO claims entirely.
 *
 * WHICH FLOWS ARE CHECKED comes from the registry, not from the flow's name.
 * "Script flow" used to mean "signs in from scratch, holds no stored session to
 * be dead", and this skipped all of them on that basis. Flipkart's script flow
 * now hydrates the stored jar and proves it against the SPF dashboard, so a
 * dead session there costs a per-account sign-in that needs an emailed code —
 * mid-batch, long after the operator walked away. See `dependsOnStoredSession`.
 *
 * A flow that genuinely signs in every run is still not checked: refusing it
 * over a dead stored session would turn work that would have succeeded into
 * work that never ran.
 */

/** Verdicts that mean the session is definitely not usable. */
const BLOCKING = new Set(['none-stored', 'empty-jar', 'dead'])

/**
 * Re-exported: the shape crosses the IPC boundary, so it is declared in
 * shared/types/claimQueue and this module's callers keep importing it here.
 */
export type { BlockedAccount }

interface ClaimRef {
  platform?: string | undefined
  username?: string | undefined
}

/**
 * How an account is identified across this module and its callers.
 *
 * Exported because a caller that SKIPS the claims of a blocked account has to
 * match rows back to the verdict, and matching on the raw strings would miss
 * "Ajio" against "ajio" or a username that differs only in case.
 */
export const accountKey = (platform: string, username: string): string =>
  `${platformKey(platform)}:${username.trim().toLowerCase()}`

const key = accountKey

/**
 * The accounts in this selection whose session cannot file a claim.
 *
 * Each distinct account is checked ONCE however many claims it covers — the
 * probe is a marketplace round trip, and twenty claims for one seller should
 * not be twenty of them.
 *
 * A dead session is offered a renewal first, through the same path a claim
 * would take, so an installation with auto-login on repairs itself rather than
 * refusing. Only a session that is still dead afterwards blocks.
 */
export const sessionVerdicts = async (
  claims: ClaimRef[],
  { directApiCall = false }: { directApiCall?: boolean } = {}
): Promise<BlockedAccount[]> => {
  const seen = new Set<string>()
  const blocked: BlockedAccount[] = []

  for (const claim of claims) {
    const platform = (claim.platform ?? '').trim()
    const username = (claim.username ?? '').trim()

    // No account on the row is a different problem, reported by a different
    // gate — `requireClaimAccount` names it per claim, and guessing here would
    // report it as a session fault.
    if (!platform || !username) continue

    const id = key(platform, username)

    if (seen.has(id)) continue

    seen.add(id)

    // Check TAT, Refill and account mapping ARE the HTTP calls — they have no
    // sign-in of their own to fall back on, so the stored session decides the
    // whole run whatever flow this company files claims through. Only a claim
    // asks the registry which flow it will get.
    if (!directApiCall) {
      const flow = (await usesApiFlow(platform, 'claim')) ? 'api' : 'script'
      const resolved = resolveClaimRunner(platform, flow)

      // The flow this company will actually get, and whether its run starts from
      // the stored session at all.
      if (!resolved || !dependsOnStoredSession(platform, resolved.flow)) continue
    }

    const verdict = await reusableSession(platform, username)

    if (!BLOCKING.has(verdict.reason)) continue

    const credential = await credentialFor(platform, username)

    blocked.push({
      platform,
      username,
      detail: verdict.detail,
      credentialId: credential?.credentialId ?? null,
      // empty-jar is a stored record with nothing in it — the same nothing as
      // none-stored, as far as an operator can act on it.
      state: verdict.reason === 'dead' ? 'dead' : 'none'
    })
  }

  return blocked
}

/**
 * The same check, but repairing what it can before refusing.
 *
 * Used by the batch itself. The renewal is the one a claim would have
 * triggered anyway and it respects the company's auto-login setting, so an
 * installation with auto-login on repairs itself rather than refusing. A
 * `none` account is included: there is nothing to renew, but the renewal path
 * is also how a first session gets captured.
 *
 * NOT used by the pre-flight the Claims page runs. A renewal can take a
 * minute per account and drive a browser, and an operator who has just pressed
 * Create Ticket should not watch the button hang while it happens — they get
 * the dialog and re-capture the accounts themselves, which is the same sign-in
 * with someone present for the one-time code.
 */
export const inactiveAccounts = async (claims: ClaimRef[]): Promise<BlockedAccount[]> => {
  const blocked: BlockedAccount[] = []

  for (const account of await sessionVerdicts(claims)) {
    logger.info(
      `[claim-session-guard] ${account.platform}/${account.username}: ${account.state} — ` +
        'trying to renew before refusing'
    )

    const renewed = await renewForClaim(
      account.platform,
      account.username,
      account.credentialId ?? undefined,
      `the saved login cannot file a claim — ${account.detail}`
    )

    const verdict = renewed
      ? await reusableSession(account.platform, account.username)
      : { reason: 'dead' as const, detail: account.detail }

    if (BLOCKING.has(verdict.reason)) blocked.push({ ...account, detail: verdict.detail })
  }

  return blocked
}

/**
 * What to tell the operator, naming the accounts rather than the count.
 *
 * "A session is not active" sends someone to the Sessions page to work out
 * which; the names are the whole message.
 */
export const describeBlocked = (blocked: BlockedAccount[]): string => {
  const names = blocked.map(entry => `${entry.platform} (${entry.username})`).join(', ')

  return (
    `Nothing was filed: ${names} ${blocked.length === 1 ? 'has no active login' : 'have no active login'}. ` +
    'Re-capture it on the Login page, then try again.'
  )
}
