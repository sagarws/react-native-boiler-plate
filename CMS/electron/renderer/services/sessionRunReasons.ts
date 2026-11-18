import type { JobRow } from '@shared/types/jobs'
import { rowsToReasons } from '@shared/utils/sessionRunReasons'
import { jobDetail, listJobs } from './jobs.service'

/**
 * Why the last Login update could not fix each account.
 *
 * The join itself is `shared/utils/sessionRunReasons`; this is the half that
 * has to ask the main process for the run. Best effort throughout: it
 * decorates a board that is already correct without it, so a job list that
 * cannot be read costs a sentence, not the view.
 */

/** The label the Login update task archives its scheduled run under. */
const SESSION_RUN_LABELS = ['login update', 'session update', 'session refresh']

const isSessionRun = (job: JobRow): boolean =>
  job.kind === 'scheduled-run' && SESSION_RUN_LABELS.includes(job.label.trim().toLowerCase())

export const lastSessionFailures = async (): Promise<Record<string, string>> => {
  try {
    const jobs = await listJobs()

    if (!jobs.success) return {}

    // The newest first — the list is already in that order, and an older run's
    // reasons would describe accounts that have since been fixed.
    const run = jobs.data.find(isSessionRun)

    if (!run) return {}

    const detail = await jobDetail(run.jobId, run.kind)

    return detail.success ? rowsToReasons(detail.data) : {}
  } catch {
    return {}
  }
}
