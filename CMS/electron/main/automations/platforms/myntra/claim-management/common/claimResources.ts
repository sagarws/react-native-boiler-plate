import {
  commonFields,
  numbered,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Myntra's claim form. Names follow the labels the core pushes each proof
 * under (`shipping_label`, `packing_1`, `damaged_video`). The description
 * field there is "Additional info".
 */
export const myntraClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: [
    ...single('shipping_label', 'Shipping label image', config.shippingLabelImage),
    ...numbered(i => `packing_${i}`, 'Product packing images', config.productPackingImages),
    ...single('damaged_video', 'Damaged product video', config.damagedVideo)
  ],
  fields: [
    ['Order ID', text(config.orderId)],
    ['Issue category', text(config.issueCategory)],
    ['Disputed amount', text(config.disputedAmount)],
    ['Physical received SKU', text(config.physicalReceivedSku)],
    ...commonFields(doc)
  ],
  description: templateDescription(doc, { ...config, description: config.additionalInfo })
})
