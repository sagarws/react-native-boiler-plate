import { otherBundleUpdate } from '../common/otherBundleUpdate'
import { trimOrUndef, type UpdateBuilder } from '../common/payload'

/**
 * Tata CliQ's QC form, which IS the claim.
 *
 * The portal files nothing without a reason code and its named upload slots, so
 * an update that carried everything about the claim EXCEPT these sent the part
 * the marketplace never acts on. Three of them are sent even when EMPTY, and
 * that is the interesting rule: eleven of the twelve reasons take no
 * sub-reason, and the portal's own page clears the select when the reason
 * changes — so an operator moving off Wrong Product has to be able to clear
 * what was stored, and "send it only when truthy" is exactly the rule that
 * would leave it behind. The same goes for the two video URLs.
 */
export const tataCliqUpdate: UpdateBuilder = (context) => {
  const bundle = (context.values.otherClaimDetails ?? {}) as {
    qcReason?: unknown
    qcSubReason?: unknown
    qcImages?: unknown
    packagingVideoUrl?: unknown
    unboxingVideoUrl?: unknown
  }
  const payload: Record<string, unknown> = { ...otherBundleUpdate(context) }

  const reason = trimOrUndef(bundle.qcReason)
  if (reason) payload.otherQcReason = reason

  if (typeof bundle.qcSubReason === 'string') payload.otherQcSubReason = bundle.qcSubReason.trim()

  // Keyed by slot, as the form holds them: the portal's uploads are positional
  // and named, and a reviewer opens each expecting a particular thing, so the
  // name travels with the key.
  if (bundle.qcImages && typeof bundle.qcImages === 'object') {
    const images: Record<string, string> = {}

    for (const [slot, key] of Object.entries(bundle.qcImages as Record<string, unknown>)) {
      if (typeof key === 'string' && key.trim()) images[slot] = key.trim()
    }

    // Only when there is something to say. An empty object asks the server to
    // replace six images with none.
    if (Object.keys(images).length > 0) payload.otherQcImages = images
  }

  if (typeof bundle.packagingVideoUrl === 'string') {
    payload.otherPackagingVideoUrl = bundle.packagingVideoUrl.trim()
  }

  if (typeof bundle.unboxingVideoUrl === 'string') {
    payload.otherUnboxingVideoUrl = bundle.unboxingVideoUrl.trim()
  }

  return payload
}
