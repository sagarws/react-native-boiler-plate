import { getMyntraOrderInfo } from '../../api'
import { fillBlank, isBlank, keyOf, setIn, type BulkSpec } from '../common/bulk'

/**
 * Myntra in Normal Bulk Claim.
 *
 * First screenshot is the shipping label, up to ten more are packing images —
 * the form's own placement. Myntra's master lookup carries the video links.
 */
export const myntraBulk: BulkSpec = {
  refill: true,
  columns: [
    {
      header: 'Disputed Amount',
      path: 'myntraClaimDetails.disputedAmount',
      hint: 'Required for partial_return claims.'
    },
    {
      header: 'Physical Received SKU',
      path: 'myntraClaimDetails.physicalReceivedSku',
      hint: 'Required for wrong_returns_own_product claims.'
    }
  ],
  place: (values, screenshots) => {
    const [shipping, ...packing] = screenshots.slice(0, 11)
    let next = values

    if (shipping) next = setIn(next, 'myntraClaimDetails.shippingLabelImage', keyOf(shipping))
    next = setIn(next, 'myntraClaimDetails.packingImages', packing.map(keyOf).filter(Boolean))

    return { values: next, sideImages: [] }
  },
  enrich: async (values) => {
    if (!isBlank(values.returnVideoLink) && !isBlank(values.forwardAWB)) return values

    try {
      const response = await getMyntraOrderInfo({ returnTrackingNumber: values.AWBNumber })
      const info = (response.data?.data ?? {}) as Record<string, string | undefined>
      let next = fillBlank(values, 'forwardAWB', info.forwardTrackingNumber)

      next = fillBlank(next, 'returnVideoLink', info.returnVideoLink)

      return fillBlank(next, 'forwardVideoLink', info.forwardVideoLink)
    } catch {
      return values
    }
  }
}
