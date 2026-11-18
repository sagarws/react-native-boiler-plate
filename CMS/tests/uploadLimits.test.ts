import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { UPLOAD_LIMITS, hasUploadLimit, uploadLimitFor } from '@shared/constants/uploadLimits'

/**
 * How large an attachment each marketplace takes.
 *
 * The number exists twice by necessity: the core owns it (the claim runner
 * shrinks a video against it) and the renderer mirrors it (the Resources button
 * has to know whether the choice is worth offering before anything runs). Two
 * definitions of one cap is how the runner and the download come to disagree
 * about what will upload, so they are compared here rather than trusted.
 */

const require_ = createRequire(import.meta.url)

const core = require_('@trackvid/automation-core/common/uploadLimits') as {
  UPLOAD_LIMITS: Record<string, number>
  uploadLimitFor: (platform: string) => number | null
  platformsWithUploadLimit: () => string[]
}

describe('the upload limits', () => {
  it('names the same platforms as the core', () => {
    expect(Object.keys(UPLOAD_LIMITS).sort()).toEqual([...core.platformsWithUploadLimit()].sort())
  })

  it('agrees with the core on every number', () => {
    for (const platform of core.platformsWithUploadLimit()) {
      expect(uploadLimitFor(platform)).toBe(core.uploadLimitFor(platform))
    }
  })

  it('counts in millions, not MiB', () => {
    // "Maximum size: 25MB" does not say which, and the two are 1.2MB apart.
    // Sized against MiB, a file we spent two minutes encoding can still be
    // refused — so the smaller reading is the one both sides use.
    expect(uploadLimitFor('meesho')).toBe(25_000_000)
    expect(uploadLimitFor('meesho')).toBeLessThan(25 * 1024 * 1024)
  })

  it('answers for every spelling of a platform', () => {
    // Rows carry what TrackVid stored and tabs carry a label.
    for (const spelling of ['meesho', 'Meesho', 'MEESHO']) {
      expect(uploadLimitFor(spelling)).toBe(25_000_000)
    }
  })

  it('says null for a platform that has never stated a cap', () => {
    // Absent means UNKNOWN, not unlimited: nothing may compress a file against
    // a number this app invented, and the download must not offer a choice it
    // cannot honour.
    for (const platform of ['flipkart', 'ajio', 'myntra', 'tatacliq', '']) {
      expect(uploadLimitFor(platform)).toBeNull()
      expect(hasUploadLimit(platform)).toBe(false)
    }

    expect(hasUploadLimit('Meesho')).toBe(true)
  })
})
