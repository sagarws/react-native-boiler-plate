import { MASTER_REPORT_CHANNELS } from '@shared/constants/channels'
import type {
  AjioReturnOrderLookup,
  ReportAccount,
  ReportPage,
  ReportType
} from '@shared/types/masterDataReport'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/** Renderer-side wrapper over the "Check master data" channels. A read, throughout. */

export const reportAccounts = (): Promise<Result<ReportAccount[]>> =>
  invoke<ReportAccount[]>(MASTER_REPORT_CHANNELS.accounts)

export const reportPage = (query: {
  reportType: ReportType
  username: string
  from: string
  to: string
  page: number
  size: number
  /** A subset of the account's POBs. Empty means all of them. */
  pobIds: string[]
}): Promise<Result<ReportPage>> => invoke<ReportPage>(MASTER_REPORT_CHANNELS.page, query)

/**
 * Sweeps one AJIO account's places of business and stores them.
 *
 * Slow — it may sign in — and it takes the automation lock, so the caller
 * should show it running.
 */
export const syncAjioPobs = (
  username: string
): Promise<Result<{ username: string; pobIds: string[]; added: number; removed: number }>> =>
  invoke(MASTER_REPORT_CHANNELS.syncPobs, { username })

/**
 * Sweeps one Tata CliQ account's slaves and stores them.
 *
 * Slow — it may sign in, which on Tata CliQ costs an emailed OTP — and it takes
 * the automation lock, so the caller should show it running.
 */
export const syncTataCliqSlaves = (
  username: string
): Promise<
  Result<{
    username: string
    slaves: { id: string; name: string; code: string | null }[]
    added: number
    removed: number
  }>
> => invoke(MASTER_REPORT_CHANNELS.syncSlaves, { username })

/**
 * Re-reads one Delhivery login's "Domestic" accounts and stores them. One HTTP
 * call with the stored session — no browser, no sign-in.
 */
export const syncDelhiveryDomestics = (
  username: string
): Promise<
  Result<{
    username: string
    domestics: { id: string; name: string; serviceType: string | null }[]
    added: number
    removed: number
  }>
> => invoke(MASTER_REPORT_CHANNELS.syncDomestics, { username })

/**
 * Every line of one AJIO return order, found across the last five 31-day
 * windows. Slow — it may sign in, and asks AJIO up to five times — and it takes
 * the automation lock, so the caller should show it running.
 */
/** Tell the main process which source is selected, so the terminal shows it. */
export const noteLookupSource = (source: 'api' | 'report'): void => {
  void invoke<true>(MASTER_REPORT_CHANNELS.lookupSourceChanged, { source })
}

export const ajioReturnOrder = (
  username: string,
  returnOrderNo: string,
  /** Where to read from — the Create Claim header toggle. Defaults to AJIO. */
  source: 'api' | 'report' = 'api'
): Promise<Result<AjioReturnOrderLookup>> =>
  invoke<AjioReturnOrderLookup>(MASTER_REPORT_CHANNELS.returnOrder, {
    username,
    returnOrderNo,
    source
  })
