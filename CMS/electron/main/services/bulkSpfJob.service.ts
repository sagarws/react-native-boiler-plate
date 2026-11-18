import { app, dialog } from 'electron'
import { attemptOf } from '@shared/types/bulkSpf'
import { join } from 'node:path'
import type {
  BulkJobArchive,
  BulkJobDetail,
  BulkJobFailedAwb,
  BulkJobPage,
  BulkJobReport,
  BulkSpfResultRow,
  BulkSpfRun
} from '@shared/types/bulkSpf'
import { fail, ok, type Result } from '@shared/types/result'
import { loadCore } from '@main/automations/common/coreLoader'
import { apiRequest } from './httpClient'
import { getAccessToken } from './session.store'
import { readJobArchive } from './bulkSpfArchive.store'
import { logger } from './logger'

/**
 * The bulk claim's job record in TrackVid — `scriptjobs`, jobType AJIO_BULK_CLAIM.
 *
 * TrackVid-BE's `/cms/desktop-bulk-jobs` endpoints, scoped to the operator's
 * company by their token. The run's own id is the job id.
 *
 * BEST EFFORT, every write. The claims are filed on AJIO whether or not TrackVid
 * heard about it, so a lost connection must never stop a run — it costs the
 * job its history entry, which the run records as `jobRecorded: false`.
 *
 * The heartbeat matters: TrackVid's scheduler marks a RUNNING job STALE after
 * two minutes without one. `fileClaims` calls `reportBulkJob` every 30 seconds.
 */

/** Outcomes that mean "this AWB was not filed" — what History lists per job. */
const NOT_FILED = new Set(['Failed', 'Help Center Failed', 'Not Claimable', 'Skipped'])

/** TrackVid keeps at most this many per job; the report file has the rest. */
const MAX_FAILED_AWBS = 5000

const counts = (run: BulkSpfRun) => ({
  totalAwbs: run.rows.length,
  processedAwbs: run.done,
  successCount: run.summary.success,
  // Help Center Failed is already inside `failed`; Not Claimable is not.
  failedCount: run.summary.failed + run.summary.notClaimable,
  skippedCount: run.summary.skipped
})

const failedAwbs = (rows: BulkSpfResultRow[]): BulkJobFailedAwb[] =>
  rows
    .filter(row => NOT_FILED.has(row.result))
    .slice(0, MAX_FAILED_AWBS)
    .map(row => ({
      awb: row.awb,
      sku: row.sku,
      claimType: row.claimType,
      pobid: row.pobid ?? '',
      result: row.result,
      error: row.error || row.reason,
      ticketNumber: row.ticketNumber,
      attempt: attemptOf(row)
    }))

/** Creates the job. Returns whether TrackVid now has it. */
export const createBulkJob = async (run: BulkSpfRun): Promise<boolean> => {
  const token = getAccessToken()

  if (!token) return false

  const response = await apiRequest('/cms/desktop-bulk-jobs', {
    method: 'POST',
    token,
    body: {
      jobId: run.id,
      ...counts(run),
      fileNames: run.uploads.map(upload => `${upload.claimType}: ${upload.fileName}`),
      accounts: run.accounts
    }
  })

  if (!response.success) {
    logger.warn(`[bulk-spf] job ${run.id} was not recorded in TrackVid: ${response.error.message}`)
  }

  return response.success
}

/**
 * Progress, heartbeat, or — with `final` — the finished job and every AWB it did
 * not file. Never throws.
 */
export const reportBulkJob = async (run: BulkSpfRun, final = false): Promise<void> => {
  const token = getAccessToken()

  if (!token || !run.jobRecorded) return

  try {
    const response = await apiRequest(`/cms/desktop-bulk-jobs/${encodeURIComponent(run.id)}`, {
      method: 'PATCH',
      token,
      body: {
        ...counts(run),
        accounts: run.accounts,
        ...(final
          ? {
              status: run.status === 'failed' ? 'FAILED' : 'COMPLETED',
              error: run.error ?? '',
              failedAwbs: failedAwbs(run.rows)
            }
          : {})
      }
    })

    if (!response.success) {
      logger.warn(`[bulk-spf] job ${run.id} ${final ? 'result' : 'heartbeat'} not saved: ${response.error.message}`)
    }
  } catch (error) {
    logger.warn(`[bulk-spf] job ${run.id} ${final ? 'result' : 'heartbeat'} not saved`, error)
  }
}

/**
 * Puts a finished job back to RUNNING for a "Retry failed" pass. The retry files
 * into the same job, so History keeps one entry with the combined counts rather
 * than one per attempt. Never throws.
 */
export const reopenBulkJob = async (run: BulkSpfRun): Promise<void> => {
  const token = getAccessToken()

  if (!token || !run.jobRecorded) return

  try {
    const response = await apiRequest(`/cms/desktop-bulk-jobs/${encodeURIComponent(run.id)}`, {
      method: 'PATCH',
      token,
      body: { ...counts(run), accounts: run.accounts, status: 'RUNNING', error: '' }
    })

    if (!response.success) {
      logger.warn(`[bulk-spf] job ${run.id} was not reopened for the retry: ${response.error.message}`)
    }
  } catch (error) {
    logger.warn(`[bulk-spf] job ${run.id} was not reopened for the retry`, error)
  }
}

export const listBulkJobs = async (payload: unknown): Promise<Result<BulkJobPage>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see bulk claim history')

  const page = Math.max(1, Math.floor(Number((payload as { page?: unknown })?.page) || 1))

  return apiRequest<BulkJobPage>(`/cms/desktop-bulk-jobs?page=${page}&limit=20`, { method: 'GET', token })
}

const jobIdOf = (payload: unknown): string | null => {
  const jobId = (payload as { jobId?: unknown })?.jobId

  return typeof jobId === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(jobId) ? jobId : null
}

const fetchJob = async (jobId: string): Promise<Result<BulkJobDetail>> => {
  const token = getAccessToken()

  if (!token) return fail('VALIDATION_ERROR', 'Sign in to see bulk claim history')

  return apiRequest<BulkJobDetail>(`/cms/desktop-bulk-jobs/${encodeURIComponent(jobId)}`, {
    method: 'GET',
    token
  })
}

/** The server's report lists at most this many failures in the message. */
const MESSAGE_FAILED_LINES = 20

const isFailedLine = (result: string): boolean => result === 'Failed' || result === 'Help Center Failed'

/**
 * One job's report for History. Pure, exported for tests.
 *
 * From this machine's archive when it ran the job — that copy has every row and
 * the input count. Otherwise from TrackVid's record, which holds the counts and
 * the AWBs that were not filed but no tickets; `source` says which.
 */
export const reportOf = (archive: BulkJobArchive | null, job: BulkJobDetail | null): BulkJobReport | null => {
  if (archive) {
    const failed = archive.unfiled.filter(row => isFailedLine(row.result))

    return {
      jobId: archive.jobId,
      // TrackVid's status wins when there is one: it is the only side that can
      // say a job stopped responding.
      status: job?.status ?? (archive.status === 'failed' ? 'FAILED' : 'COMPLETED'),
      startedAt: archive.startedAt,
      finishedAt: archive.finishedAt,
      inputAwbs: archive.inputAwbs,
      claimRows: archive.claimRows,
      success: archive.summary.success,
      failed: archive.summary.failed,
      notClaimable: archive.summary.notClaimable,
      skipped: archive.summary.skipped,
      pending: archive.summary.pending,
      failedLines: failed
        .slice(0, MESSAGE_FAILED_LINES)
        .map(row => ({ awb: row.awb, sku: row.sku, result: row.result, reason: row.reason })),
      failedTotal: failed.length,
      source: 'local'
    }
  }

  if (!job) return null

  const count = (result: string): number => job.failedAwbs.filter(row => row.result === result).length
  const failed = job.failedAwbs.filter(row => isFailedLine(row.result))

  return {
    jobId: job.jobId,
    status: job.status,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    inputAwbs: null,
    claimRows: job.totalAwbs,
    success: job.successCount,
    failed: count('Failed') + count('Help Center Failed'),
    notClaimable: count('Not Claimable'),
    skipped: count('Skipped'),
    pending: Math.max(0, job.totalAwbs - job.successCount - job.failedAwbs.length),
    failedLines: failed
      .slice(0, MESSAGE_FAILED_LINES)
      .map(row => ({ awb: row.awb, sku: row.sku, result: row.result, reason: row.error })),
    failedTotal: failed.length,
    source: 'trackvid'
  }
}

/** History → one job: its report message. */
export const jobReport = async (payload: unknown): Promise<Result<BulkJobReport>> => {
  const jobId = jobIdOf(payload)

  if (!jobId) return fail('VALIDATION_ERROR', 'That is not a job id')

  const [archive, remote] = await Promise.all([readJobArchive(jobId), fetchJob(jobId)])
  const report = reportOf(archive, remote.success ? remote.data : null)

  if (report) return ok(report)

  return remote.success ? fail('NOT_FOUND', 'No report for that job') : fail(remote.error.code, remote.error.message)
}

/**
 * History → one job → .xlsx: a "Success" sheet (Return AWB, SKU, ticket) and a
 * "Failed" sheet (Return AWB, SKU, reason), saved where the operator chooses.
 *
 * Tickets come from this machine's archive. For a job run elsewhere the Success
 * sheet is empty and the Failed sheet comes from TrackVid.
 */
export const downloadJobReport = async (payload: unknown): Promise<Result<{ path: string; tickets: number; failed: number }>> => {
  const jobId = jobIdOf(payload)

  if (!jobId) return fail('VALIDATION_ERROR', 'That is not a job id')

  const archive = await readJobArchive(jobId)
  let failed: { awb: string; sku: string; reason: string }[]

  if (archive) {
    failed = archive.unfiled.map(row => ({
      awb: row.awb,
      sku: row.sku,
      reason: row.reason ? `${row.result}: ${row.reason}` : row.result
    }))
  } else {
    const remote = await fetchJob(jobId)

    if (!remote.success) return fail(remote.error.code, remote.error.message)

    failed = remote.data.failedAwbs.map(row => ({
      awb: row.awb,
      sku: row.sku,
      reason: row.error ? `${row.result}: ${row.error}` : row.result
    }))
  }

  const success = (archive?.tickets ?? []).map(row => ({
    awb: row.awb,
    sku: row.sku,
    ticketId: row.ticketId
  }))

  const day = new Date().toISOString().slice(0, 10)
  const chosen = await dialog.showSaveDialog({
    title: `Save the report for job ${jobId.slice(0, 8)}`,
    defaultPath: join(app.getPath('downloads'), `ajio-bulk-claim-${jobId.slice(0, 8)}-${day}.xlsx`),
    filters: [{ name: 'Spreadsheets', extensions: ['xlsx'] }]
  })

  if (chosen.canceled || !chosen.filePath) return fail('VALIDATION_ERROR', 'Cancelled')

  try {
    const { writeTicketReport } = loadCore<{
      writeTicketReport: (path: string, rows: { success: typeof success; failed: typeof failed }) => string
    }>('platforms/ajio/claim-management/api-based-flow/bulkSpfExcel')

    writeTicketReport(chosen.filePath, { success, failed })

    return ok({ path: chosen.filePath, tickets: success.length, failed: failed.length })
  } catch (error) {
    return fail('INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
  }
}
