import { MASTER_BACKUP_CHANNELS, MASTER_BACKUP_EVENTS } from '@shared/constants/channels'
import type {
  BackupCoverage,
  BackupLookupResult,
  BackupSearchResult,
  BackupEraseSummary,
  BackupExportSummary,
  BackupImportSummary,
  BackupFinished,
  BackupProgress,
  BackupRecord,
  BackupReport,
  BackupSettings,
  BackupStart,
  BackupSummary
} from '@shared/types/masterBackup'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the AJIO backup channels. */

/**
 * Whole months, chosen on the card.
 *
 * Returns as soon as the run has STARTED, with its job id — a year of the
 * return report takes an hour, and nothing useful can be done by waiting.
 * Follow it with `onBackupProgress`, and `onBackupFinished` for the end.
 */
export const backupMonths = (input: {
  report: BackupReport
  username: string
  fromYear: number
  fromMonth: number
  toYear: number
  toMonth: number
}): Promise<Result<BackupStart>> => invoke<BackupStart>(MASTER_BACKUP_CHANNELS.months, input)

/** An arbitrary date range, from the calendar. Skips what is already held. */
export const syncBackupRange = (input: {
  report: BackupReport
  from: string
  to: string
  username?: string
}): Promise<Result<BackupSummary>> => invoke<BackupSummary>(MASTER_BACKUP_CHANNELS.sync, input)

/** From the last date any sync covered, up to today. */
export const syncSinceLast = (report: BackupReport): Promise<Result<BackupSummary>> =>
  invoke<BackupSummary>(MASTER_BACKUP_CHANNELS.sinceLast, { report })

/** Which months and days are held. */
export const backupCoverage = (report: BackupReport): Promise<Result<BackupCoverage>> =>
  invoke<BackupCoverage>(MASTER_BACKUP_CHANNELS.coverage, { report })

/** One month's stored rows. */
export const backupMonth = (input: {
  report: BackupReport
  year: number
  month: number
}): Promise<Result<{ rows: BackupRecord[] }>> =>
  invoke<{ rows: BackupRecord[] }>(MASTER_BACKUP_CHANNELS.month, input)

/** Removes what is held for a date range. */
export const deleteBackupRange = (input: {
  report: BackupReport
  from: string
  to: string
}): Promise<Result<{ removed: number }>> =>
  invoke<{ removed: number }>(MASTER_BACKUP_CHANNELS.remove, input)

export const backupState = (): Promise<Result<BackupSettings>> =>
  invoke<BackupSettings>(MASTER_BACKUP_CHANNELS.state)

export const saveBackupState = (patch: {
  username?: string
  dailyTime?: string | null
}): Promise<Result<BackupSettings>> =>
  invoke<BackupSettings>(MASTER_BACKUP_CHANNELS.saveState, patch)

/** Follows a run — page by page, month by month. */
export const onBackupProgress = (listener: (progress: BackupProgress) => void): (() => void) =>
  subscribe(MASTER_BACKUP_EVENTS.progress, payload => listener(payload as BackupProgress))

/** One call when a run ends, with what it found. */
export const onBackupFinished = (listener: (finished: BackupFinished) => void): (() => void) =>
  subscribe(MASTER_BACKUP_EVENTS.finished, payload => listener(payload as BackupFinished))

/** Everything held for one report, as a zip of spreadsheets in Downloads. */
export const exportBackup = (report: BackupReport): Promise<Result<BackupExportSummary>> =>
  invoke<BackupExportSummary>(MASTER_BACKUP_CHANNELS.export, { report })

/** The same zip back. A merge: what is already held is skipped, never doubled. */
export const importBackup = (report: BackupReport): Promise<Result<BackupImportSummary>> =>
  invoke<BackupImportSummary>(MASTER_BACKUP_CHANNELS.import, { report })

/** Everything held for one report, deleted. The main process asks first. */
export const eraseBackup = (report: BackupReport): Promise<Result<BackupEraseSummary>> =>
  invoke<BackupEraseSummary>(MASTER_BACKUP_CHANNELS.erase, { report })

/** Rows carrying an AWB or EAN, across both reports and every month held. */
export const searchBackup = (term: string): Promise<Result<BackupSearchResult>> =>
  invoke<BackupSearchResult>(MASTER_BACKUP_CHANNELS.search, { term })

/** A pasted list of AWBs: the rows held, and the numbers nothing is held for. */
export const lookupBackup = (awbs: string): Promise<Result<BackupLookupResult>> =>
  invoke<BackupLookupResult>(MASTER_BACKUP_CHANNELS.lookup, { awbs })
