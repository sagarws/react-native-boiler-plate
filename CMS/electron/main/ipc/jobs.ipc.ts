import { JOB_CHANNELS } from '@shared/constants/channels'
import { clearJobs, downloadJobReport, jobDetail, listJobs } from '../services/jobs.service'
import { registerHandler } from './handler'

export const registerJobsIpc = (): void => {
  registerHandler(JOB_CHANNELS.list, () => listJobs())
  registerHandler(JOB_CHANNELS.detail, jobDetail)
  registerHandler(JOB_CHANNELS.downloadReport, downloadJobReport)
  registerHandler(JOB_CHANNELS.clear, clearJobs)
}
