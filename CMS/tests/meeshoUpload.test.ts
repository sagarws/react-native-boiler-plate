import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The two decisions behind a failed Meesho video upload.
 *
 * From a claim that died on a 26MB clip:
 *
 *   [video] 25.2MB is over the 25.0MB limit — re-encoding to ~24.6MB at
 *           1080p, 3953kbps
 *   ⚠️ video could not be shrunk — re-encoded to 30.5MB, still over the limit
 *   HTTP 400 File too large. Maximum size: 25MB
 *           — set MEESHO_UPLOAD_FIELD (currently "file")
 *
 * Two things went wrong in three lines: the encode came out 24% above its own
 * target and the code gave up, and the failure then blamed a form field that
 * was never wrong. Both decisions are pure functions now, which is what these
 * tests are for.
 */

const require_ = createRequire(import.meta.url)

const { correctedBitrate } = require_('@trackvid/automation-core/common/videoCompress') as {
  correctedBitrate: (bitrate: number, target: number, achieved: number) => number
}

const { uploadFailureHint } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/claimApiFlow'
) as {
  uploadFailureHint: (input: {
    detail: string
    sentBytes?: number
    field?: string
    entityType?: string
  }) => { hint: string; tooLarge: boolean }
}

const MiB = 1024 * 1024

describe('correcting a bitrate from what it actually produced', () => {
  it('lands the encode that overshot by 24%', () => {
    // The real numbers: 3953kbps was asked for a 24.6MB target and produced
    // 30.5MB. What that bitrate really buys is now known, so the next attempt
    // is arithmetic rather than a guess.
    const corrected = correctedBitrate(3_953_000, 24.6 * MiB, 30.5 * MiB)

    expect(corrected).toBeLessThan(3_953_000)
    // 3953 × 24.6/30.5 ≈ 3188, less 3% for the muxing overhead.
    expect(corrected).toBeGreaterThan(3_000_000)
    expect(corrected).toBeLessThan(3_200_000)
  })

  it('aims under the target, never exactly at it', () => {
    // Landing on the cap is a failed upload after a two-minute encode.
    const target = 20 * MiB

    expect(correctedBitrate(4_000_000, target, target)).toBeLessThan(4_000_000)
  })

  it('leaves the bitrate alone when there is nothing to measure', () => {
    // A zero-byte result is a broken encode, not a bitrate that was too high.
    expect(correctedBitrate(4_000_000, 20 * MiB, 0)).toBe(4_000_000)
  })
})

describe('what an upload refusal is told to blame', () => {
  it('answers a size refusal with the size actually sent', () => {
    // Meesho's message names its own limit and never what it received, which
    // is the one fact an operator needs.
    const { hint, tooLarge } = uploadFailureHint({
      detail: 'File too large. Maximum size: 25MB',
      sentBytes: 32_000_000
    })

    expect(tooLarge).toBe(true)
    expect(hint).toBe(' — sent 32.0MB')
  })

  it('does NOT blame the form field for a size refusal', () => {
    // The reported bug, exactly: the old test was /file|multipart|part/ and
    // "File too large" contains "File", so every oversized video was reported
    // as a misconfigured form field.
    const { hint } = uploadFailureHint({ detail: 'File too large. Maximum size: 25MB', sentBytes: 1 })

    expect(hint).not.toContain('MEESHO_UPLOAD_FIELD')
  })

  it('names the field knob when the field really is the problem', () => {
    for (const detail of ['Unexpected field', 'LIMIT_UNEXPECTED_FILE', 'no file was uploaded']) {
      expect(uploadFailureHint({ detail }).hint).toContain('MEESHO_UPLOAD_FIELD')
    }
  })

  it('names the entity-type knob for an entity-type refusal', () => {
    expect(uploadFailureHint({ detail: 'invalid entity_type' }).hint).toContain(
      'MEESHO_UPLOAD_ENTITY_TYPE'
    )
  })

  it('adds nothing to a refusal that already explains itself', () => {
    for (const detail of ['Internal Server Error', 'Unsupported media type', '']) {
      expect(uploadFailureHint({ detail }).hint).toBe('')
    }
  })

  it('says nothing about a size it could not read', () => {
    // stat() failing must not print "sent 0.0MB" as though that were the file.
    expect(uploadFailureHint({ detail: 'File too large', sentBytes: 0 }).hint).toBe('')
  })
})
