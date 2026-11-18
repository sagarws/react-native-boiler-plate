import { otherBundleUpdate } from '../common/otherBundleUpdate'
import { cleanKeys, trimOrUndef, type UpdateBuilder } from '../common/payload'

export const amazonUpdate: UpdateBuilder = (context) => {
  const bundle = (context.values.otherClaimDetails ?? {}) as Record<string, unknown>
  const payload: Record<string, unknown> = { ...otherBundleUpdate(context) }

  const contents = cleanKeys(bundle.contentsOfReturnImages)
  if (contents) payload.otherContentsOfReturnImages = contents

  const serial = trimOrUndef(bundle.serialNumberImage)
  if (serial) payload.otherSerialNumberImage = serial

  const fulfillment = trimOrUndef(bundle.fulfillmentChannel)
  if (fulfillment) payload.otherFulfillmentChannel = fulfillment

  return payload
}
