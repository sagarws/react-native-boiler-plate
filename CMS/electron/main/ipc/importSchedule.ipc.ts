import { IMPORT_SCHEDULE_CHANNELS } from '@shared/constants/channels'
import { ok } from '@shared/types/result'
import {
  refreshSchedule,
  scheduleState,
  setPlatformSyncTime,
  setSyncTime
} from '../services/importScheduler.service'
import { masterImportRows, resyncMasterImport } from '../services/masterImport.service'
import { cacheStatus, syncAll } from '../services/syncAll.service'
import { registerHandler } from './handler'

export const registerImportScheduleIpc = (): void => {
  registerHandler(IMPORT_SCHEDULE_CHANNELS.state, () => Promise.resolve(ok(scheduleState())))
  registerHandler(IMPORT_SCHEDULE_CHANNELS.refresh, () => refreshSchedule())
  registerHandler(IMPORT_SCHEDULE_CHANNELS.setTime, payload => setSyncTime(payload))
  registerHandler(IMPORT_SCHEDULE_CHANNELS.setPlatformTime, payload => setPlatformSyncTime(payload))
  registerHandler(IMPORT_SCHEDULE_CHANNELS.rows, () => masterImportRows())
  registerHandler(IMPORT_SCHEDULE_CHANNELS.resync, payload => resyncMasterImport(payload))
  registerHandler(IMPORT_SCHEDULE_CHANNELS.syncAll, () => syncAll())
  registerHandler(IMPORT_SCHEDULE_CHANNELS.cacheStatus, () => cacheStatus())
}
