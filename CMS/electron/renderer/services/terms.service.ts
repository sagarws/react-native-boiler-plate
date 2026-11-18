import { invoke } from './ipcClient'
import { TERMS_CHANNELS } from '@shared/constants/channels'
import type { Result } from '@shared/types/result'

export interface TermsStatus {
  agreed: boolean
}

/** Has this company accepted the responsible-use notice? Unreadable means "ask". */
export const termsStatus = (): Promise<Result<TermsStatus>> =>
  invoke<TermsStatus>(TERMS_CHANNELS.status)

export const acceptTerms = (): Promise<Result<TermsStatus>> =>
  invoke<TermsStatus>(TERMS_CHANNELS.accept)

/** Records the refusal and closes the app. Nothing comes back — the window goes. */
export const declineTerms = (): Promise<Result<TermsStatus>> =>
  invoke<TermsStatus>(TERMS_CHANNELS.decline)
