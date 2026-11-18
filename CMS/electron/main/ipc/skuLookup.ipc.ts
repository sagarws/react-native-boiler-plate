import { SKU_LOOKUP_CHANNELS } from '@shared/constants/channels'
import {
  applySellerSku,
  applySkuSelections,
  lookupReturnArticles,
  runSkuSweep,
  skuSweepPending,
  skuSweepStatus
} from '../services/skuLookup.service'
import { registerHandler } from './handler'

export const registerSkuLookupIpc = (): void => {
  registerHandler(SKU_LOOKUP_CHANNELS.articles, lookupReturnArticles)
  registerHandler(SKU_LOOKUP_CHANNELS.apply, applySellerSku)
  registerHandler(SKU_LOOKUP_CHANNELS.pending, skuSweepPending)
  registerHandler(SKU_LOOKUP_CHANNELS.sweep, runSkuSweep)
  registerHandler(SKU_LOOKUP_CHANNELS.sweepStatus, () => Promise.resolve(skuSweepStatus()))
  registerHandler(SKU_LOOKUP_CHANNELS.applyMany, applySkuSelections)
}
