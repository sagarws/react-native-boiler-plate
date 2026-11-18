import { fail, ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { refreshCompany } from './company.service'
import { sweepDelhiveryDomestics } from '../automations/platforms/delhivery/common/domesticSync'
import { logger } from './logger'

/**
 * Keeps one Delhivery login's "Domestic" list current, from this machine.
 *
 * Same shape as `syncAjioPobs` and `syncTataCliqSlaves`: read the list from the
 * marketplace, post it to `/cms/delhivery/sync-domestics`, which stores it on
 * the credential in `eCommercePlatformLoginInfo`, then refresh the local company
 * copy so the claim form sees it at once.
 *
 * Run automatically after every Delhivery session update (see
 * SESSION_FOLLOW_UPS in the automation registry). An empty answer is never
 * written: it would wipe a working list on a transient failure, and the form
 * falls back to EXPRESS / SURFACE when there is no list anyway.
 */

export type DomesticSyncResult = {
  username: string
  domestics: { id: string; name: string; serviceType: string | null }[]
  added: number
  removed: number
}

export const syncDelhiveryDomestics = async (username: string): Promise<Result<DomesticSyncResult>> => {
  const name = username.trim()

  if (!name) return fail('VALIDATION_ERROR', 'No Delhivery account was given')

  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to sync the Delhivery Domestic list')

  let swept: Awaited<ReturnType<typeof sweepDelhiveryDomestics>>

  try {
    // A server-side renewal stores the new token on TrackVid, not here — read
    // it back first, or the sweep would use the token it just replaced.
    await refreshCompany()
    swept = await sweepDelhiveryDomestics(name)
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : 'Could not read the Domestic list from Delhivery')
  }

  if (swept.length === 0) {
    return fail(
      'INTERNAL_ERROR',
      `Delhivery returned no Domestic accounts for ${name}. The stored list is unchanged.`
    )
  }

  const stored = await apiRequest<DomesticSyncResult>('/cms/delhivery/sync-domestics', {
    method: 'POST',
    token,
    body: { username: name, domestics: swept }
  })

  if (!stored.success) return stored

  // The local copy is what the claim form reads, so it catches up now.
  await refreshCompany()

  logger.info(
    `[delhivery-domestics] ${name}: ${stored.data.domestics.length} Domestic account(s)` +
      (stored.data.added > 0 ? `, ${stored.data.added} new` : '')
  )

  return ok(stored.data)
}
