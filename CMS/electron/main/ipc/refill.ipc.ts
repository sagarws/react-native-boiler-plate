import { CLAIM_REFILL_CHANNELS } from '@shared/constants/channels'
import { runRefill } from '../services/refill.service'
import { registerHandler } from './handler'

export const registerRefillIpc = (): void => {
  registerHandler(CLAIM_REFILL_CHANNELS.run, runRefill)
}
