import { CMS_LIST_CHANNELS } from '@shared/constants/channels'
import { cmsCounts, listCms } from '../services/cmsList.service'
import { bulkFieldOptions, bulkUpdateClaims } from '../services/cmsBulkUpdate.service'
import { exportClaims } from '../services/claimExport.service'
import { updateClaimTicket } from '../services/cmsTicket.service'
import { retryDriveConversion } from '../services/cmsDriveRetry.service'
import { registerHandler } from './handler'

export const registerCmsListIpc = (): void => {
  registerHandler(CMS_LIST_CHANNELS.list, payload => listCms(payload))
  registerHandler(CMS_LIST_CHANNELS.counts, payload => cmsCounts(payload))
  registerHandler(CMS_LIST_CHANNELS.bulkFields, () => bulkFieldOptions())
  registerHandler(CMS_LIST_CHANNELS.bulkUpdate, payload => bulkUpdateClaims(payload))
  registerHandler(CMS_LIST_CHANNELS.updateTicket, payload => updateClaimTicket(payload))
  registerHandler(CMS_LIST_CHANNELS.retryDrive, payload => retryDriveConversion(payload))
  registerHandler(CMS_LIST_CHANNELS.exportXlsx, payload => exportClaims(payload))
}
