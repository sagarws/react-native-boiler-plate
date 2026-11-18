import type { ICms } from '@shared/types/cmsCreate'

/**
 * How a claim becomes a payload, split the way the folders are.
 *
 * `/cms/createCMS` and `/cms/updateCMS` both take a FLAT body, and which fields
 * they accept depends on the platform: Meesho's packet id means nothing to
 * AJIO, and posting a field the backend's multer config does not expect fails
 * the whole request with `MulterError: Unexpected field`. So each platform owns
 * its own answer, in its own folder, and the registry is the only place that
 * knows which answer belongs to which name.
 *
 * TrackVid-FE keeps all of this in one `useCreateCmsForm` behind a ladder of
 * `isMyntra` / `isMeesho` / `isSnapdeal` flags. That is the shape this repo
 * does not allow — adding a marketplace must be one folder and one registry
 * entry, not an edit to a shared file — so the rules are the same and the
 * arrangement is not.
 */

export type ClaimValues = ICms & Record<string, unknown>

/** `undefined` for anything that is not text with something in it. */
export const trimOrUndef = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

/** Every string in a list that has something in it, trimmed. */
export const cleanKeys = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value)) return undefined

  return value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim())
}

export interface UpdateContext {
  values: ClaimValues
  /**
   * The platform's name as the backend resolves it, case-insensitively.
   *
   * `/cms/updateCMS` routes several fields by it — `username` into the right
   * per-platform slot, `sixSideImages` onto the right branch — so any builder
   * that sends one of those must stamp `eCommercePlatform` alongside it.
   */
  platformLabel: string
}

/** A platform's contribution to the update body. */
export type UpdateBuilder = (context: UpdateContext) => Record<string, unknown>

export const noUpdateFields: UpdateBuilder = () => ({})

/**
 * The fields every platform's CREATE body may carry.
 *
 * A whitelist, not a filter of empties: see the note above about multer. `pobId`
 * is in the list but is AJIO's alone — the registry gates it, because a value
 * can survive a platform switch in form state and posting it on, say, Flipkart
 * ships a field that platform's create branch has no slot for.
 */
export const COMMON_CREATE_FIELDS: ReadonlySet<string> = new Set([
  'eCommercePlatform',
  'AWBNumber',
  'typeOfClaim',
  'costOfMissingArticle',
  'returnOrderId',
  'skuName',
  'pobId',
  'customerOrderNumber',
  'forwardAWB',
  'remark',
  'returnVideo',
  'returnVideoLink',
  'forwardVideo',
  'forwardVideoLink',
  'returnProductImage',
  'forwardSentProductImage',
  'podProof',
  'eitherVideoOrLink',
  'additionalFieldTitle',
  'additionalFieldValue'
])
