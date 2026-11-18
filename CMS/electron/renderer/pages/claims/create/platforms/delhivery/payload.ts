import { otherBundleUpdate } from '../common/otherBundleUpdate'
import { trimOrUndef, type UpdateBuilder } from '../common/payload'

export const delhiveryUpdate: UpdateBuilder = (context) => {
  const bundle = (context.values.otherClaimDetails ?? {}) as Record<string, unknown>
  // The freight lane, which the endpoint takes at the top level rather than as
  // an `other*` field.
  const domestic = trimOrUndef(bundle.domestic)

  return {
    ...otherBundleUpdate(context),
    ...(domestic ? { domestic } : {})
  }
}
