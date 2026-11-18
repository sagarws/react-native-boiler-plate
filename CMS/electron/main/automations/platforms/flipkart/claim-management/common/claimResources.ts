import {
  commonFields,
  numbered,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Flipkart's SPF claim form: a shipping label slot and evidence images. Names
 * follow the core's claim flow (`shipping-label`, `evidence_1`).
 */
export const flipkartClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: [
    ...single('shipping-label', 'Shipping label', config.shippingLabel),
    ...numbered(i => `evidence_${i}`, 'Evidence images', config.evidenceImages)
  ],
  fields: [
    ['Order ID', text(config.orderId)],
    ['Claim area', text(config.claimArea)],
    ['Issue area', text(config.issueArea)],
    ['Issue type', text(config.issueType)],
    ...commonFields(doc)
  ],
  description: templateDescription(doc, config)
})
