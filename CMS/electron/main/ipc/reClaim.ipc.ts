import { RE_CLAIM_CHANNELS } from '@shared/constants/channels'
import {
  chooseReClaimSheet,
  downloadReClaimTemplate,
  manualReClaimRows,
  reClaimAccounts,
  reClaimProgress,
  reClaimTicket,
  startBulkReClaim,
  stopReClaim,
  submitReClaim
} from '../services/reClaim.service'
import { registerHandler } from './handler'

export const registerReClaimIpc = (): void => {
  registerHandler(RE_CLAIM_CHANNELS.chooseFile, () => chooseReClaimSheet())
  registerHandler(RE_CLAIM_CHANNELS.downloadTemplate, () => downloadReClaimTemplate())
  registerHandler(RE_CLAIM_CHANNELS.manualRows, payload =>
    Promise.resolve(manualReClaimRows(payload))
  )
  registerHandler(RE_CLAIM_CHANNELS.accounts, () => reClaimAccounts())
  registerHandler(RE_CLAIM_CHANNELS.ticket, reClaimTicket)
  registerHandler(RE_CLAIM_CHANNELS.submit, submitReClaim)
  registerHandler(RE_CLAIM_CHANNELS.bulk, startBulkReClaim)
  registerHandler(RE_CLAIM_CHANNELS.bulkStatus, () => Promise.resolve(reClaimProgress()))
  registerHandler(RE_CLAIM_CHANNELS.stop, () => Promise.resolve(stopReClaim()))
}
