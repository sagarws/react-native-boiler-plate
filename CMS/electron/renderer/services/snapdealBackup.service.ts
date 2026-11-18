import { SNAPDEAL_BACKUP_CHANNELS, SNAPDEAL_BACKUP_EVENTS } from '@shared/constants/channels'
import type {
  SnapdealBackupSettings,
  SnapdealCollectSummary,
  SnapdealCoverage,
  SnapdealFinished,
  SnapdealProgress,
  SnapdealRecord,
  SnapdealRequestCoverage,
  SnapdealRequestSummary
} from '@shared/types/snapdealBackup'
import type { Result } from '@shared/types/result'
import type { BackupArchiveExport, BackupArchiveImport } from '@shared/types/backupArchive'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the Snapdeal backup channels. */

/**
 * Ask Snapdeal for whole months.
 *
 * Returns as soon as the pass has STARTED, with its job id: a year is
 * twenty-six report builds queued one after another, and nothing useful can be
 * done by waiting on them.
 */
export const requestSnapdealMonths = (input: {
  username?: string
  fromYear: number
  fromMonth: number
  toYear: number
  toMonth: number
}): Promise<Result<{ jobId: string; windows: number }>> =>
  invoke<{ jobId: string; windows: number }>(SNAPDEAL_BACKUP_CHANNELS.request, input)

/** Ask for one arbitrary date range, from the request calendar. */
export const requestSnapdealRange = (input: {
  from: string
  to: string
  username?: string
}): Promise<Result<SnapdealRequestSummary>> =>
  invoke<SnapdealRequestSummary>(SNAPDEAL_BACKUP_CHANNELS.requestRange, input)

/** Download and store everything Snapdeal has finished building. */
export const collectSnapdealReports = (): Promise<Result<SnapdealCollectSummary>> =>
  invoke<SnapdealCollectSummary>(SNAPDEAL_BACKUP_CHANNELS.collect)

/** Download only the requests covering one date range — the manual fetch. */
export const collectSnapdealRange = (input: {
  from: string
  to: string
}): Promise<Result<SnapdealCollectSummary>> =>
  invoke<SnapdealCollectSummary>(SNAPDEAL_BACKUP_CHANNELS.collectRange, input)

/** Download and store one request's report — the row action in the request table. */
export const collectSnapdealRequest = (input: { id: string }): Promise<Result<SnapdealCollectSummary>> =>
  invoke<SnapdealCollectSummary>(SNAPDEAL_BACKUP_CHANNELS.collectRequest, input)

/** Which months and days hold rows. */
export const snapdealCoverage = (): Promise<Result<SnapdealCoverage>> =>
  invoke<SnapdealCoverage>(SNAPDEAL_BACKUP_CHANNELS.coverage)

/** Which days were asked for, and how far each request got. */
export const snapdealRequestCoverage = (): Promise<Result<SnapdealRequestCoverage>> =>
  invoke<SnapdealRequestCoverage>(SNAPDEAL_BACKUP_CHANNELS.requests)

/**
 * One month's stored rows.
 *
 * `fetched` says the main process went and collected first — which it does
 * when the month is empty and a request for it is still outstanding. Worth
 * saying out loud, because that call takes as long as a download and silence
 * reads as the dialog having hung.
 */
export const snapdealMonth = (input: {
  year: number
  month: number
}): Promise<Result<{ rows: SnapdealRecord[]; fetched: boolean }>> =>
  invoke<{ rows: SnapdealRecord[]; fetched: boolean }>(SNAPDEAL_BACKUP_CHANNELS.month, input)

/** Rows carrying a sub-order, an AWB or a SKU. */
export const searchSnapdealBackup = (
  term: string
): Promise<Result<{ term: string; hits: SnapdealRecord[]; capped: boolean }>> =>
  invoke<{ term: string; hits: SnapdealRecord[]; capped: boolean }>(
    SNAPDEAL_BACKUP_CHANNELS.search,
    { term }
  )

/** The stored return for one AWB, matched exactly on the side it was typed into. */
export const lookupSnapdealAwb = (
  awb: string,
  side: 'return' | 'forward'
): Promise<Result<SnapdealRecord | null>> =>
  invoke<SnapdealRecord | null>(SNAPDEAL_BACKUP_CHANNELS.lookupAwb, { awb, side })

/** Removes what is held for a date range. */
export const deleteSnapdealRange = (input: {
  from: string
  to: string
}): Promise<Result<{ removed: number }>> =>
  invoke<{ removed: number }>(SNAPDEAL_BACKUP_CHANNELS.remove, input)

/** Everything held, deleted. The main process asks first. */
export const eraseSnapdealBackup = (): Promise<Result<{ rows: number; months: number }>> =>
  invoke<{ rows: number; months: number }>(SNAPDEAL_BACKUP_CHANNELS.erase)

/** Forgets the request rows for a range, so those windows can be asked again. */
export const forgetSnapdealRequests = (input: {
  from: string
  to: string
}): Promise<Result<{ removed: number }>> =>
  invoke<{ removed: number }>(SNAPDEAL_BACKUP_CHANNELS.forgetRequests, input)

export const snapdealBackupState = (): Promise<Result<SnapdealBackupSettings>> =>
  invoke<SnapdealBackupSettings>(SNAPDEAL_BACKUP_CHANNELS.state)

export const saveSnapdealBackupState = (patch: {
  username?: string
}): Promise<Result<SnapdealBackupSettings>> =>
  invoke<SnapdealBackupSettings>(SNAPDEAL_BACKUP_CHANNELS.saveState, patch)

/** Follows a pass — request by request. */
export const onSnapdealProgress = (
  listener: (progress: SnapdealProgress) => void
): (() => void) =>
  subscribe(SNAPDEAL_BACKUP_EVENTS.progress, payload => listener(payload as SnapdealProgress))

/** One call when a pass ends, with what it found. */
export const onSnapdealFinished = (
  listener: (finished: SnapdealFinished) => void
): (() => void) =>
  subscribe(SNAPDEAL_BACKUP_EVENTS.finished, payload => listener(payload as SnapdealFinished))

/** Every row held, as one zip of monthly spreadsheets in Downloads. */
export const exportSnapdealBackup = (): Promise<Result<BackupArchiveExport>> =>
  invoke<BackupArchiveExport>(SNAPDEAL_BACKUP_CHANNELS.export)

/** A zip read back in. A merge: what is already held is skipped, never doubled. */
export const importSnapdealBackup = (): Promise<Result<BackupArchiveImport>> =>
  invoke<BackupArchiveImport>(SNAPDEAL_BACKUP_CHANNELS.import)
