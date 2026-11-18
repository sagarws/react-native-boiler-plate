import { FLIPKART_BACKUP_CHANNELS } from '@shared/constants/channels'
import type {
  FlipkartAccountResult,
  FlipkartAwbMatch,
  FlipkartBackupState,
  FlipkartCardState,
  FlipkartCoverage,
  FlipkartRecord,
  FlipkartReport,
  FlipkartRequestCoverage
} from '@shared/types/flipkartBackup'
import type { Result } from '@shared/types/result'
import type { BackupArchiveExport, BackupArchiveImport } from '@shared/types/backupArchive'
import { invoke } from './ipcClient'

/** Renderer-side wrapper over the Flipkart backup channels. */

type Range = { from: string; to: string }

/** What each report holds, and how many requests are still building. */
export const flipkartBackupState = (): Promise<Result<FlipkartBackupState>> =>
  invoke<FlipkartBackupState>(FLIPKART_BACKUP_CHANNELS.state)

/** The saved rows for an AWB typed into Create Claim, joined across both reports. */
export const lookupFlipkartAwb = (
  awb: string,
  side: 'forward' | 'return'
): Promise<Result<FlipkartAwbMatch | null>> =>
  invoke<FlipkartAwbMatch | null>(FLIPKART_BACKUP_CHANNELS.lookupAwb, { awb, side })

/** What one report holds, month by month and day by day. */
export const flipkartCoverage = (report: FlipkartReport): Promise<Result<FlipkartCoverage>> =>
  invoke<FlipkartCoverage>(FLIPKART_BACKUP_CHANNELS.coverage, { report })

/** One report's request calendar: the days asked for, and the requests themselves. */
export const flipkartRequestCoverage = (report: FlipkartReport): Promise<Result<FlipkartRequestCoverage>> =>
  invoke<FlipkartRequestCoverage>(FLIPKART_BACKUP_CHANNELS.requestCoverage, { report })

/** One month of one report's stored rows. `fetched` says it collected first. */
export const flipkartMonth = (input: {
  year: number
  month: number
  report: FlipkartReport
}): Promise<Result<{ rows: FlipkartRecord[]; fetched: boolean }>> =>
  invoke<{ rows: FlipkartRecord[]; fetched: boolean }>(FLIPKART_BACKUP_CHANNELS.month, input)

/** Rows of one report carrying an order item, an AWB or a SKU. */
export const searchFlipkartBackup = (
  report: FlipkartReport,
  term: string
): Promise<Result<{ hits: FlipkartRecord[]; capped: boolean }>> =>
  invoke<{ hits: FlipkartRecord[]; capped: boolean }>(FLIPKART_BACKUP_CHANNELS.search, { report, term })

/** Ask Flipkart for whole months of one report. Only asks — collecting comes later. */
export const requestFlipkartMonths = (input: {
  username: string
  report: FlipkartReport
  year: number
  fromMonth: number
  toMonth: number
}): Promise<Result<FlipkartAccountResult>> =>
  invoke<FlipkartAccountResult>(FLIPKART_BACKUP_CHANNELS.request, input)

/** Ask for one arbitrary date range of one report. */
export const requestFlipkartRange = (
  input: Range & { username: string; report: FlipkartReport }
): Promise<Result<FlipkartAccountResult>> =>
  invoke<FlipkartAccountResult>(FLIPKART_BACKUP_CHANNELS.requestRange, input)

/** Download and store everything this account has finished building, both reports. */
export const collectFlipkartReports = (username: string): Promise<Result<FlipkartAccountResult>> =>
  invoke<FlipkartAccountResult>(FLIPKART_BACKUP_CHANNELS.collect, { username })

/** Collect only the outstanding requests of one report covering a date range. */
export const collectFlipkartRange = (
  input: Range & { username: string; report: FlipkartReport }
): Promise<Result<FlipkartAccountResult>> =>
  invoke<FlipkartAccountResult>(FLIPKART_BACKUP_CHANNELS.collectRange, input)

/** Download and store one request's file, whatever state its row is in. */
export const collectFlipkartRequest = (input: { id: string }): Promise<Result<FlipkartAccountResult>> =>
  invoke<FlipkartAccountResult>(FLIPKART_BACKUP_CHANNELS.collectRequest, input)

/** Removes one report's rows for a date range. */
export const deleteFlipkartRange = (
  input: Range & { report: FlipkartReport }
): Promise<Result<{ removed: number }>> => invoke<{ removed: number }>(FLIPKART_BACKUP_CHANNELS.remove, input)

/** Forgets one report's request rows for a range, so those windows can be asked again. */
export const forgetFlipkartRequests = (
  input: Range & { report: FlipkartReport }
): Promise<Result<{ removed: number }>> =>
  invoke<{ removed: number }>(FLIPKART_BACKUP_CHANNELS.forgetRequests, input)

/** One report's rows, deleted. The main process asks first. */
export const eraseFlipkartBackup = (report: FlipkartReport): Promise<Result<{ rows: number }>> =>
  invoke<{ rows: number }>(FLIPKART_BACKUP_CHANNELS.erase, { report })

export const flipkartCardState = (): Promise<Result<FlipkartCardState>> =>
  invoke<FlipkartCardState>(FLIPKART_BACKUP_CHANNELS.cardState)

export const saveFlipkartCardState = (patch: { username: string }): Promise<Result<FlipkartCardState>> =>
  invoke<FlipkartCardState>(FLIPKART_BACKUP_CHANNELS.saveCardState, patch)

/** Every row held for one report, as one zip of monthly spreadsheets in Downloads. */
export const exportFlipkartBackup = (report: FlipkartReport): Promise<Result<BackupArchiveExport>> =>
  invoke<BackupArchiveExport>(FLIPKART_BACKUP_CHANNELS.export, { report })

/** A zip read back in. A merge: what is already held is skipped, never doubled. */
export const importFlipkartBackup = (report: FlipkartReport): Promise<Result<BackupArchiveImport>> =>
  invoke<BackupArchiveImport>(FLIPKART_BACKUP_CHANNELS.import, { report })
