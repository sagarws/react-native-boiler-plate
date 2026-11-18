import { CLAIM_TAT_CHANNELS } from '@shared/constants/channels'
import { checkClaimTat } from '../services/tatCheck.service'
import { registerHandler } from './handler'

export const registerTatCheckIpc = (): void => {
  registerHandler(CLAIM_TAT_CHANNELS.check, checkClaimTat)
}
