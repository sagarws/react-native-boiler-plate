import { BULK_SPF_CHANNELS, BULK_SPF_EVENTS } from '@shared/constants/channels'
import type {
  PobFillSummary,
  BulkClaimType,
  BulkJobPage,
  BulkJobReport,
  BulkSpfPlan,
  BulkSpfRun,
  BulkSpfUpload
} from '@shared/types/bulkSpf'
import type { Result } from '@shared/types/result'
import type { BulkRetryScope } from '@shared/utils/bulkRetry'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the AJIO bulk claim channels. */

/**
 * Fill the POB ID on a sheet that only carries return AWBs.
 *
 * Resolves with what it managed to fill and where the filled copy was written
 * — never with the rows themselves: the answer is a file the operator uploads
 * next, not a list to render.
 */
export const fillPobIds = (): Promise<Result<PobFillSummary>> =>
  invoke<PobFillSummary>(BULK_SPF_CHANNELS.fillPob, {})

export const chooseBulkFile = (claimType: BulkClaimType): Promise<Result<BulkSpfUpload>> =>
  invoke<BulkSpfUpload>(BULK_SPF_CHANNELS.chooseFile, { claimType })

export const downloadBulkTemplate = (): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(BULK_SPF_CHANNELS.downloadTemplate)

/** Every row of the uploads, sorted, for the Selected Proceed review. Files nothing. */
export const planBulkRun = (uploads: BulkSpfUpload[]): Promise<Result<BulkSpfPlan>> =>
  invoke<BulkSpfPlan>(BULK_SPF_CHANNELS.plan, { uploads })

/**
 * Files the uploads in the background. `selectedKeys` — ticked in the review —
 * limits it to those; without it every claimable row is filed.
 */
export const startBulkRun = (
  uploads: BulkSpfUpload[],
  selectedKeys?: string[]
): Promise<Result<BulkSpfRun>> =>
  invoke<BulkSpfRun>(BULK_SPF_CHANNELS.start, selectedKeys ? { uploads, selectedKeys } : { uploads })

/**
 * Re-files the last run's failed and/or skipped rows into that same run — one
 * combined result across every attempt, not a new job per try.
 */
export const retryFailedBulkRun = (scope: BulkRetryScope, jobId?: string): Promise<Result<BulkSpfRun>> =>
  invoke<BulkSpfRun>(BULK_SPF_CHANNELS.retryFailed, { scope, ...(jobId ? { jobId } : {}) })

/** This company's bulk-claim jobs, newest first — from TrackVid. */
export const bulkJobHistory = (page = 1): Promise<Result<BulkJobPage>> =>
  invoke<BulkJobPage>(BULK_SPF_CHANNELS.history, { page })

/** One job's report — the counts and its Failed / Help Center Failed lines. */
export const bulkJobReport = (jobId: string): Promise<Result<BulkJobReport>> =>
  invoke<BulkJobReport>(BULK_SPF_CHANNELS.historyJob, { jobId })

/** Saves one job's .xlsx (Success and Failed sheets) where the operator chooses. */
export const downloadBulkJobReport = (
  jobId: string
): Promise<Result<{ path: string; tickets: number; failed: number }>> =>
  invoke<{ path: string; tickets: number; failed: number }>(BULK_SPF_CHANNELS.downloadJobReport, { jobId })

export const bulkRunStatus = (): Promise<Result<BulkSpfRun | null>> =>
  invoke<BulkSpfRun | null>(BULK_SPF_CHANNELS.status)

export const openBulkReport = (): Promise<Result<null>> =>
  invoke<null>(BULK_SPF_CHANNELS.openReport)

/**
 * Follows a run.
 *
 * A bulk claim runs for hours and nobody is going to sit polling it, so the
 * main process pushes every article as it finishes.
 */
export const onBulkProgress = (listener: (run: BulkSpfRun) => void): (() => void) =>
  subscribe(BULK_SPF_EVENTS.progress, payload => listener(payload as BulkSpfRun))
