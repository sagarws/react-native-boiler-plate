import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { afterAll, describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * Fitting an unpacking video inside Meesho's 25MB cap.
 *
 * Observed as a claim that simply did not file: "UPLOAD_FAILED: video —
 * Attachment upload failed: HTTP 400 File too large. Maximum size: 25MB". A
 * phone shoots past 25MB in under a minute, so the single most persuasive thing
 * a claim can carry is the attachment most likely to be refused.
 *
 * WHAT IS PINNED IS THE SIZE OF THE RESULT, both ways. Under the cap, because
 * that is the point; and NOT far under it, because a claim is won or lost on
 * whether a reviewer can see the damage — squeezing 40MB into 5MB would be a
 * technically successful upload of useless evidence. The budget is meant to be
 * spent.
 *
 * These tests encode real video, so they need ffmpeg. Skipped rather than failed
 * where it is absent: it is an optional dependency here, and a machine without
 * it is meant to degrade to "could not shrink it" rather than break.
 */

interface VideoCompress {
  fitVideoToLimit: (
    input: string,
    options: { maxBytes: number; targetBytes?: number; tempDir?: string; logger?: unknown }
  ) => Promise<{ path: string; compressed: boolean; from: number; to: number; reason: string | null }>
}

const { fitVideoToLimit } = require_(
  '@trackvid/automation-core/common/videoCompress'
) as VideoCompress

const hasFfmpeg = (): boolean => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })

    return true
  } catch {
    return false
  }
}

const available = hasFfmpeg()
const dir = mkdtempSync(join(tmpdir(), 'trackvid-video-'))
const source = join(dir, 'unpacking.mp4')

/** Twelve seconds of 1080p motion — comfortably over the caps used below. */
if (available) {
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=12',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
      '-c:v', 'libx264', '-b:v', '8000k', '-c:a', 'aac', '-shortest',
      source
    ],
    { stdio: 'ignore' }
  )
}

const quiet = { info: () => undefined, warn: () => undefined }
const MB = 1024 * 1024

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!available)('fitting a video to an upload limit', () => {
  it('lands under the cap, and close to it', async () => {
    const cap = 4 * MB
    const result = await fitVideoToLimit(source, { maxBytes: cap, tempDir: dir, logger: quiet })

    expect(result.compressed).toBe(true)

    const size = statSync(result.path).size

    expect(size).toBeLessThan(cap)
    // At least 80% of the budget spent. This is the half that stops a future
    // "be safer" change from quietly turning the evidence to mush: a result far
    // under the cap is quality thrown away for nothing.
    expect(size).toBeGreaterThan(cap * 0.8)

    rmSync(result.path, { force: true })
  }, 120_000)

  it('leaves a video that already fits completely alone', async () => {
    const result = await fitVideoToLimit(source, { maxBytes: 500 * MB, tempDir: dir, logger: quiet })

    // Not re-encoded, not copied — the same file. Re-encoding something that
    // fits would cost quality for no reason at all.
    expect(result.compressed).toBe(false)
    expect(result.path).toBe(source)
    expect(result.reason).toBeNull()
  }, 60_000)

  it('drops the resolution rather than starving the frame', async () => {
    // A budget far too thin for 1080p. Spent at 1080p it would be a blocky
    // mess; the same bitrate at a lower height still shows a torn packet.
    const cap = 512 * 1024
    const result = await fitVideoToLimit(source, { maxBytes: cap, tempDir: dir, logger: quiet })

    expect(result.compressed).toBe(true)
    expect(statSync(result.path).size).toBeLessThan(cap)

    const probed = execFileSync(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=height', '-of', 'csv=p=0', result.path],
      { encoding: 'utf8' }
    )

    expect(Number(probed.trim())).toBeLessThan(1080)

    rmSync(result.path, { force: true })
  }, 120_000)

  it('refuses a budget that could only produce unusable evidence', async () => {
    const result = await fitVideoToLimit(source, { maxBytes: 20 * 1024, tempDir: dir, logger: quiet })

    expect(result.compressed).toBe(false)
    expect(result.path).toBe(source)
    expect(result.reason).toBeTruthy()
    // And it says a real size. A flat headroom subtraction went negative
    // against a small cap, and the refusal announced a target of "-0.1MB".
    expect(result.reason).not.toContain('-')
  }, 60_000)

  it('clears up after itself', async () => {
    const before = readdirSync(dir)
    const result = await fitVideoToLimit(source, { maxBytes: 4 * MB, tempDir: dir, logger: quiet })

    if (result.compressed) rmSync(result.path, { force: true })

    // ffmpeg's two-pass statistics land beside the output under several names
    // depending on the build, and a claim run does this per video.
    expect(readdirSync(dir).filter(name => name.startsWith('ffpass'))).toEqual([])
    expect(readdirSync(dir).sort()).toEqual(before.sort())
  }, 120_000)

  it('never destroys the original', async () => {
    const size = statSync(source).size
    const result = await fitVideoToLimit(source, { maxBytes: 4 * MB, tempDir: dir, logger: quiet })

    // The original is what gets archived to the report share; only the copy
    // sent to the marketplace is cut down.
    expect(existsSync(source)).toBe(true)
    expect(statSync(source).size).toBe(size)

    if (result.compressed) rmSync(result.path, { force: true })
  }, 120_000)
})
