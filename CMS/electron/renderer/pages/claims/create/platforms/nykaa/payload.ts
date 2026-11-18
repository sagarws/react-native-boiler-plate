import { trimOrUndef, type UpdateBuilder } from '../common/payload'

/**
 * Nykaa's three bundle fields.
 *
 * The account is not among them: it is handled with every other platform's,
 * because `/cms/updateCMS` takes a single `username` and routes it by platform.
 */
export const nykaaUpdate: UpdateBuilder = ({ values, platformLabel }) => {
  const bundle = (values.nykaaClaimDetails ?? {}) as Record<string, unknown>
  const payload: Record<string, unknown> = {}

  const vendorCode = trimOrUndef(bundle.vendorCode)
  if (vendorCode) payload.nykaaVendorCode = vendorCode

  const skuId = trimOrUndef(bundle.skuId)
  if (skuId) payload.nykaaSkuId = skuId

  const returnType = trimOrUndef(bundle.returnType)
  if (returnType) payload.nykaaReturnType = returnType

  payload.eCommercePlatform = platformLabel

  return payload
}
