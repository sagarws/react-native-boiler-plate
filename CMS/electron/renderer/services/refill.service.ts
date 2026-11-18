import { CLAIM_REFILL_CHANNELS, CLAIM_REFILL_EVENTS } from '@shared/constants/channels'
import type {
  RefillField,
  RefillPassProgress,
  RefillProgress,
  RefillSummary
} from '@shared/types/refill'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/**
 * Refill Data — asks the marketplace for the blanks on the ticked claims.
 *
 * The rows go with the call rather than being re-read in the main process: the
 * operator ticked what is on screen, and that is what should be asked about.
 */
export const runRefill = (
  platform: string,
  claims: { cmsId: string; awb: string }[],
  fields: RefillField[],
  /** Ask the marketplace instead of this machine's backup. AJIO only. */
  useApis = false,
  /** Spend each row's refill budget. False for a status-only run. */
  countsAttempt = true
): Promise<Result<RefillSummary>> =>
  invoke<RefillSummary>(CLAIM_REFILL_CHANNELS.run, {
    platform,
    claims,
    fields,
    useApis,
    countsAttempt
  })

/** Follows a run — the dialog is fed rather than polling. */
export const onRefillProgress = (listener: (progress: RefillProgress) => void): (() => void) =>
  subscribe(CLAIM_REFILL_EVENTS.progress, payload => listener(payload as RefillProgress))

/**
 * The shape of the whole pass — which marketplaces it will reach, which one it
 * is on, and which of the two passes is running.
 *
 * The event above is one platform's claim-by-claim detail; this is the run
 * around it. A card showing only the first can say a platform is working and
 * nothing about the six waiting behind it.
 */
export const onRefillPass = (listener: (progress: RefillPassProgress) => void): (() => void) =>
  subscribe(CLAIM_REFILL_EVENTS.pass, payload => listener(payload as RefillPassProgress))
