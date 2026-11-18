import { qcSelectionFromClaimType, TATACLIQ_QC_IMAGE_SLOTS } from '../../tatacliqQc'
import { keyOf, setIn, textOf, type BulkSpec } from '../common/bulk'

/**
 * Tata CliQ in Normal Bulk Claim.
 *
 * Screenshots fill the portal's six QC slots in order, and the legacy shipping
 * label / packing fields are mirrored from them exactly as the form does. The
 * QC reason and sub-reason are DERIVED from the cascade, never typed — the
 * form derives them the same way.
 */
export const tataCliqBulk: BulkSpec = {
  columns: [],
  place: (values, screenshots) => {
    const images: Record<string, string> = {}

    TATACLIQ_QC_IMAGE_SLOTS.forEach((slot, index) => {
      const key = keyOf(screenshots[index])

      if (key) images[slot.key] = key
    })

    let next = setIn(values, 'otherClaimDetails.qcImages', images)

    next = setIn(next, 'otherClaimDetails.shippingLabelImage', images.packingSlip || '')
    next = setIn(
      next,
      'otherClaimDetails.packingImages',
      TATACLIQ_QC_IMAGE_SLOTS.filter((slot) => slot.key !== 'packingSlip')
        .map((slot) => images[slot.key])
        .filter((key): key is string => Boolean(key))
    )

    return { values: next, sideImages: [] }
  },
  finalize: (values) => {
    const bundle = (values.otherClaimDetails ?? {}) as unknown as Record<string, unknown>
    const { reason, subReason } = qcSelectionFromClaimType(
      textOf(bundle.parentSelection),
      textOf(values.typeOfClaim)
    )
    const next = setIn(values, 'otherClaimDetails.qcReason', reason)

    return setIn(next, 'otherClaimDetails.qcSubReason', subReason)
  }
}
