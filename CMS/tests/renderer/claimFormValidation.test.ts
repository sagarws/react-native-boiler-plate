import { describe, expect, it } from 'vitest'
import type { ClaimValues } from '@renderer/pages/claims/create/platforms/common/payload'
import {
  MYNTRA_INITIAL_CLAIM_DETAILS,
  NYKAA_INITIAL_CLAIM_DETAILS,
  OTHER_INITIAL_CLAIM_DETAILS
} from '@shared/types/cmsCreate'
import {
  amazonValidation,
  commonValidation,
  delhiveryValidation,
  meeshoValidation,
  myntraValidation,
  nykaaValidation,
  snapdealValidation,
  tataCliqValidation,
  xbeesValidation
} from '@renderer/pages/claims/create/validation'
import { hasErrors } from '@renderer/pages/claims/create/useClaimForm'

/**
 * What a claim must carry before Create Claim will let it be saved.
 *
 * These rules are a PORT of TrackVid-FE's, and the two surfaces write the same
 * documents — so a rule that drifts here is a claim the desktop accepts and the
 * web form refuses, or worse, one the backend stores incomplete. The cases
 * below are the ones that cost something when they are wrong.
 */

/**
 * One branch of an error tree, or an empty object when the branch is clean.
 *
 * The validator PRUNES branches with nothing in them, so a bundle that passes
 * every rule is absent rather than present and empty — which is what lets
 * `hasErrors` answer without walking the whole shape.
 */
const branch = (errors: Record<string, unknown>, key: string): Record<string, string> =>
  (errors[key] as Record<string, string> | undefined) ?? {}

const base = (over: Partial<ClaimValues> = {}): ClaimValues =>
  ({
    eCommercePlatform: 'platform-id',
    AWBNumber: '1234567890',
    typeOfClaim: 'damaged',
    returnProductImage: 'key/return.jpg',
    returnVideoLink: 'https://example.test/video.mp4',
    additionalFieldTitle: '',
    additionalFieldValue: '',
    myntraClaimDetails: { ...MYNTRA_INITIAL_CLAIM_DETAILS },
    nykaaClaimDetails: { ...NYKAA_INITIAL_CLAIM_DETAILS },
    otherClaimDetails: { ...OTHER_INITIAL_CLAIM_DETAILS },
    ...over
  })

describe('the rules every platform shares', () => {
  it('accepts a complete claim', () => {
    expect(hasErrors(commonValidation([])(base()))).toBe(false)
  })

  it('refuses one with no AWB, platform or claim type', () => {
    const errors = commonValidation([])(
      base({ AWBNumber: '', eCommercePlatform: '', typeOfClaim: '' })
    )

    expect(errors.AWBNumber).toBe('*AWB number is required')
    expect(errors.eCommercePlatform).toBe('*E-commerce platform is required')
    expect(errors.typeOfClaim).toBe('*Type of claim is required')
  })

  it('takes the video EITHER as a recording or as a link', () => {
    // The two are alternatives, and the message hangs off a field nobody types
    // in — `eitherVideoOrLink`, next to the upload control.
    expect(commonValidation([])(base({ returnVideoLink: '' })).eitherVideoOrLink).toBe(
      '*Return Video is required'
    )
    expect(
      commonValidation([])(base({ returnVideoLink: '', returnVideo: 'key/v.mp4' }))
        .eitherVideoOrLink
    ).toBeUndefined()
  })

  it('asks for a SKU only once the operator has been offered a choice', () => {
    // `skus` is non-empty only when the order lookup matched more than one
    // master row. With one row there is nothing to pick and nothing to ask.
    expect(commonValidation([])(base({ skuName: '' })).skuName).toBeUndefined()
    expect(commonValidation(['A', 'B'])(base({ skuName: '' })).skuName).toBe('Please select a SKU')
    // Whitespace is not a choice.
    expect(commonValidation(['A', 'B'])(base({ skuName: '   ' })).skuName).toBe(
      'Please select a SKU'
    )
  })
})

describe('the platforms that carry their evidence in a bundle', () => {
  it('Delhivery wants a lane, a subcategory, a label and at least one photo', () => {
    const bundle = branch(delhiveryValidation([])(base()), 'otherClaimDetails')

    expect(bundle.domestic).toBe('*Domestic is required')
    expect(bundle.subcategory).toBe('*Subcategory is required')
    expect(bundle.shippingLabelImage).toBe('*Shipping label image is required')
    expect(bundle.packingImages).toBe('*At least one evidence image is required')
  })

  it('Amazon takes one or two photographs of the return contents, not three', () => {
    const withContents = (count: number) =>
      branch(
        amazonValidation([])(
          base({
            otherClaimDetails: {
              ...OTHER_INITIAL_CLAIM_DETAILS,
              fulfillmentChannel: 'Fee related disputes',
              shippingLabelImage: 'key/label.jpg',
              contentsOfReturnImages: Array.from({ length: count }, (_, i) => `key/${i}.jpg`)
            }
          })
        ),
        'otherClaimDetails'
      ).contentsOfReturnImages

    expect(withContents(0)).toBe('*At least one photo of the return contents is required')
    expect(withContents(1)).toBeUndefined()
    expect(withContents(2)).toBeUndefined()
    expect(withContents(3)).toBe('*Maximum two photos allowed')
  })

  it('Xbees wants all four faces of the box, named', () => {
    const three = branch(
      xbeesValidation([])(
      base({
        otherClaimDetails: {
          ...OTHER_INITIAL_CLAIM_DETAILS,
          disputeAmount: '500',
          packingImages: [
            { fileKey: 'a', side: 'top' },
            { fileKey: 'b', side: 'right' },
            { fileKey: 'c', side: 'bottom' }
          ]
        }
      })
      ),
      'otherClaimDetails'
    )

    expect(three.packingImages).toBe(
      '*All four package photos (Top, Right, Bottom, Left) are required'
    )

    // Four entries is not enough — they have to be four DIFFERENT faces, and
    // one of them carrying no file is a slot nobody filled.
    const blank = branch(
      xbeesValidation([])(
      base({
        otherClaimDetails: {
          ...OTHER_INITIAL_CLAIM_DETAILS,
          disputeAmount: '500',
          packingImages: [
            { fileKey: 'a', side: 'top' },
            { fileKey: 'b', side: 'right' },
            { fileKey: 'c', side: 'bottom' },
            { fileKey: '', side: 'left' }
          ]
        }
      })
      ),
      'otherClaimDetails'
    )

    expect(blank.packingImages).toBe(
      '*All four package photos (Top, Right, Bottom, Left) are required'
    )
  })

  it('Xbees refuses a disputed amount that is not a positive number', () => {
    const amount = (value: string) =>
      branch(
        xbeesValidation([])(
          base({
            otherClaimDetails: {
              ...OTHER_INITIAL_CLAIM_DETAILS,
              disputeAmount: value,
              packingImages: [
                { fileKey: 'a', side: 'top' },
                { fileKey: 'b', side: 'right' },
                { fileKey: 'c', side: 'bottom' },
                { fileKey: 'd', side: 'left' }
              ]
            }
          })
        ),
        'otherClaimDetails'
      ).disputeAmount

    expect(amount('')).toBe('*Dispute amount is required')
    expect(amount('0')).toBe('*Dispute amount must be a positive number')
    expect(amount('-5')).toBe('*Dispute amount must be a positive number')
    expect(amount('abc')).toBe('*Dispute amount must be a positive number')
    expect(amount('499.50')).toBeUndefined()
  })
})

describe('Tata CliQ, which mirrors the seller portal', () => {
  const qc = (over: Record<string, unknown>) =>
    branch(
      tataCliqValidation([])(
        base({
          otherClaimDetails: {
            ...OTHER_INITIAL_CLAIM_DETAILS,
            qcReason: '12',
            qcImages: {
              productImage: 'a',
              packingSlip: 'b',
              outerPackaging: 'c',
              shippingLabel: 'd'
            },
            ...over
          }
        })
      ),
      'otherClaimDetails'
    )

  it('asks for a sub-reason on Wrong Product and no other reason', () => {
    // Code 10 is Wrong Product, the one reason the portal asks twice about.
    expect(qc({ qcReason: '10', qcSubReason: '' }).qcSubReason).toBe(
      'Pick the sub-reason — Tata CliQ requires one for Wrong Product'
    )
    expect(qc({ qcReason: '10', qcSubReason: '02' }).qcSubReason).toBeUndefined()
    expect(qc({ qcReason: '12', qcSubReason: '' }).qcSubReason).toBeUndefined()
  })

  it('names the image slots that are missing, so the operator knows which', () => {
    const errors = qc({ qcImages: { productImage: 'a' } })

    // Not "images are required" — the slots by name, because they are the
    // portal's own named uploads and a reviewer opens each expecting one thing.
    expect(errors.qcImages).toContain('required')
    expect(errors.qcImages).not.toBe('*required')
  })

  it('does not require the videos, even where the portal asks for them', () => {
    // A claim an operator judges complete without footage is still worth
    // filing; the runner warns rather than the form blocking.
    expect(qc({ packagingVideoUrl: '', unboxingVideoUrl: '' }).packagingVideoUrl).toBeUndefined()
  })
})

describe('the platforms with their own shapes', () => {
  it('Meesho drops the barcode for a non-barcoded RTO, and never requires a packet id', () => {
    const meesho = (claimName: string) =>
      meeshoValidation(
        base({
          typeOfClaimName: claimName,
          receivedProductImage_1: 'a',
          reverseWayBillImage: 'b',
          subOrderNumber: '1',
          stateOfThePacket: '1'
        })
      )

    const normal = meesho('Something else')
    expect(normal.barcodeImage).toBe('*Barcode image is required')
    expect(normal.packetId).toBeUndefined()

    const nonBarcoded = meesho('I have received an RTO in a non-barcoded package')
    expect(nonBarcoded.barcodeImage).toBeUndefined()
    expect(nonBarcoded.packetId).toBeUndefined()
  })

  it('Meesho wants the logistics partner only for the proof-of-delivery claim', () => {
    const errors = meeshoValidation(
      base({
        typeOfClaimName:
          'Return/RTO product not received but marked delivered - Need Proof of Delivery',
        receivedProductImage_1: 'a',
        reverseWayBillImage: 'b',
        barcodeImage: 'c',
        packetId: 'p',
        subOrderNumber: '1',
        stateOfThePacket: '1'
      })
    )

    expect(errors.logisticsPartnerName).toBe('*Logistics partner name is required')
  })

  it('Myntra asks for a disputed amount on a partial return and nothing else', () => {
    const myntra = (typeOfClaim: string) =>
      branch(
        myntraValidation(
          base({
            typeOfClaim,
            myntraClaimDetails: {
              ...MYNTRA_INITIAL_CLAIM_DETAILS,
              shippingLabelImage: 'label',
              packingImages: ['a']
            }
          })
        ),
        'myntraClaimDetails'
      ).disputedAmount

    expect(myntra('partial_return')).toBe('*Disputed amount is required')
    expect(myntra('damaged')).toBeUndefined()
  })

  it('Snapdeal wants the first of each of its four photograph pairs', () => {
    const errors = snapdealValidation(base())

    expect(errors.outerPackageImage_1).toBe('*Outer package image 1 is required')
    expect(errors.innerPackageImage_1).toBe('*Inner package image 1 is required')
    expect(errors.productImage_1).toBe('*Product image 1 is required')
    expect(errors.podImage_1).toBe('*POD proof 1 is required')
    // The second of each pair is optional.
    expect(errors.outerPackageImage_2).toBeUndefined()
  })

  it('Nykaa takes one of exactly three return types', () => {
    const nykaa = (returnType: string) =>
      branch(
        nykaaValidation([])(
          base({
            nykaaClaimDetails: {
              vendorCode: 'V1',
              skuId: 'S1',
              returnType: returnType as 'RTO'
            }
          })
        ),
        'nykaaClaimDetails'
      ).returnType

    expect(nykaa('')).toBe('*Return Type is required')
    expect(nykaa('OTHER')).toBe('*Invalid return type')
    expect(nykaa('RTO')).toBeUndefined()
  })
})
