import {
  commonFields,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * AJIO's Help Center claim.
 *
 * Its one attachment is the six-side images PDF, named `<AWB> - Side Images`
 * exactly as the core's claim flow uploads it. The config carries that PDF as a
 * raw S3 key, so the resolved URL on the document is used instead.
 */
export const ajioClaimResources: ClaimResourceBuilder = (doc, config) => {
  const awb = text(doc.AWBNumber) || text(config.awbNumber) || 'claim'

  return {
    files: single(`${awb} - Side Images`, 'Attachment (six side images)', doc.sixSideImages),
    fields: [
      ['Return AWB', awb],
      ['POB ID', text(config.pobid) || text(doc.pobid)],
      ['Seller SKU', text(config.sku) || text(doc.skuName)],
      ['Issue type', text(doc.typeOfClaim)],
      ...commonFields(doc)
    ],
    description: templateDescription(doc, config)
  }
}
