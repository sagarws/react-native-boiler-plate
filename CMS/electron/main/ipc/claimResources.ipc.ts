import { CLAIM_RESOURCE_CHANNELS } from '@shared/constants/channels'
import { downloadClaimResources, readRemoteImage } from '../services/claimResources.service'
import { registerHandler } from './handler'

export const registerClaimResourcesIpc = (): void => {
  // The payload is validated inside the service — platform and AWB are required.
  registerHandler(CLAIM_RESOURCE_CHANNELS.download, payload => downloadClaimResources(payload))
  // Remote images for the six-side PDF — see readRemoteImage.
  registerHandler(CLAIM_RESOURCE_CHANNELS.readImage, payload => readRemoteImage(payload))
}
