import { MASTER_REPORT_CHANNELS } from '@shared/constants/channels'
import {
  noteLookupSource,
  reportAccounts,
  reportPage,
  returnOrderLookup
} from '../services/masterDataReport.service'
import { syncAjioPobs } from '../services/ajioPobSync.service'
import { syncTataCliqSlaves } from '../services/tatacliqSlaveSync.service'
import { syncDelhiveryDomestics } from '../services/delhiveryDomesticSync.service'
import { registerHandler } from './handler'

export const registerMasterReportIpc = (): void => {
  registerHandler(MASTER_REPORT_CHANNELS.accounts, () => reportAccounts())
  registerHandler(MASTER_REPORT_CHANNELS.page, reportPage)
  registerHandler(MASTER_REPORT_CHANNELS.syncPobs, syncAjioPobs)
  registerHandler(MASTER_REPORT_CHANNELS.syncSlaves, syncTataCliqSlaves)
  registerHandler(MASTER_REPORT_CHANNELS.syncDomestics, (payload: unknown) => {
    const asked = (payload as { username?: unknown })?.username

    return syncDelhiveryDomestics(typeof asked === 'string' ? asked : '')
  })
  registerHandler(MASTER_REPORT_CHANNELS.returnOrder, returnOrderLookup)
  // The toggle, so the terminal shows which source is selected.
  registerHandler(MASTER_REPORT_CHANNELS.lookupSourceChanged, noteLookupSource)
}
