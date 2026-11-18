import {
  commonFields,
  numbered,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Meesho's Raise Ticket form. Names follow the tags the core's claim flow
 * uploads each slot under (`barcode`, `product_1`, `waybill_1`, `video`,
 * `attach_1`).
 */
export const meeshoClaimResources: ClaimResourceBuilder = (doc, config) => ({
  files: [
    ...single('barcode', 'Barcode image', config.barcodeImage),
    ...numbered(i => `product_${i}`, 'Product images', config.productImage),
    ...numbered(i => `waybill_${i}`, 'Reverse waybill', config.reverseWaybill),
    ...single('video', 'Unpacking video', config.unpackingVideo),
    ...numbered(i => `attach_${i}`, 'Attachments', config.attachments)
  ],
  fields: [
    ['Sub order number', text(config.subOrderNumber)],
    ['AWB number', text(config.awbNumber)],
    ['Issue', text(config.typeOfClaim)],
    ['Packet ID', text(config.packetId)],
    ['State of packet', text(config.stateOfPacket)],
    ['Logistics partner', text(config.logisticsPartnerName)],
    ['Callback number', text(config.callbackNumber)],
    ...commonFields(doc)
  ],
  description: templateDescription(doc, config)
})
