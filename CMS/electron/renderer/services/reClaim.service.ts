import { RE_CLAIM_CHANNELS, RE_CLAIM_EVENTS } from '@shared/constants/channels'
import type {
  ReClaimProgress,
  ReClaimResult,
  ReClaimSheet,
  ReClaimTicket
} from '@shared/types/reClaim'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the re-claim channels. */

export const chooseReClaimSheet = (): Promise<Result<ReClaimSheet>> =>
  invoke<ReClaimSheet>(RE_CLAIM_CHANNELS.chooseFile)

/** Saves the blank rejection export — the columns `chooseReClaimSheet` reads. */
export const downloadReClaimTemplate = (): Promise<Result<{ path: string }>> =>
  invoke<{ path: string }>(RE_CLAIM_CHANNELS.downloadTemplate)

export const reClaimAccounts = (): Promise<Result<string[]>> =>
  invoke<string[]>(RE_CLAIM_CHANNELS.accounts)

/** What Myntra currently holds for a ticket. A read; nothing is changed. */
export const reClaimTicket = (ticketId: string, username: string): Promise<Result<ReClaimTicket>> =>
  invoke<ReClaimTicket>(RE_CLAIM_CHANNELS.ticket, { ticketId, username })

/** Reopens one ticket and reads it back. */
export const submitReClaim = (input: {
  ticketId: string
  description: string
  issueCategory: string
  username: string
}): Promise<Result<ReClaimResult>> => invoke<ReClaimResult>(RE_CLAIM_CHANNELS.submit, input)

/**
 * Starts a run and returns its job id. Does NOT wait for it.
 *
 * A run of several hundred takes hours — the gap between tickets is deliberate,
 * not overhead. It used to be awaited, which made whichever window started it
 * the run's owner; now the main process owns it, progress arrives on
 * `onReClaimProgress`, and the outcome is read back on the Jobs page.
 */
export const startBulkReClaim = (input: {
  /** `description` is the row's own argument — the sheet's "RR Remarks". */
  tickets: { ticketId: string; description: string; issueCategory: string }[]
  username: string
  source: 'file' | 'manual'
  /** The sheet's path, for the job record. Null for rows typed in. */
  fileName?: string | null
}): Promise<Result<{ jobId: string }>> =>
  invoke<{ jobId: string }>(RE_CLAIM_CHANNELS.bulk, input)

/** Rows typed into the app — validated in the main process, same sheet back. */
export const manualReClaimRows = (
  rows: { ticketId: string; description: string; issueCategory: string }[]
): Promise<Result<ReClaimSheet>> => invoke<ReClaimSheet>(RE_CLAIM_CHANNELS.manualRows, { rows })

export const reClaimProgress = (): Promise<Result<ReClaimProgress | null>> =>
  invoke<ReClaimProgress | null>(RE_CLAIM_CHANNELS.bulkStatus)

/** Ends the run after the ticket in flight — never mid-dispute. */
export const stopReClaim = (): Promise<Result<{ stopping: boolean }>> =>
  invoke(RE_CLAIM_CHANNELS.stop)

export const onReClaimProgress = (listener: (progress: ReClaimProgress) => void): (() => void) =>
  subscribe(RE_CLAIM_EVENTS.progress, payload => listener(payload as ReClaimProgress))
