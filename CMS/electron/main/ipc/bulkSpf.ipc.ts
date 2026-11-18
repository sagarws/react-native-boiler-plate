import { BULK_SPF_CHANNELS } from '@shared/constants/channels'
import {
  bulkRunStatus,
  chooseBulkFile,
  downloadBulkTemplate,
  openBulkReport,
  planBulkRun,
  retryFailedBulkRun,
  startBulkRun
} from '../services/bulkSpf.service'
import { downloadJobReport, jobReport, listBulkJobs } from '../services/bulkSpfJob.service'
import { fillPobIds } from '../services/pobFill.service'
import { registerHandler } from './handler'

export const registerBulkSpfIpc = (): void => {
  registerHandler(BULK_SPF_CHANNELS.chooseFile, chooseBulkFile)
  registerHandler(BULK_SPF_CHANNELS.downloadTemplate, () => downloadBulkTemplate())
  // Fills the POB on a sheet that only carries return AWBs.
  registerHandler(BULK_SPF_CHANNELS.fillPob, fillPobIds)
  registerHandler(BULK_SPF_CHANNELS.plan, planBulkRun)
  registerHandler(BULK_SPF_CHANNELS.start, startBulkRun)
  // `{ scope }` — failed, skipped or both; validated by the service.
  registerHandler(BULK_SPF_CHANNELS.retryFailed, retryFailedBulkRun)
  registerHandler(BULK_SPF_CHANNELS.history, listBulkJobs)
  registerHandler(BULK_SPF_CHANNELS.historyJob, jobReport)
  registerHandler(BULK_SPF_CHANNELS.downloadJobReport, downloadJobReport)
  registerHandler(BULK_SPF_CHANNELS.status, () => bulkRunStatus())
  registerHandler(BULK_SPF_CHANNELS.openReport, () => openBulkReport())
}
