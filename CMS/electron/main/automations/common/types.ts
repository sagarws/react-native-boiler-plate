import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'

/**
 * Shapes shared by every platform runner.
 *
 * Platform-specific fields do NOT belong here — put them in the platform's own
 * folder. This file is only for what all platforms genuinely have in common.
 */

/**
 * The CMS claim document, as far as a runner cares.
 *
 * The evidence fields are the ones the backend actually writes — grouped by
 * role rather than a single array — and are read by the core's attachment
 * step, so their names must match what @trackvid/automation-core expects.
 */
export interface ClaimDocument {
  _id?: string
  AWBNumber?: string
  eCommercePlatform?: string
  subOrderNumber?: string
  typeOfClaim?: string
  description?: string
  outerPackagingImage?: string | string[]
  innerPackagingImage?: string | string[]
  attachProductImage?: string | string[]
  proofOfDeliveryImage?: string | string[]
  unpackingVideo?: string
  account?: { username?: string; _id?: string }
  /**
   * The config entry the platform's claim sequence reads, built by the backend.
   *
   * `file<Platform>Claim` reads `configEntry.awbNumber`, `.disputedAmount`,
   * `.shippingLabelImage` and so on — field names that exist only here, never
   * on the raw CMS document. Passing the document gave
   * `Fetch claim for "undefined" … searchId is required`.
   *
   * Built by TrackVid-BE's own `getPlatformConfig`, the same function the
   * server's runners are fed from, so the two cannot drift.
   */
  config?: Record<string, unknown> | null
  [key: string]: unknown
}

/** Every platform runner has this signature. */
export type ClaimRunner = (claim: QueuedClaim, doc: ClaimDocument) => Promise<ProcessResult>

/** What a core `file<Platform>Claim` returns. */
export interface FiledClaim {
  ticketId: string
  alreadyExisted: boolean
  cmsStatus: string | null
  [key: string]: unknown
}
