import {
  PACKING_SIDES,
  type ICms,
  type XbeesPackingImage
} from '@shared/types/cmsCreate'
import type { FormErrors } from './useClaimForm'
import { needsSubReason, requiredQcImageSlots } from './tatacliqQc'

/**
 * What a claim must carry before it can be saved.
 *
 * PORTED FROM TrackVid-FE (`src/validations/cms-create.validation.ts`), rule for
 * rule and message for message. The wording matters as much as the rule: an
 * operator who files on both surfaces should be corrected in the same words,
 * and a message that differs is a second thing to keep in step.
 *
 * Yup is not here — these are plain functions returning the same nested error
 * tree Formik expects, which is what `useClaimForm` renders from. The rules are
 * simple enough that a schema library would be the bigger of the two.
 *
 * NOT THE LAST WORD. The backend validates again, and for Tata CliQ the
 * automation core validates the reason/sub-reason pair a third time before it
 * submits. These rules exist to catch the mistake while the operator is still
 * looking at the field, not to be the only gate.
 */

type Values = ICms & Record<string, unknown>
export type Validator = (values: Values) => FormErrors

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Drops empty branches so `hasErrors` is not fooled by `{ a: {} }`. */
const prune = (errors: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(errors)) {
    if (value === undefined) continue

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = prune(value as Record<string, unknown>)

      if (Object.keys(nested).length > 0) out[key] = nested

      continue
    }

    out[key] = value
  }

  return out
}

/**
 * The rule every platform shares: a return video, one way or the other.
 *
 * Reported against `eitherVideoOrLink`, which is not a field anybody types in —
 * it is the anchor the message renders under, next to the upload control. The
 * FE does the same, and the forms are ported expecting it.
 */
const videoOrLink = (values: Values): string | undefined =>
  text(values.returnVideo) || text(values.returnVideoLink) ? undefined : '*Return Video is required'

/** The fields nothing can be filed without. */
const core = (values: Values): Record<string, unknown> => ({
  eCommercePlatform: text(values.eCommercePlatform) ? undefined : '*E-commerce platform is required',
  AWBNumber: text(values.AWBNumber) ? undefined : '*AWB number is required',
  typeOfClaim: text(values.typeOfClaim) ? undefined : '*Type of claim is required',
  eitherVideoOrLink: videoOrLink(values)
})

/**
 * The SKU, when the operator was offered a choice.
 *
 * `skus` is non-empty only when `/order/{awb}` matched more than one master row
 * — a multi-line order — and the picker wrote the operator's pick into
 * `skuName`. Trimmed and required so a hand-edited state cannot slip past the
 * picker with whitespace.
 */
const skuRule = (values: Values, skus: string[]): string | undefined =>
  skus.length > 0 && !text(values.skuName) ? 'Please select a SKU' : undefined

const bundleOf = (values: Values): Record<string, unknown> =>
  (values.otherClaimDetails as Record<string, unknown> | undefined) ?? {}

/** The default rules — AJIO, Shopify, and every custom company platform. */
export const commonValidation =
  (skus: string[]): Validator =>
  (values) =>
    prune({
      ...core(values),
      skuName: skuRule(values, skus),
      returnProductImage: text(values.returnProductImage)
        ? undefined
        : '*Return product image required'
    })

export const flipkartValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = bundleOf(values)
    const packing = Array.isArray(bundle.packingImages) ? bundle.packingImages : []

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      otherClaimDetails: {
        claimArea: text(bundle.claimArea) ? undefined : '*Claim area is required',
        shippingLabelImage: text(bundle.shippingLabelImage)
          ? undefined
          : '*Shipping label image is required',
        packingImages:
          packing.length < 3
            ? '*At least three packing images are required'
            : packing.length > 10
              ? '*Maximum ten packing images allowed'
              : undefined
      }
    })
  }

export const delhiveryValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = bundleOf(values)
    const packing = Array.isArray(bundle.packingImages) ? bundle.packingImages : []

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      otherClaimDetails: {
        domestic: text(bundle.domestic) ? undefined : '*Domestic is required',
        subcategory: text(bundle.subcategory) ? undefined : '*Subcategory is required',
        shippingLabelImage: text(bundle.shippingLabelImage)
          ? undefined
          : '*Shipping label image is required',
        packingImages:
          packing.length < 1
            ? '*At least one evidence image is required'
            : packing.length > 10
              ? '*Maximum ten evidence images allowed'
              : undefined
      }
    })
  }

/**
 * Xbees wants exactly four package photos, one per face of the box, and a
 * positive disputed amount. No shipping label is collected.
 */
export const xbeesValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = bundleOf(values)
    const packing = Array.isArray(bundle.packingImages)
      ? (bundle.packingImages as XbeesPackingImage[])
      : []
    const bySide = new Map(packing.map((entry) => [entry?.side, entry?.fileKey]))
    const allFour =
      packing.length === PACKING_SIDES.length &&
      PACKING_SIDES.every((side) => text(bySide.get(side)) !== '')
    const amount = text(bundle.disputeAmount)
    const parsed = Number(amount)

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      otherClaimDetails: {
        packingImages: allFour
          ? undefined
          : '*All four package photos (Top, Right, Bottom, Left) are required',
        disputeAmount: !amount
          ? '*Dispute amount is required'
          : !Number.isFinite(parsed) || parsed <= 0
            ? '*Dispute amount must be a positive number'
            : undefined
      }
    })
  }

/**
 * Tata CliQ mirrors the seller portal's own QC Fail form, so the rules are the
 * portal's — see `tatacliqQc.ts`.
 *
 * The sub-reason is required for Wrong Product, the one reason the portal asks
 * a second question for, and only then. The four starred image slots are
 * required and the two Additional ones are not; the portal does not enforce
 * that on the request, which is exactly why it is enforced here — a claim
 * missing its packing slip is refused days later by a human, not by a 400.
 *
 * The videos are deliberately NOT required even where they apply. A claim an
 * operator judges complete without footage is still worth filing, and blocking
 * it here would make that judgement ours.
 */
export const tataCliqValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = bundleOf(values)
    const reason = text(bundle.qcReason)
    const images = (bundle.qcImages as Record<string, string> | undefined) ?? {}
    const missing = requiredQcImageSlots()
      .filter((slot) => !images[slot.key])
      .map((slot) => slot.label)

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      otherClaimDetails: {
        qcReason: reason ? undefined : '*QC failure reason is required',
        qcSubReason:
          needsSubReason(reason) && !text(bundle.qcSubReason)
            ? 'Pick the sub-reason — Tata CliQ requires one for Wrong Product'
            : undefined,
        qcImages:
          missing.length > 0
            ? `*${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`
            : undefined
      }
    })
  }

export const amazonValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = bundleOf(values)
    const contents = Array.isArray(bundle.contentsOfReturnImages)
      ? bundle.contentsOfReturnImages
      : []

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      otherClaimDetails: {
        fulfillmentChannel: text(bundle.fulfillmentChannel)
          ? undefined
          : '*Fulfillment channel is required',
        contentsOfReturnImages:
          contents.length < 1
            ? '*At least one photo of the return contents is required'
            : contents.length > 2
              ? '*Maximum two photos allowed'
              : undefined,
        shippingLabelImage: text(bundle.shippingLabelImage)
          ? undefined
          : '*Shipping-label photograph is required'
      }
    })
  }

/** The one claim type Meesho files without a barcode. */
const MEESHO_NON_BARCODED = 'I have received an RTO in a non-barcoded package'
const MEESHO_NEEDS_POD =
  'Return/RTO product not received but marked delivered - Need Proof of Delivery'

export const meeshoValidation: Validator = (values) => {
  const claimName = typeof values.typeOfClaimName === 'string' ? values.typeOfClaimName : ''
  const nonBarcoded = claimName === MEESHO_NON_BARCODED

  return prune({
    ...core(values),
    receivedProductImage_1: text(values.receivedProductImage_1)
      ? undefined
      : '*Received product image is required',
    reverseWayBillImage: text(values.reverseWayBillImage)
      ? undefined
      : '*Reverse waybill image is required',
    barcodeImage: nonBarcoded || text(values.barcodeImage) ? undefined : '*Barcode image is required',
    subOrderNumber: text(values.subOrderNumber) ? undefined : '*Sub order number is required',
    stateOfThePacket: text(values.stateOfThePacket)
      ? undefined
      : '*State of the packet is required',
    logisticsPartnerName:
      claimName === MEESHO_NEEDS_POD && !text(values.logisticsPartnerName)
        ? '*Logistics partner name is required'
        : undefined
    // Packet ID is OPTIONAL, by request — a claim is saved without one. The
    // Meesho runner still checks for it before filing (preflight.ts), because
    // Meesho's own ticket form will not submit without it.
  })
}

export const myntraValidation: Validator = (values) => {
  const bundle = (values.myntraClaimDetails as Record<string, unknown> | undefined) ?? {}
  const packing = Array.isArray(bundle.packingImages)
    ? (bundle.packingImages as unknown[]).filter((entry) => !!entry)
    : []
  const disputed = text(bundle.disputedAmount)
  const disputedNumber = Number(disputed)
  const claim = text(values.typeOfClaim)

  return prune({
    ...core(values),
    myntraClaimDetails: {
      shippingLabelImage: text(bundle.shippingLabelImage) ? undefined : '*Shipping label is required',
      packingImages:
        packing.length < 1
          ? '*At least one product & outer packing image is required'
          : packing.length > 10
            ? '*Maximum 10 product & outer packing images allowed'
            : undefined,
      // Both of these apply to one claim type each, and are silent otherwise.
      disputedAmount:
        claim !== 'partial_return'
          ? undefined
          : !disputed
            ? '*Disputed amount is required'
            : !Number.isFinite(disputedNumber) || disputedNumber <= 0
              ? '*Disputed amount must be a positive number'
              : undefined,
      physicalReceivedSku:
        claim === 'wrong_returns_own_product' && !text(bundle.physicalReceivedSku)
          ? '*Physical received SKU is required'
          : undefined
    }
  })
}

export const snapdealValidation: Validator = (values) =>
  prune({
    ...core(values),
    outerPackageImage_1: text(values.outerPackageImage_1)
      ? undefined
      : '*Outer package image 1 is required',
    innerPackageImage_1: text(values.innerPackageImage_1)
      ? undefined
      : '*Inner package image 1 is required',
    productImage_1: text(values.productImage_1) ? undefined : '*Product image 1 is required',
    podImage_1: text(values.podImage_1) ? undefined : '*POD proof 1 is required'
  })

export const nykaaValidation =
  (skus: string[]): Validator =>
  (values) => {
    const bundle = (values.nykaaClaimDetails as Record<string, unknown> | undefined) ?? {}
    const returnType = text(bundle.returnType)

    return prune({
      ...core(values),
      skuName: skuRule(values, skus),
      returnProductImage: text(values.returnProductImage)
        ? undefined
        : '*Return product image required',
      nykaaClaimDetails: {
        vendorCode: text(bundle.vendorCode) ? undefined : '*Vendor Code is required',
        skuId: text(bundle.skuId) ? undefined : '*SKU ID is required',
        returnType: !returnType
          ? '*Return Type is required'
          : !['RTO', 'DTO', 'REPL'].includes(returnType)
            ? '*Invalid return type'
            : undefined
      }
    })
  }
