import { JOB_CHANNELS } from '@shared/constants/channels'
import type { JobDetail, JobKind, JobRow } from '@shared/types/jobs'
import type { Result } from '@shared/types/result'
import { invoke } from './ipcClient'

/** Renderer-side wrapper over the job history channels. */

export const listJobs = (): Promise<Result<JobRow[]>> => invoke<JobRow[]>(JOB_CHANNELS.list)

/** `kind` comes from the row that was clicked, so the right store is read first. */
export const jobDetail = (jobId: string, kind: JobKind): Promise<Result<JobDetail>> =>
  invoke<JobDetail>(JOB_CHANNELS.detail, { jobId, kind })

/** Saves this job's Succeeded and Failed lists as a workbook. */
export const downloadJobReport = (
  jobId: string,
  kind: JobKind
): Promise<Result<{ path: string; succeeded: number; failed: number }>> =>
  invoke<{ path: string; succeeded: number; failed: number }>(JOB_CHANNELS.downloadReport, {
    jobId,
    kind
  })

/**
 * Throw away the history for one kind of run, or for all of them.
 *
 * `kind` is what the page is filtered to, so what goes is what is on screen.
 * The count comes back because "cleared" over an already-empty list reads as a
 * failure, and because a bulk run this company did on another machine comes
 * from TrackVid rather than this archive — it will still be there afterwards,
 * and the number is what makes that make sense.
 */
export const clearJobs = (kind: JobKind | 'all'): Promise<Result<{ cleared: number }>> =>
  invoke<{ cleared: number }>(JOB_CHANNELS.clear, { kind })
