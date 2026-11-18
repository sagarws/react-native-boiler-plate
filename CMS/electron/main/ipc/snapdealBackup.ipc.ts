import { SNAPDEAL_BACKUP_CHANNELS } from '@shared/constants/channels'
import {
  collectSnapdealRange,
  collectSnapdealRequest,
  collectSnapdealReports,
  deleteSnapdealBackupRange,
  eraseSnapdealBackup,
  forgetSnapdealBackupRequests,
  lookupSnapdealAwb,
  readSnapdealBackupState,
  requestSnapdealMonths,
  requestSnapdealRange,
  saveSnapdealBackupState,
  searchSnapdealBackup,
  snapdealCoverage,
  snapdealMonth,
  snapdealRequestCoverage
} from '../services/snapdealBackup.service'
import { exportSnapdealBackup, importSnapdealBackup } from '../services/snapdealBackupTransfer.service'
import { registerHandler } from './handler'

export const registerSnapdealBackupIpc = (): void => {
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.request, requestSnapdealMonths)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.requestRange, requestSnapdealRange)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.collect, collectSnapdealReports)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.collectRange, collectSnapdealRange)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.collectRequest, collectSnapdealRequest)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.coverage, () => snapdealCoverage())
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.requests, () => snapdealRequestCoverage())
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.month, snapdealMonth)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.search, searchSnapdealBackup)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.lookupAwb, lookupSnapdealAwb)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.remove, deleteSnapdealBackupRange)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.erase, () => eraseSnapdealBackup())
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.forgetRequests, forgetSnapdealBackupRequests)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.state, () => readSnapdealBackupState())
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.saveState, saveSnapdealBackupState)
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.export, () => exportSnapdealBackup())
  registerHandler(SNAPDEAL_BACKUP_CHANNELS.import, () => importSnapdealBackup())
}
