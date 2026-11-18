import { keyOf, setIn, type BulkSpec } from './bulk'

/**
 * Shipping label first, up to ten packing images after it, in the shared
 * `otherClaimDetails` bundle — the placement Flipkart's and Delhivery's forms
 * both make, so it lives once, here.
 */
export const shippingAndPackingPlacement: BulkSpec['place'] = (values, screenshots) => {
  const [shipping, ...packing] = screenshots.slice(0, 11)
  let next = values

  if (shipping) next = setIn(next, 'otherClaimDetails.shippingLabelImage', keyOf(shipping))
  next = setIn(next, 'otherClaimDetails.packingImages', packing.map(keyOf).filter(Boolean))

  return { values: next, sideImages: [] }
}
