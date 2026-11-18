import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { withAutomationLock } from './automationLock'
import { refreshCompany } from './company.service'
import { sweepTataCliqSlaves } from '../automations/platforms/tatacliq/common/slaveSync'
import { logger } from './logger'

/**
 * "Sync slaves" for one Tata CliQ account, from this machine.
 *
 * The same shape as `syncAjioPobs`, and the same reasoning — this app already
 * holds a signed-in page, so the browser lease means a sync pressed during a
 * run costs nothing at all, while routing it through the server would open a
 * second browser for the same account.
 *
 * It matters more here for two reasons. A second sign-in on Tata CliQ costs an
 * emailed OTP, not just time. And a slave list is not an optimisation: a Tata
 * CliQ return is visible only to the slave that owns it, and the portal's pick
 * is server-side session state — so a claim without one has nothing to search
 * under, and "never synced" is otherwise invisible until a claim fails.
 */

export const syncTataCliqSlaves = async (
  payload: unknown
): Promise<
  Result<{
    username: string
    slaves: { id: string; name: string; code: string | null }[]
    added: number
    removed: number
  }>
> => {
  const asked = (payload as { username?: unknown })?.username
  const username = typeof asked === 'string' ? asked.trim() : ''

  if (!username) return fail('VALIDATION_ERROR', 'No Tata CliQ account was given')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to sync slaves')

  // Takes the lock like any other browser work. While a run holds a signed-in
  // Tata CliQ page this borrows it and opens nothing.
  return withAutomationLock('tatacliq-slave-sync', async () => {
    let swept: Awaited<ReturnType<typeof sweepTataCliqSlaves>>

    try {
      swept = await sweepTataCliqSlaves(username)
    } catch (error) {
      return fail(
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Could not read the slaves from Tata CliQ'
      )
    }

    if (swept.slaves.length === 0) {
      // Refused rather than written, exactly as the BE route refuses one: zero
      // slaves means the sweep found nothing, and storing [] would leave a
      // credential that cannot file anything at all.
      return fail(
        'INTERNAL_ERROR',
        `Tata CliQ returned no slaves for ${username}. The stored list is unchanged — ` +
          're-capture the login and try again.'
      )
    }

    const stored = await apiRequest<{
      username: string
      slaves: { id: string; name: string; code: string | null }[]
      added: number
      removed: number
    }>('/cms/tatacliq/sync-slaves', {
      method: 'POST',
      token,
      body: { username, slaves: swept.slaves }
    })

    if (!stored.success) return stored

    // The local copy is what the claim runner reads its slaves from, so it has
    // to catch up now rather than at the next Sync — otherwise the button
    // reports success and the claims carry on refusing.
    await refreshCompany()

    logger.info(
      `[tatacliq-slaves] ${username}: ${stored.data.slaves.length} slave(s)` +
        (swept.reused ? ' (no sign-in needed)' : '') +
        (stored.data.added > 0 ? `, ${stored.data.added} new` : '')
    )

    return ok(stored.data)
  })
}
