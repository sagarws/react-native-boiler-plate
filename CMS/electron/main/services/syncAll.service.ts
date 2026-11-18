import { ok, type Result } from '@shared/types/result'
import { cacheSummary } from './offlineCache'
import { sessionHealth } from './platformSession.service'
import { dashboardSnapshot } from './dashboard.service'
import { refreshSchedule } from './importScheduler.service'
import { clearRoutingCache } from './automationRouting.service'
import { cmsCounts } from './cmsList.service'
import { companyInfo } from './companyInfo.service'
import { refreshCompany } from './company.service'
import { requestQueueCheckNow } from './masterImportQueue.service'
import { logger } from './logger'

/**
 * Re-reads everything this app keeps a local copy of.
 *
 * The offline cache only refills as a side effect of a screen being opened, so
 * a machine about to go offline could easily hold a fresh dashboard and a
 * week-old credential list. This is the deliberate "top everything up" the
 * Settings page offers before someone disconnects.
 *
 * Each read is independent and failures are counted rather than thrown: three
 * of four resources refreshing is a better outcome than none, and the operator
 * is told how many succeeded.
 */

export interface SyncAllResult {
  refreshed: number
  failed: number
  /** Resource → when it was last successfully fetched. */
  cachedAt: { key: string; fetchedAt: string }[]
}

export const syncAll = async (): Promise<Result<SyncAllResult>> => {
  // The routing cache is in memory with its own TTL; without clearing it a
  // "sync now" could return an answer up to a minute old and look broken.
  clearRoutingCache()

  const tasks: [string, () => Promise<Result<unknown>>][] = [
    // Company info first: routing and the schedule are read from it, and the
    // rest of this list is more useful once it is current.
    // The whole document first: everything else is derived from it, and a Sync
    // that refreshed the derived views but not their source would leave the
    // machine reading yesterday's credentials through today's routing.
    ['company', refreshCompany],
    ['company info', companyInfo],
    ['login health', sessionHealth],
    ['dashboard', dashboardSnapshot],
    ['import schedule', refreshSchedule],
    ['claim counts', () => cmsCounts({})]
  ]

  let refreshed = 0
  let failed = 0

  for (const [label, run] of tasks) {
    const response = await run()

    if (response.success) {
      refreshed += 1
    } else {
      failed += 1
      logger.warn(`Sync-all could not refresh ${label}: ${response.error.message}`)
    }
  }

  // A requested report may have finished building since the last interval;
  // someone pressing Sync is asking for exactly that check.
  requestQueueCheckNow()

  return ok({ refreshed, failed, cachedAt: await cacheSummary() })
}

export const cacheStatus = async (): Promise<Result<{ key: string; fetchedAt: string }[]>> =>
  ok(await cacheSummary())
