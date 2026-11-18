import { platformKey } from '@shared/utils/platformKey'

/**
 * How large an attachment each marketplace will accept.
 *
 * MIRRORS the core's `common/uploadLimits.js`, which is the source of truth —
 * the renderer cannot load the core, and the Resources button has to know
 * whether a choice is even worth offering before anything runs. A test asserts
 * the two agree, so a limit changed in one place and forgotten in the other
 * fails there rather than on an operator's screen.
 *
 * COUNTED IN MILLIONS, not MiB, for the reason the core states: a marketplace
 * says "25MB" without saying which, and the two readings are 1.2MB apart.
 *
 * ABSENT MEANS UNKNOWN, not unlimited — a platform with no entry has never told
 * us a number, and nothing should compress a file against one this app made up.
 */
export const UPLOAD_LIMITS: Record<string, number> = {
  meesho: 25_000_000,
  // Snapdeal's own words: "File is too large. Please upload maximum of 5 MB
  // files". Five times tighter than Meesho's, which changes which files are the
  // problem — a phone photo clears 5MB before anybody films anything.
  snapdeal: 5_000_000
}

/** The cap for one platform, or null when it has never stated one. */
export const uploadLimitFor = (platform: string): number | null =>
  UPLOAD_LIMITS[platformKey(platform)] ?? null

/** Is a video worth asking about on this platform? */
export const hasUploadLimit = (platform: string): boolean => uploadLimitFor(platform) !== null
