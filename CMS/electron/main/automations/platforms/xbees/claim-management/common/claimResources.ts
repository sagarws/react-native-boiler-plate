import {
  commonFields,
  single,
  templateDescription,
  text,
  type ClaimResourceBuilder
} from '@main/automations/common/claimResources'

/**
 * Xpressbees' raise dispute form.
 *
 * The names are the portal's proof slots — the same `CMS_TO_PHOTO_SLOT` and
 * video slots the core's claim flow uploads into. TrackVid stores the photos
 * by side (Top/Bottom/Left/Right); the form calls them Front/Back/sides.
 */
export const xbeesClaimResources: ClaimResourceBuilder = (doc, config) => {
  const photos = (config.packagePhotos ?? {}) as Record<string, unknown>

  return {
    files: [
      ...single('PhotoProof1_Front', 'Photo proof — front', photos.Top),
      ...single('PhotoProof2_Back', 'Photo proof — back', photos.Bottom),
      ...single('PhotoProof3_RightSide', 'Photo proof — right side', photos.Right),
      ...single('PhotoProof4_LeftSide', 'Photo proof — left side', photos.Left),
      ...single('UnboxingVideoProof1', 'Unboxing video proof', config.unboxingVideo),
      ...single('PackagingVideoProof1', 'Packaging video proof', config.packagingVideo)
    ],
    fields: [
      ['AWB', text(config.awbNumber)],
      ['Dispute reason', text(config.disputeReason)],
      ['Dispute sub-reason', text(config.disputeSubReason)],
      ['Dispute amount', text(config.disputeAmount)],
      ...commonFields(doc)
    ],
    description: templateDescription(doc, config)
  }
}
