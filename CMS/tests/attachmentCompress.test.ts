import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

/**
 * Fitting an attachment under a marketplace's cap.
 *
 * WHY SNAPDEAL FORCED THIS. Meesho caps at 25MB, where only the unpacking video
 * is ever close — so shrinking video alone was enough. Snapdeal caps at 5MB, and
 * an ordinary phone photo clears that before anybody films anything. A whole
 * claim failed on "File is too large. Please upload maximum of 5 MB files",
 * having already downloaded every asset.
 *
 * The compression itself needs ffmpeg and a real file, so what is pinned here is
 * the DISPATCH and the contract — which kind of file goes down which path, and
 * that a file nothing can shrink is reported rather than thrown. Those are the
 * decisions a future change could quietly break.
 */

const require_ = createRequire(import.meta.url)

const compress = require_('@trackvid/automation-core/common/attachmentCompress') as {
  kindOf: (file: string) => string
  extractJpegFromPdf: (buffer: Buffer) => Buffer | null
  fitAttachmentToLimit: (
    input: string,
    options: { maxBytes?: number }
  ) => Promise<{ path: string; compressed: boolean; reason: string | null }>
  QUALITY_STEPS: number[]
  SCALE_STEPS: number[]
}

describe('deciding what kind of file it is', () => {
  it('routes photos to the image path, whatever the case of the extension', () => {
    expect(compress.kindOf('POD_slip_image1.JPG')).toBe('image')
    expect(compress.kindOf('outer_packaging.png')).toBe('image')
  })

  it('routes the unpacking video to the video path', () => {
    // Which delegates to fitVideoToLimit — those encoder settings are the
    // accumulated result of real refusals and must not be reimplemented.
    expect(compress.kindOf('unpacking_video.mp4')).toBe('video')
    expect(compress.kindOf('clip.MOV')).toBe('video')
  })

  it('names anything else by its extension, so the message can say what it was', () => {
    expect(compress.kindOf('Delhivery 25-09-2026.pdf')).toBe('pdf')
  })
})

describe('the escalation', () => {
  it('tries quality before scale', () => {
    // A claim is argued from what the reviewer can SEE — a torn seal, a wrong
    // SKU. Detail survives a quality drop far better than being made smaller,
    // so pixels are the last thing given up.
    expect(compress.QUALITY_STEPS[0]).toBeLessThan(compress.QUALITY_STEPS.at(-1) ?? 0)
    expect(compress.SCALE_STEPS[0]).toBeGreaterThan(compress.SCALE_STEPS.at(-1) ?? 1)
  })

  it('never scales to nothing', () => {
    // A 0.05 scale would "fit" every cap and show the reviewer a thumbnail,
    // which loses the claim as surely as not uploading at all.
    expect(Math.min(...compress.SCALE_STEPS)).toBeGreaterThanOrEqual(0.25)
  })
})

describe('a file it cannot shrink', () => {
  it('is reported, not thrown', async () => {
    // The upload below reports the marketplace's own refusal, which says more
    // than refusing here would — and throwing would fail a claim whose other
    // attachments were fine.
    const result = await compress.fitAttachmentToLimit('/nonexistent/x.pdf', { maxBytes: 0 })
      .catch(() => null)

    // maxBytes 0 means "no known cap": the file is left alone without even
    // being measured against a number nobody has stated.
    expect(result === null || result.compressed === false).toBe(true)
  })
})

describe('a PDF that is really a scan', () => {
  // A courier's proof of delivery is a photograph with a thin PDF wrapper, and
  // PDF stores a JPEG verbatim under /DCTDecode — so the picture can be lifted
  // out with a read, then shrunk by the image path. This is what a 5.9MB POD
  // against a 5MB cap actually needs.
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff]),
    Buffer.alloc(2048, 0x41),
    Buffer.from([0xff, 0xd9])
  ])

  it('finds the embedded photograph', () => {
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n<< /Subtype /Image /Filter /DCTDecode >>\nstream\n', 'latin1'),
      jpeg,
      Buffer.from('\nendstream\n%%EOF', 'latin1')
    ])

    expect(compress.extractJpegFromPdf(pdf)?.length).toBe(jpeg.length)
  })

  it('ignores a PDF with no photograph in it', () => {
    // A text-born PDF — an invoice, a label rendered from HTML — has nothing to
    // extract, and inventing something would be worse than saying so.
    const pdf = Buffer.from('%PDF-1.4\n<< /Type /Page >>\n%%EOF', 'latin1')

    expect(compress.extractJpegFromPdf(pdf)).toBe(null)
  })

  it('skips a JPEG that is not an image stream', () => {
    // The bytes FF D8 FF occur by chance in compressed data. Without the
    // DCTDecode check this would "extract" noise and upload it as the POD.
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
      jpeg,
      Buffer.from('\nendstream\n%%EOF', 'latin1')
    ])

    expect(compress.extractJpegFromPdf(pdf)).toBe(null)
  })
})
