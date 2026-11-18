import { keyOf, setIn, type BulkSpec } from '../common/bulk'

/**
 * Amazon in Normal Bulk Claim: the first two screenshots are the return's
 * contents, the third the shipping label, the fourth the serial number — the
 * form's own placement.
 */
export const amazonBulk: BulkSpec = {
  columns: [],
  place: (values, screenshots) => {
    const [contents1, contents2, shipping, serial] = screenshots.slice(0, 4)
    let next = setIn(
      values,
      'otherClaimDetails.contentsOfReturnImages',
      [contents1, contents2].map(keyOf).filter(Boolean)
    )

    if (shipping) next = setIn(next, 'otherClaimDetails.shippingLabelImage', keyOf(shipping))
    if (serial) next = setIn(next, 'otherClaimDetails.serialNumberImage', keyOf(serial))

    return { values: next, sideImages: [] }
  }
}
