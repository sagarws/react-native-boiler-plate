import { PLATFORMS, getPlatform } from '@trackvid/automation-core/common/platforms'
import type { DashboardSnapshot, PlatformSummary } from '@shared/types/dashboard'
import type { SessionHealth } from '@shared/types/platformSession'
import { healthOf } from '@shared/utils/sessionHealth'
import { ok, type Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { sessionHealth } from './platformSession.service'
import { listClaims } from './claimQueue.service'
import { logger } from './logger'
import { withOfflineCache } from './offlineCache'

/**
 * One snapshot for the dashboard, assembled from three sources.
 *
 * Claim counts come from POST /cms/counts — the endpoint the web CMS already
 * uses. It reports totals per platform and totals per status as two separate
 * aggregations, so a per-platform status breakdown means calling it once more
 * per platform with an eCommercePlatform filter. That is a handful of requests
 * on a manually refreshed screen, and it is the alternative to adding an
 * endpoint for a view that is meant to be read-only.
 *
 * A failure in one source does not empty the dashboard: whatever loaded is
 * returned, and `errors` names what did not, so a blank card is never mistaken
 * for a real zero.
 */

/** Only the statuses worth a row on a card; the rest are folded into the total. */
const INTERESTING_STATUS = (status: string): boolean => status !== 'All'

interface CountsResponse {
  statusCounts?: Record<string, number>
  platformCounts?: Record<string, number>
  /** Added to /cms/counts later; absent on an older server. */
  compensationTotal?: number
}

/** Worst of a set of session states — what a card should warn about. */
const worstOf = (healths: SessionHealth[]): SessionHealth | null => {
  if (healths.length === 0) return null
  // `rejected` leads: it is the only one the marketplace itself has confirmed,
  // and a card that ranked it below an expiry date would bury the one state
  // nobody can talk themselves out of.
  const order: SessionHealth[] = ['rejected', 'expired', 'none', 'expiring', 'active']

  return order.find(state => healths.includes(state)) ?? null
}

export const dashboardSnapshot = async (): Promise<Result<DashboardSnapshot>> =>
  withOfflineCache('dashboard', fetchDashboard)

const fetchDashboard = async (): Promise<Result<DashboardSnapshot>> => {
  const token = getAccessToken()

  if (!token) {
    return ok({
      platforms: [],
      totals: { claims: 0, credentials: 0, sessionsNeedingAttention: 0, queuedLocally: 0, recovered: null },
      generatedAt: new Date().toISOString(),
      errors: ['Not signed in']
    })
  }

  const errors: string[] = []

  // Session health tells us which platforms this company actually has, so the
  // per-platform count calls below are made only for those.
  const health = await sessionHealth()

  if (!health.success) errors.push(`Sessions: ${health.error.message}`)

  const present = (health.success ? health.data : []).filter(
    entry => entry.credentials.length > 0
  )

  const queued = await listClaims().catch(error => {
    logger.warn('Dashboard could not read the local claim queue', error)
    errors.push('Local claim queue could not be read')

    return []
  })

  // One filtered call per platform the company has. Run together — they are
  // independent reads and a serial loop would make the dashboard feel slow for
  // no reason.
  const counts = await Promise.all(
    present.map(async entry => {
      /*
       * The DISPLAY NAME, not the key. The server matches this against the
       * stored platform lowercased — "Tata CliQ" is stored, so it compares
       * against "tata cliq" — and the key "tatacliq" matched nothing: the
       * Dashboard showed Tata CliQ with 0 claims while Manage Claims, which
       * sends the label, listed them. Every other key happens to equal its
       * lowercased label, which is why only Tata CliQ was wrong.
       */
      const meta = getPlatform(entry.platform) ?? PLATFORMS.find(p => p.key === entry.platform)
      const response = await apiRequest<CountsResponse>('/cms/counts', {
        method: 'POST',
        token,
        body: { eCommercePlatform: [meta?.label ?? entry.platform] }
      })

      if (!response.success) {
        errors.push(`${entry.platform} claim counts: ${response.error.message}`)

        return { platform: entry.platform, statusCounts: {}, recovered: null }
      }

      const recovered = response.data?.compensationTotal

      return {
        platform: entry.platform,
        statusCounts: response.data?.statusCounts ?? {},
        // Absent means an older server that cannot say — not zero.
        recovered: typeof recovered === 'number' && Number.isFinite(recovered) ? recovered : null
      }
    })
  )

  const countsByPlatform = new Map(counts.map(entry => [entry.platform, entry.statusCounts]))
  const recoveredByPlatform = new Map(counts.map(entry => [entry.platform, entry.recovered]))

  const platforms: PlatformSummary[] = present.map(entry => {
    const meta = getPlatform(entry.platform) ?? PLATFORMS.find(p => p.key === entry.platform)
    const statusCounts = countsByPlatform.get(entry.platform) ?? {}
    const healths = entry.credentials.map(credential => healthOf(credential.session))

    const syncs = entry.credentials
      .map(credential => credential.masterDataSync)
      .filter((value): value is number => typeof value === 'number' && value > 0)

    return {
      platform: entry.platform,
      label: meta?.label ?? entry.platform,
      // `All` is the server's own total; falling back to a sum of the rest keeps
      // the card honest if that key is ever absent.
      total:
        statusCounts.All ??
        Object.entries(statusCounts)
          .filter(([status]) => INTERESTING_STATUS(status))
          .reduce((sum, [, n]) => sum + n, 0),
      statusCounts: Object.fromEntries(
        Object.entries(statusCounts).filter(([status]) => INTERESTING_STATUS(status))
      ),
      credentials: entry.credentials.length,
      sessionsActive: healths.filter(state => state === 'active').length,
      sessionsNeedingAttention: healths.filter(state => state !== 'active').length,
      worstSession: worstOf(healths),
      lastMasterSync: syncs.length > 0 ? Math.max(...syncs) : null,
      hasMasterImport: (meta?.automations ?? []).includes('masterImport'),
      queuedLocally: queued.filter(claim => claim.platform === entry.platform).length,
      recovered: recoveredByPlatform.get(entry.platform) ?? null
    }
  })

  return ok({
    platforms,
    totals: {
      claims: platforms.reduce((sum, p) => sum + p.total, 0),
      credentials: platforms.reduce((sum, p) => sum + p.credentials, 0),
      sessionsNeedingAttention: platforms.reduce((sum, p) => sum + p.sessionsNeedingAttention, 0),
      queuedLocally: queued.length,
      // Null only when NO platform could say; otherwise the sum of those that did.
      recovered: platforms.some(p => p.recovered !== null)
        ? platforms.reduce((sum, p) => sum + (p.recovered ?? 0), 0)
        : null
    },
    generatedAt: new Date().toISOString(),
    errors
  })
}
