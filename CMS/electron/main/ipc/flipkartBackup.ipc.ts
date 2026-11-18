import { FLIPKART_BACKUP_CHANNELS } from '@shared/constants/channels'
import {
  collectFlipkartNow,
  collectFlipkartRange,
  collectFlipkartRequest,
  deleteFlipkartBackupRange,
  eraseFlipkartBackup,
  flipkartBackupState,
  flipkartCoverage,
  flipkartMonth,
  flipkartRequestCoverage,
  forgetFlipkartBackupRequests,
  lookupFlipkartAwb,
  readFlipkartCardState,
  requestFlipkartMonths,
  requestFlipkartRange,
  saveFlipkartCardState,
  searchFlipkartBackup
} from '../services/flipkartBackup.service'
import { exportFlipkartBackup, importFlipkartBackup } from '../services/flipkartBackupTransfer.service'
import { registerHandler } from './handler'

export const registerFlipkartBackupIpc = (): void => {
  registerHandler(FLIPKART_BACKUP_CHANNELS.state, () => flipkartBackupState())
  registerHandler(FLIPKART_BACKUP_CHANNELS.lookupAwb, lookupFlipkartAwb)
  registerHandler(FLIPKART_BACKUP_CHANNELS.coverage, flipkartCoverage)
  registerHandler(FLIPKART_BACKUP_CHANNELS.month, flipkartMonth)
  registerHandler(FLIPKART_BACKUP_CHANNELS.search, searchFlipkartBackup)
  registerHandler(FLIPKART_BACKUP_CHANNELS.requestCoverage, flipkartRequestCoverage)
  registerHandler(FLIPKART_BACKUP_CHANNELS.request, requestFlipkartMonths)
  registerHandler(FLIPKART_BACKUP_CHANNELS.requestRange, requestFlipkartRange)
  registerHandler(FLIPKART_BACKUP_CHANNELS.collect, collectFlipkartNow)
  registerHandler(FLIPKART_BACKUP_CHANNELS.collectRange, collectFlipkartRange)
  registerHandler(FLIPKART_BACKUP_CHANNELS.collectRequest, collectFlipkartRequest)
  registerHandler(FLIPKART_BACKUP_CHANNELS.remove, deleteFlipkartBackupRange)
  registerHandler(FLIPKART_BACKUP_CHANNELS.forgetRequests, forgetFlipkartBackupRequests)
  registerHandler(FLIPKART_BACKUP_CHANNELS.erase, eraseFlipkartBackup)
  registerHandler(FLIPKART_BACKUP_CHANNELS.cardState, () => readFlipkartCardState())
  registerHandler(FLIPKART_BACKUP_CHANNELS.saveCardState, saveFlipkartCardState)
  registerHandler(FLIPKART_BACKUP_CHANNELS.export, exportFlipkartBackup)
  registerHandler(FLIPKART_BACKUP_CHANNELS.import, importFlipkartBackup)
}
