import { CLAIM_TAT_CHANNELS, CLAIM_TAT_EVENTS } from '@shared/constants/channels'
import type { TatCheckProgress, TatCheckSummary } from '@shared/types/tatCheck'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/**
 * Asks the marketplace whether the ticked claims can still be filed, and files
 * the ones that cannot away as Failed to Proceed with "TAT Expired".
 *
 * The rows go with the call rather than being re-read in the main process: the
 * operator ticked what is on screen, and that is what should be checked.
 */
export const checkClaimTat = (
  platform: string,
  claims: { cmsId: string; awb: string }[]
): Promise<Result<TatCheckSummary>> =>
  invoke<TatCheckSummary>(CLAIM_TAT_CHANNELS.check, { platform, claims })

/**
 * Follows a run. The dialog is fed rather than polling: the main process is the
 * only side that knows how far it has got.
 */
export const onTatCheckProgress = (listener: (progress: TatCheckProgress) => void): (() => void) =>
  subscribe(CLAIM_TAT_EVENTS.progress, payload => listener(payload as TatCheckProgress))
