import { SKU_LOOKUP_CHANNELS, SKU_LOOKUP_EVENTS } from '@shared/constants/channels'
import type {
  ReturnArticles,
  SkuSweepProgress,
  SkuSweepResult
} from '@shared/types/skuLookup'
import type { Result } from '@shared/types/result'
import { invoke, subscribe } from './ipcClient'

/** Renderer-side wrapper over the SKU picker's channels. */

/** The articles AJIO holds against this claim's return AWB. A read; changes nothing. */
export const lookupReturnArticles = (claim: {
  cmsId: string
  platform: string
  awbNumber: string
  pobId: string
  username: string
  accountType: string
}): Promise<Result<ReturnArticles>> => invoke<ReturnArticles>(SKU_LOOKUP_CHANNELS.articles, claim)

export const applySellerSku = (
  cmsId: string,
  sellerSku: string
): Promise<Result<{ cmsId: string; sellerSku: string; previous: string | null }>> =>
  invoke(SKU_LOOKUP_CHANNELS.apply, { cmsId, sellerSku })

/** How many claims a bulk sweep would ask about. Decides whether the button is shown. */
export const skuSweepPending = (
  platform: string
): Promise<Result<{ platform: string; count: number; capped: boolean; cmsIds: string[] }>> =>
  invoke(SKU_LOOKUP_CHANNELS.pending, { platform })

/**
 * Asks AJIO about every eligible claim.
 *
 * WRITES NOTHING. It returns a review for the operator to confirm — a sweep
 * that saved as it went would replace SKUs across dozens of claims on the
 * strength of one bad search, and a return with several articles has no
 * automatic right answer at all.
 */
export const runSkuSweep = (
  platform: string,
  cmsIds: string[]
): Promise<Result<SkuSweepResult>> =>
  invoke<SkuSweepResult>(SKU_LOOKUP_CHANNELS.sweep, { platform, cmsIds })

export const skuSweepStatus = (): Promise<
  Result<{ progress: SkuSweepProgress | null; result: SkuSweepResult | null }>
> => invoke(SKU_LOOKUP_CHANNELS.sweepStatus)

/** Saves the confirmed SKUs. */
export const applySkuSelections = (
  selections: { cmsId: string; awbNumber: string; sellerSku: string }[]
): Promise<Result<{ saved: number; failed: number; failures: { awbNumber: string; message: string }[] }>> =>
  invoke(SKU_LOOKUP_CHANNELS.applyMany, { selections })

export const onSkuSweepProgress = (
  listener: (progress: SkuSweepProgress) => void
): (() => void) =>
  subscribe(SKU_LOOKUP_EVENTS.progress, payload => listener(payload as SkuSweepProgress))
