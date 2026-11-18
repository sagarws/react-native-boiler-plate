import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * What Flipkart's claim upload can be given.
 *
 * Its allowed list is four image extensions — the portal said so itself in a
 * FILE_TYPE_VALIDATION rejection — and a CMS row whose evidence includes a
 * video is a row that cannot be filed as it stands. That is worth pinning
 * because of how it failed: three attempts, each ending in
 *
 *   UPLOAD_FAILED … (r2485756038fpl_video_1789741986434.mp4): HTTP 503
 *   <TITLE>Internal Server Error</TITLE> … Internal Server Error - Write
 *
 * A 503 from the upload gateway, not a validation message. Nothing in it says
 * "we do not take videos", so nothing about the retry could have gone
 * differently.
 */

const require_ = createRequire(import.meta.url)

const {
  ALLOWED_UPLOAD_EXTENSIONS,
  httpBodySummary,
  isUnattachable,
  partitionEvidence
} = require_(
  '@trackvid/automation-core/platforms/flipkart/claim-management/common/attachments'
) as {
  ALLOWED_UPLOAD_EXTENSIONS: string[]
  httpBodySummary: (data: unknown, max?: number) => string
  isUnattachable: (url: string) => boolean
  partitionEvidence: (urls: unknown) => { uploadable: string[]; rejected: { url: string; ext: string }[] }
}

describe("what Flipkart's upload accepts", () => {
  it("is the four extensions Flipkart's own rejection listed", () => {
    // From the captured rejection: allowedExtensions [".jpg",".bmp",".jpeg",".png"].
    expect([...ALLOWED_UPLOAD_EXTENSIONS].sort()).toEqual(['.bmp', '.jpeg', '.jpg', '.png'])
  })

  it('treats video, audio and documents as unattachable', () => {
    for (const name of ['clip.mp4', 'clip.MOV', 'a.webm', 'a.mp3', 'label.pdf', 'bundle.zip']) {
      expect(isUnattachable(name)).toBe(true)
    }
  })

  it('does not call an image unattachable', () => {
    for (const name of ['a.png', 'a.JPG', 'a.jpeg', 'a.bmp']) expect(isUnattachable(name)).toBe(false)
  })
})

describe('partitioning a row’s evidence', () => {
  it('files the images and names the video', () => {
    const { uploadable, rejected } = partitionEvidence([
      'https://s3/trackvid/r2485756038fpl_video_1789741986434.mp4',
      'https://s3/trackvid/img_1.png',
      'https://s3/trackvid/img_2.jpeg'
    ])

    expect(uploadable).toHaveLength(2)
    expect(rejected.map(entry => entry.ext)).toEqual(['.mp4'])
  })

  it('sees through a signed URL and its casing', () => {
    // S3 hands back query strings, and a phone writes .MOV.
    const { rejected } = partitionEvidence([
      'https://s3/trackvid/clip.MOV?X-Amz-Signature=abc&X-Amz-Expires=900'
    ])

    expect(rejected).toHaveLength(1)
  })

  it('KEEPS a key with no extension rather than guessing', () => {
    // The rule that makes this a deny list. An extensionless S3 key is an
    // ordinary image here; dropping it would file the claim with less proof
    // than the operator attached, and nothing would say so. The uploader
    // refuses it loudly by name if Flipkart will not take it.
    const { uploadable, rejected } = partitionEvidence(['https://s3/trackvid/1a2b3c4d5e'])

    expect(uploadable).toHaveLength(1)
    expect(rejected).toHaveLength(0)
  })

  it('answers empty for a row with no evidence at all', () => {
    expect(partitionEvidence(undefined).uploadable).toEqual([])
    expect(partitionEvidence([null, '', undefined]).uploadable).toEqual([])
  })
})

describe('reading an error body', () => {
  const page =
    '<HTML><HEAD>\n<TITLE>Internal Server Error</TITLE>\n</HEAD><BODY>\n' +
    '<H1>Internal Server Error - Write</H1>\nThe server encountered an internal error or ' +
    'misconfiguration and was unable to complete your request.\n<P>Reference&#32;&#35;4&#46;bc523617'

  it('keeps the two lines that carry the fact, out of a whole error page', () => {
    // This is what filled the Script Error column with markup.
    expect(httpBodySummary(page)).toBe('Internal Server Error - Write — Internal Server Error')
  })

  it('leaves a JSON body exactly as it was', () => {
    // The other failure's body IS the message: {"error":"Request failed with
    // status code 500","options":{"backendData":{"error":""}}}.
    const body = { error: 'Request failed with status code 500', options: { backendData: { error: '' } } }

    expect(httpBodySummary(body)).toBe(JSON.stringify(body))
  })

  it('says nothing for an empty body instead of "undefined"', () => {
    expect(httpBodySummary(undefined)).toBe('')
    expect(httpBodySummary(null)).toBe('')
    expect(httpBodySummary('')).toBe('')
  })

  it('still answers for a page with no title or heading', () => {
    expect(httpBodySummary('<html><body>gateway down</body></html>')).toBe('gateway down')
  })
})
