import { registerCompanyIpc } from './company.ipc'
import { logger } from '../services/logger'
import { registerAutomationScheduleIpc } from './automationSchedule.ipc'
import { registerAuthIpc } from './auth.ipc'
import { registerBulkSpfIpc } from './bulkSpf.ipc'
import { registerNykaaBulkDdrIpc } from './nykaaBulkDdr.ipc'
import { registerClaimCreateIpc } from './claimCreate.ipc'
import { registerClaimQueueIpc } from './claimQueue.ipc'
import { registerClaimResourcesIpc } from './claimResources.ipc'
import { registerCmsListIpc } from './cmsList.ipc'
import { registerDashboardIpc } from './dashboard.ipc'
import { registerImportScheduleIpc } from './importSchedule.ipc'
import { registerMasterReportIpc } from './masterDataReport.ipc'
import { registerPlatformSessionIpc } from './platformSession.ipc'
import { registerPreferencesIpc } from './preferences.ipc'
import { registerJobsIpc } from './jobs.ipc'
import { registerLocalDatabaseIpc } from './localDatabase.ipc'
import { registerReClaimIpc } from './reClaim.ipc'
import { registerSkuLookupIpc } from './skuLookup.ipc'
import { registerSystemIpc } from './system.ipc'
import { registerMasterBackupIpc } from './masterBackup.ipc'
import { registerSnapdealBackupIpc } from './snapdealBackup.ipc'
import { registerFlipkartBackupIpc } from './flipkartBackup.ipc'
import { registerRefillIpc } from './refill.ipc'
import { registerTatCheckIpc } from './tatCheck.ipc'
import { registerTicketThreadIpc } from './ticketThread.ipc'
import { registerEmailReplyIpc } from './emailReply.ipc'
import { registerTermsIpc } from './terms.ipc'
import { registerUpdateIpc } from './update.ipc'
import { registerCloseGuardIpc } from './closeGuard.ipc'

/** Called once during startup, after the database is initialised. */
export const registerIpcHandlers = (): void => {
  registerSystemIpc()
  registerCloseGuardIpc()
  registerCompanyIpc()
  registerAuthIpc()
  registerUpdateIpc()
  registerPreferencesIpc()
  registerPlatformSessionIpc()
  registerClaimQueueIpc()
  registerBulkSpfIpc()
  registerNykaaBulkDdrIpc()
  registerDashboardIpc()
  registerCmsListIpc()
  registerClaimCreateIpc()
  registerClaimResourcesIpc()
  registerImportScheduleIpc()
  registerSkuLookupIpc()
  registerMasterReportIpc()
  registerReClaimIpc()
  registerJobsIpc()
  registerTatCheckIpc()
  registerTicketThreadIpc()
  registerEmailReplyIpc()
  registerTermsIpc()
  registerRefillIpc()
  registerMasterBackupIpc()
  registerSnapdealBackupIpc()
  registerFlipkartBackupIpc()
  registerAutomationScheduleIpc()
  registerLocalDatabaseIpc()
  logger.info('IPC handlers registered')
}
