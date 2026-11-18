import { MASTER_BACKUP_CHANNELS } from '@shared/constants/channels'
import {
  backupCoverage,
  backupMonth,
  searchBackup,
  lookupBackup,
  backupMonths,
  deleteBackupRange,
  readBackupState,
  saveBackupState,
  syncRange,
  syncSinceLast
} from '../services/masterBackup.service'
import {
  eraseBackup,
  exportBackup,
  importBackup
} from '../services/masterBackupTransfer.service'
import { registerHandler } from './handler'

export const registerMasterBackupIpc = (): void => {
  registerHandler(MASTER_BACKUP_CHANNELS.months, backupMonths)
  registerHandler(MASTER_BACKUP_CHANNELS.sync, syncRange)
  registerHandler(MASTER_BACKUP_CHANNELS.sinceLast, syncSinceLast)
  registerHandler(MASTER_BACKUP_CHANNELS.coverage, backupCoverage)
  registerHandler(MASTER_BACKUP_CHANNELS.month, backupMonth)
  registerHandler(MASTER_BACKUP_CHANNELS.search, searchBackup)
  registerHandler(MASTER_BACKUP_CHANNELS.lookup, lookupBackup)
  registerHandler(MASTER_BACKUP_CHANNELS.remove, deleteBackupRange)
  registerHandler(MASTER_BACKUP_CHANNELS.export, exportBackup)
  registerHandler(MASTER_BACKUP_CHANNELS.import, importBackup)
  registerHandler(MASTER_BACKUP_CHANNELS.erase, eraseBackup)
  registerHandler(MASTER_BACKUP_CHANNELS.state, () => readBackupState())
  registerHandler(MASTER_BACKUP_CHANNELS.saveState, saveBackupState)
}
