import {
  commonFields,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Nykaa's support ticket form.
 *
 * It has no upload slots of its own — the core's claim flow puts the evidence
 * LINKS into the ticket body — so there are no form-named files. The row's
 * images and videos still come along, in `supporting/`, for anyone who needs to
 * attach them by hand.
 */
export const nykaaClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: [],
  fields: [
    ['Subject', text(config.subject)],
    ['Issue', text(config.issue)],
    ['Vendor code', text(config.vendorCode)],
    ['SKU ID', text(config.skuId)],
    ['Reverse AWB', text(config.reverseAwb)],
    ['Return type', text(config.returnType)],
    ...commonFields(doc)
  ],
  description: templateDescription(doc, { ...config, description: config.emailBody })
})
