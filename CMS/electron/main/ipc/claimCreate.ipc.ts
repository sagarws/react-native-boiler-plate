import { CLAIM_CREATE_CHANNELS } from '@shared/constants/channels'
import { refillBulkRows } from '../services/bulkRefill.service'
import {
  accountByAwb,
  automationPlatforms,
  bulkClaimCheck,
  bulkClaimCreate,
  bulkClaimVerify,
  claimFormCatalogue,
  commonFeeds,
  createClaim,
  deleteClaimFile,
  findClaimByAwb,
  masterOrderInfo,
  orderByAwb,
  orderImage,
  orderScreenshots,
  productSkuMap,
  returnAwbAutofill,
  storeClaimVideo,
  updateClaim,
  uploadClaimImage
} from '../services/claimCreate.service'
import {
  downloadBulkClaimTemplate,
  downloadIncreffTemplate,
  readBulkClaimSheet,
  saveIncreffResults
} from '../services/bulkClaimSheet.service'
import { registerHandler } from './handler'

export const registerClaimCreateIpc = (): void => {
  registerHandler(CLAIM_CREATE_CHANNELS.catalogue, () => claimFormCatalogue())
  registerHandler(CLAIM_CREATE_CHANNELS.automationPlatforms, () => automationPlatforms())
  registerHandler(CLAIM_CREATE_CHANNELS.findByAwb, payload => findClaimByAwb(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.accountByAwb, payload => accountByAwb(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.order, payload => orderByAwb(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.screenshots, payload => orderScreenshots(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.orderImage, payload => orderImage(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.skuMap, payload => productSkuMap(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.masterOrderInfo, payload => masterOrderInfo(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.returnAwbAutofill, payload => returnAwbAutofill(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.feeds, () => commonFeeds())
  registerHandler(CLAIM_CREATE_CHANNELS.uploadImage, payload => uploadClaimImage(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.storeVideo, payload => storeClaimVideo(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.bulkCheck, payload => bulkClaimCheck(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.bulkVerify, payload => bulkClaimVerify(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.bulkCreate, payload => bulkClaimCreate(payload))
  // Takes no payload: the columns are the backend's contract, not the renderer's.
  registerHandler(CLAIM_CREATE_CHANNELS.bulkIncreffTemplate, () => downloadIncreffTemplate())
  registerHandler(CLAIM_CREATE_CHANNELS.bulkIncreffResults, payload => saveIncreffResults(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.bulkSheetTemplate, payload =>
    downloadBulkClaimTemplate(payload)
  )
  registerHandler(CLAIM_CREATE_CHANNELS.bulkSheetRead, payload => readBulkClaimSheet(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.bulkRefill, refillBulkRows)
  registerHandler(CLAIM_CREATE_CHANNELS.deleteFile, payload => deleteClaimFile(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.create, payload => createClaim(payload))
  registerHandler(CLAIM_CREATE_CHANNELS.update, payload => updateClaim(payload))
}
