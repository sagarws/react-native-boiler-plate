import { TERMS_CHANNELS } from '@shared/constants/channels'
import { acceptTerms, declineTerms, termsStatus } from '../services/terms.service'
import { registerHandler } from './handler'

export const registerTermsIpc = (): void => {
  registerHandler(TERMS_CHANNELS.status, () => termsStatus())
  registerHandler(TERMS_CHANNELS.accept, () => acceptTerms())
  registerHandler(TERMS_CHANNELS.decline, () => declineTerms())
}
