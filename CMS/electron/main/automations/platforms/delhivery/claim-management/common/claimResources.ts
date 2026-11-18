import {
  commonFields,
  single,
  templateDescription,
  text,
  urls,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

const VIDEO = /\.(mp4|mov|webm|mkv)(\?|#|$)/i

/**
 * Delhivery's lost/damage claim form.
 *
 * `unboxingDoc` mixes the packing images and the return video in one list; the
 * portal names them `Unbox_Image_1…` and `Unbox_Video_1…`, counted separately,
 * which is what the core's claim flow uploads too.
 */
export const delhiveryClaimResources: ClaimResourceBuilder = (doc, config) => {
  let images = 0
  let videos = 0

  return {
    files: [
      ...single('Shipping_Label', 'Shipping label', config.shippingLabel),
      ...urls(config.unboxingDoc).map(url =>
        VIDEO.test(url)
          ? { name: `Unbox_Video_${++videos}`, field: 'Unboxing video', url }
          : { name: `Unbox_Image_${++images}`, field: 'Unboxing images', url }
      )
    ],
    fields: [
      ['AWB', text(config.awbNumber)],
      ['Domestic', text(config.domestic)],
      ['Shipment issue', text(config.shipmentIssue)],
      ['Sub category', text(config.subcategory)],
      ['Claim type', text(config.claimType)],
      ...commonFields(doc)
    ],
    description: templateDescription(doc, config)
  }
}
