import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The createTicket payload, against the one that actually worked.
 *
 * A claim failed twice with
 *
 *   Create ticket failed: HTTP 500
 *   {"error":"Request failed with status code 500","options":{"backendData":{"error":""}}}
 *
 * and the same claim, filed by hand in the portal minutes later, succeeded
 * (ticket 789744526971). The only way to see the difference was to capture the
 * browser's own request, because the code logged the response and never what it
 * sent. What that capture shows is pinned here.
 */

const require_ = createRequire(import.meta.url)

const { imageAttachments } = require_(
  '@trackvid/automation-core/platforms/meesho/claim-management/api-based-flow/claimApiFlow'
) as { imageAttachments: (urls: unknown) => string[] }

describe("Meesho's Attachments slot", () => {
  it('takes images', () => {
    const urls = ['https://gcs/a.png', 'https://gcs/b.JPG', 'https://gcs/c.jpeg']

    expect(imageAttachments(urls)).toEqual(urls)
  })

  it('refuses a video, however TrackVid got one in there', () => {
    // The field is typed `img_file` in the portal's own payload, and the
    // working capture sends it EMPTY. TrackVid filled it from the row's
    // forward video, so a claim with one sent an .mp4 URL into an image slot.
    const kept = imageAttachments([
      'https://gcs/forward_video.mp4',
      'https://gcs/evidence.png',
      'https://gcs/clip.MOV?X-Amz-Signature=abc'
    ])

    expect(kept).toEqual(['https://gcs/evidence.png'])
  })

  it('keeps a URL with no extension rather than guessing', () => {
    // An S3 key often has none, and dropping one would file a claim with less
    // evidence than the row carries.
    expect(imageAttachments(['https://gcs/TicketInputAttachments/289318/1789744497332'])).toEqual([
      'https://gcs/TicketInputAttachments/289318/1789744497332'
    ])
  })

  it('answers with an empty list for nothing at all', () => {
    // Empty is what the portal sends — `"value":[]` — and what this must
    // produce, because the key itself is never omitted.
    expect(imageAttachments(undefined)).toEqual([])
    expect(imageAttachments([null, '', undefined])).toEqual([])
  })
})
