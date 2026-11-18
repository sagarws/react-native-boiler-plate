import { PACKING_SIDES } from '@shared/types/cmsCreate'
import { keyOf, setIn, type BulkSpec } from '../common/bulk'

/**
 * Xbees in Normal Bulk Claim: four positional package photos — Top, Right,
 * Bottom, Left, in that order, as the form fills them — and a disputed amount.
 */
export const xbeesBulk: BulkSpec = {
  columns: [
    { header: 'Dispute Amount', path: 'otherClaimDetails.disputeAmount', required: true }
  ],
  place: (values, screenshots) => ({
    values: setIn(
      values,
      'otherClaimDetails.packingImages',
      PACKING_SIDES.map((side, index) => ({ fileKey: keyOf(screenshots[index]), side }))
    ),
    sideImages: []
  })
}
