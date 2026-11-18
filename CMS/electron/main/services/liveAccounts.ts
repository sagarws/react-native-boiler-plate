import { canAuthenticateNow, healthOf } from '@shared/utils/sessionHealth'
import { platformKey } from '@shared/utils/platformKey'
import { credentialsFor } from './company.service'
import { sessionHealth } from './platformSession.service'
import { logger } from './logger'

/**
 * A platform's logins, split into every one this company has and the ones
 * whose saved session can be used now — for the scheduled report syncs, which
 * read only accounts that will not stop to sign in.
 *
 * TWO SOURCES, MERGED. The Login page lists accounts from the server
 * (`/cms/my-company-credentials`); the local company copy can lag behind it,
 * and a sync that read only the local copy found "no Snapdeal account" while
 * the Login page showed one with a live session.
 *
 * "Live" is the reading the Login page and the claims use
 * (`canAuthenticateNow`), never a login whose password was refused. When
 * session health cannot be read, nothing is live: syncing on a guess would open
 * a sign-in in the middle of the run.
 */
export const sessionAccounts = async (
  platform: string
): Promise<{ all: string[]; live: Set<string> }> => {
  const key = platformKey(platform)
  const health = await sessionHealth()

  if (!health.success) {
    logger.warn(`[${key}-backup] could not read session health — no account synced: ${health.error.message}`)
  }

  const rows = health.success
    ? (health.data.find(entry => platformKey(entry.platform) === key)?.credentials ?? [])
    : []
  const local = (await credentialsFor(key)).map(credential => credential.username)
  const seen = new Set<string>()
  const all: string[] = []

  for (const name of [...local, ...rows.map(row => row.username)]) {
    const trimmed = typeof name === 'string' ? name.trim() : ''

    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    all.push(trimmed)
  }

  const live = new Set(
    rows
      .filter(row => row.refused !== true && canAuthenticateNow(healthOf(row.session)))
      .map(row => row.username.trim().toLowerCase())
  )

  return { all, live }
}
