import { describe, expect, it } from 'vitest'
import type { ClaimDocument } from '@main/automations/common/types'
import { meeshoClaimEntry } from '@main/automations/platforms/meesho/claim-management/common/claimEntry'

/**
 * An UPLOADED return video reaches the Meesho ticket.
 *
 * The backend's config builds `unpackingVideo` from `returnVideoLink` alone, so
 * a row whose video was uploaded (a File ref, no link) filed with no video and
 * Meesho refused it: "Unpacking Video is required." — on a row whose form
 * showed the video, because `/cms/find-by-awb` resolves the upload into the
 * document's `returnVideoLink`.
 */
const UPLOADED = 'https://s3.ap-south-1.amazonaws.com/trackvid/d46a618e-video.mp4'

const doc = (config: Record<string, unknown>, over: Partial<ClaimDocument> = {}): ClaimDocument => ({
  _id: 'cms-1',
  AWBNumber: 'VLR083062014419',
  eCommercePlatform: 'Meesho',
  config: { awbNumber: 'VLR083062014419', subOrderNumber: '340879667593220928_1', ...config },
  ...over
})

describe('meeshoClaimEntry', () => {
  it('files the uploaded video the form shows when the config has none', () => {
    const entry = meeshoClaimEntry(doc({ unpackingVideo: '' }, { returnVideoLink: UPLOADED }))

    expect(entry.unpackingVideo).toBe(UPLOADED)
  })

  it('also fills a config that left the field out entirely', () => {
    const entry = meeshoClaimEntry(doc({}, { returnVideoLink: UPLOADED }))

    expect(entry.unpackingVideo).toBe(UPLOADED)
  })

  it("keeps the config's own video when it has one", () => {
    const pasted = 'https://drive.example/pasted.mp4'
    const entry = meeshoClaimEntry(doc({ unpackingVideo: pasted }, { returnVideoLink: UPLOADED }))

    expect(entry.unpackingVideo).toBe(pasted)
  })

  it('leaves the entry alone when the row has no video anywhere', () => {
    const entry = meeshoClaimEntry(doc({ unpackingVideo: '' }, { returnVideoLink: '' }))

    expect(entry.unpackingVideo).toBe('')
  })

  it('still refuses a row the backend built no config for', () => {
    expect(() => meeshoClaimEntry({ _id: 'cms-1', returnVideoLink: UPLOADED })).toThrow(/no meesho claim config/i)
  })
})
