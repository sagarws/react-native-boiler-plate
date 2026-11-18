import type { CmsRow } from '@shared/types/cmsList'
import { getOrderScreenshots, updateCMS, uploadCmsImage } from '../../api'
import { createPdfFromImages_old } from '../../imageToPdf'

/**
 * Rebuilds an AJIO claim's six-side PDF from the VMS screenshots, after the fact.
 *
 * WHY THIS EXISTS. The backend's bulk create stores the SECOND screenshot as
 * `sixSideImages` instead of building a PDF, so the claim later uploads a JPEG
 * named "Side Images.pdf" and AJIO refuses it: "file content does not match PDF
 * format (HTTP 400)". This builds the real PDF the manual form would have built
 * and writes ONLY that key back — `/cms/updateCMS` treats every absent field as
 * untouched, rewrites the email body's link and re-queues the Drive conversion.
 */

/** The bulk-edit key this action answers to. Client-side only — never sent to the server's allowlist. */
export const SIX_SIDE_REBUILD_FIELD = '__ajioSixSideRebuild'

/** The manual form's grid: at most nine side images, and it refuses fewer than three. */
const MAX_SIDE_IMAGES = 9
const MIN_SIDE_IMAGES = 3

/**
 * The side images, chosen exactly as the manual AJIO form chooses them.
 *
 * Return screenshots: the first is the Return Product Image and the last the
 * Forward Sent image, so only the middle ones are sides (CommonRightPart's
 * `populate`). Forward screenshots then fill the empty slots, never repeating
 * one already used. Matching the form means a rebuilt claim carries the same
 * evidence a hand-made one would.
 */
export const pickSideImages = (returnShots: string[], forwardShots: string[]): string[] => {
  const reserved = new Set<string>()
  const first = returnShots[0]
  const last = returnShots.length > 1 ? returnShots[returnShots.length - 1] : undefined

  if (first) reserved.add(first)
  if (last) reserved.add(last)

  const sides: string[] = []
  const seen = new Set<string>(reserved)
  const middle = returnShots.length > 2 ? returnShots.slice(1, -1) : []

  for (const url of [...middle, ...forwardShots]) {
    if (sides.length >= MAX_SIDE_IMAGES) break
    if (!url || seen.has(url)) continue
    seen.add(url)
    sides.push(url)
  }

  return sides
}

/**
 * Screenshots for one AWB, or none.
 *
 * A missing VMS record answers with an error, and for the forward AWB that is
 * the normal case — so it is "no images", not a failure of the row.
 */
const screenshotsFor = async (awb: string, type: 'Return' | 'Forward'): Promise<string[]> => {
  if (!awb.trim()) return []

  try {
    const shots: unknown = (await getOrderScreenshots(awb.trim(), type)).data?.data

    return Array.isArray(shots) ? shots.filter((url): url is string => typeof url === 'string') : []
  } catch {
    return []
  }
}

/** Draws the images into one PDF, uploads it and answers its key. Throws on failure. */
export const uploadSixSidePdf = async (images: string[]): Promise<string> => {
  const pdf = await createPdfFromImages_old(images)
  const upload = new FormData()

  upload.append('file', pdf)
  upload.append('feedId', '')

  const key = (await uploadCmsImage(upload))?.data?.data?.key

  if (!key) throw new Error('PDF upload returned no key')

  return key
}

/**
 * Verify's ONLY complaint is the six-side count — the one failure "Force
 * create" may override. A row also missing its Return Product Image has no
 * screenshot at all, and forcing it would file a claim with no evidence.
 */
export const isSixSideOnlyFailure = (missingFields: string[]): boolean =>
  missingFields.length > 0 && missingFields.every(field => /^ajio:\s*six-side images\b/i.test(field.trim()))

/**
 * Force create's PDF: every side screenshot there is, however few.
 *
 * The first screenshot is the Return Product Image (the backend's bulk create
 * takes it for that slot), so the sides are the rest. With only one screenshot
 * there are no "rest", and that one photograph is all the evidence there is —
 * so it is used for both rather than refusing the row.
 */
export const buildForcedSixSidePdf = async (returnAwb: string): Promise<string> => {
  const shots = await screenshotsFor(returnAwb, 'Return')

  if (shots.length === 0) throw new Error('No VMS screenshots for this AWB')

  return uploadSixSidePdf(shots.length > 1 ? shots.slice(1) : shots)
}

export interface SixSideRebuildResult {
  id: string
  ok: boolean
  /** Why it failed, worded as the cause — failures are grouped by this. */
  reason?: string
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Builds, uploads and saves one row's PDF. Never throws: one bad row must not stop the batch. */
export const rebuildSixSidePdf = async (row: CmsRow): Promise<SixSideRebuildResult> => {
  if (row.platform.toLowerCase() !== 'ajio') return { id: row.id, ok: false, reason: 'Not an AJIO claim' }
  if (!row.returnAwb.trim()) return { id: row.id, ok: false, reason: 'No return AWB on the claim' }

  const [returnShots, forwardShots] = await Promise.all([
    screenshotsFor(row.returnAwb, 'Return'),
    screenshotsFor(row.forwardAwb, 'Forward')
  ])
  const sides = pickSideImages(returnShots, forwardShots)

  if (sides.length < MIN_SIDE_IMAGES) {
    return {
      id: row.id,
      ok: false,
      reason: `Fewer than ${MIN_SIDE_IMAGES} side images in VMS`
    }
  }

  try {
    const key = await uploadSixSidePdf(sides)

    await updateCMS({ cmsId: row.id, sixSideImages: key })

    return { id: row.id, ok: true }
  } catch (error) {
    return { id: row.id, ok: false, reason: errorText(error) }
  }
}
