import type { Result } from '@shared/types/result'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { withOfflineCache } from './offlineCache'

/**
 * The company's settings, cached so the app keeps working offline.
 *
 * This is the record everything else is derived from: which platforms run on
 * this machine (`desktopExecution`), which flow they use
 * (`apiBasedAutomation`), when master import runs, and whether a session
 * re-capture signs in by script. Read once at sign-in and on every Sync, so a
 * machine that loses the network keeps behaving the way it was configured to
 * rather than falling back to defaults.
 *
 * That last point is the reason this is cached at all. An unreachable backend
 * would otherwise mean "no routing information", and a routing helper that
 * fails closed would quietly stop processing claims on a machine that was
 * configured to process them.
 */

export interface CompanyInfo {
  desktopExecution: Record<string, Record<string, boolean>>
  apiBasedAutomation: Record<string, Record<string, boolean>>
  isAutoLoginOnActiveSession: Record<string, boolean>
  masterImportSyncTime: string | null
  masterImportSyncTimes: Record<string, string | null>
  masterImportPlatforms: string[]
  platformAutomations: Record<string, string[]>
}

export const companyInfo = async (): Promise<Result<CompanyInfo>> => {
  const token = getAccessToken()

  if (!token) {
    // Not an error worth caching around: there is nothing to fetch until
    // someone signs in.
    return apiRequest<CompanyInfo>('/cms/automation-routing', { token: '' })
  }

  return withOfflineCache('company-info', () =>
    apiRequest<CompanyInfo>('/cms/automation-routing', { token })
  )
}
