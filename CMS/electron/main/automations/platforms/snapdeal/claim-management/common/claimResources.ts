import {
  commonFields,
  numbered,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Snapdeal's Raise Dispute form.
 *
 * Image names are the portal's own slot keys — the stems it gives each file it
 * uploads (`outer_packaging_packslip_image1_<seller>_Query_<ts>.jpg` in a
 * captured manual claim) and the same ones the core's API flow sends. Slot
 * labels are the form's four attachment rows plus its one video.
 */
export const snapdealClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: [
    ...numbered(i => `outer_packaging_packslip_image${i}`, 'Outer packaging (with packslip)', config.outerPackagingImage),
    ...numbered(i => `inner_packaging_image${i}`, 'Inner packaging', config.innerPackagingImage),
    ...numbered(i => `product_image${i}`, 'Product', config.attachProductImage),
    ...numbered(i => `POD_slip_image${i}`, 'POD slip', config.proofOfDeliveryImage),
    ...single('video', 'Attach Video', config.unpackingVideo)
  ],
  fields: [
    ['Suborder Id', text(config.subOrderNumber) || text(doc.subOrderNumber)],
    ['AWB Number', text(config.awbNumber) || text(doc.AWBNumber)],
    ['Issue type', text(config.typeOfClaim) || text(doc.typeOfClaim)],
    ...commonFields(doc)
  ],
  description: templateDescription(doc, config)
})
