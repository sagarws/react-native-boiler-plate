import { canAuthenticateNow, healthOf } from '@shared/utils/sessionHealth'
import { platformKey } from '@shared/utils/platformKey'
import type { MappingCredential } from '@main/automations/accountMapping/types'
import { credentialsFor } from './company.service'
import { sessionHealth } from './platformSession.service'
import { logger } from './logger'

/**
 * The logins a probe should ask, best first.
 *
 * Every run that asks "which of our accounts holds this AWB" — Map Username,
 * Refill Data, and a claim that arrived without an account — needs the same
 * list, and used to build it three times with three different rules. One rule
 * now, because the cost being managed is the same in all three: opening an
 * account is a SIGN-IN, and on some platforms a browser and an emailed code.
 *
 * Two things follow from that.
 *
 * ORDERED, LIVE SESSIONS FIRST. An account with a session in hand answers in
 * one call; one without pays for a login before it can answer at all. The
 * answer is the same either way, so the cheap accounts go first and a run that
 * finds its AWB on one never touches the rest. This is also what makes "use the
 * account whose session is active" true without making it exclusive: a live
 * session decides the ORDER, never who is allowed to answer.
 *
 * FILTERED, BUT ONLY WHERE A LOGIN IS IMPOSSIBLE. An account whose sign-in
 * costs a one-time code and which has no live session cannot be opened by an
 * unattended run — somebody has to fetch the code. Those are left out, because
 * attempting them spends a minute per row to fail. Everything else stays in:
 * dropping an account that could have been signed in turns "we asked and it
 * was on none of them" into a lie.
 *
 * Best effort on the health read. If it cannot be fetched, every account is
 * offered in stored order — not knowing must not silently narrow the search.
 *
 * `accountType` rides along because Myntra's sign-in asks for it: an account
 * opened without it stops at the relationship-type modal.
 */
export const mappingAccounts = async (platform: string): Promise<MappingCredential[]> => {
  const key = platformKey(platform)
  const credentials = (await credentialsFor(platform)).filter(
    credential => credential.username.trim().length > 0
  )

  const health = await sessionHealth()
  const rows = health.success
    ? (health.data.find(entry => platformKey(entry.platform) === key)?.credentials ?? [])
    : []

  const live = new Set<string>()
  const needsCode = new Set<string>()

  for (const row of rows) {
    const state = healthOf(row.session)
    const name = row.username.trim().toLowerCase()

    // "expiring" still authenticates and is not a reason to sign in again.
    if (canAuthenticateNow(state)) live.add(name)
    else if (row.isOtpBased === true) needsCode.add(name)
  }

  const usable = credentials.filter(
    credential => !needsCode.has(credential.username.trim().toLowerCase())
  )

  if (needsCode.size > 0) {
    logger.info(
      `[accounts] ${key}: leaving out ${needsCode.size} account(s) that need a one-time code ` +
        'and have no live session'
    )
  }

  const ranked = usable.map((credential, index) => ({
    credential,
    // Index keeps the stored order inside each group: a stable list reads the
    // same way in two consecutive runs, which a sort alone would not promise.
    rank: live.has(credential.username.trim().toLowerCase()) ? index : index + usable.length
  }))

  ranked.sort((a, b) => a.rank - b.rank)

  return ranked.map(({ credential }) => ({
    username: credential.username,
    credentialId: credential.credentialId,
    accountType: credential.accountType
  }))
}
