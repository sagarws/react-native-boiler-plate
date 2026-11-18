import { describe, expect, it } from 'vitest'
import { LARGE_VIDEO_BYTES, largeVideoNotice } from '@renderer/pages/claims/create/media/largeVideo'

/**
 * A claim video over 30 MB gets a one-line "this will take a while" toast as
 * its upload starts — the server re-encodes it before answering, and without a
 * word the spinner reads as a hang. Smaller videos need none.
 */
describe('largeVideoNotice', () => {
  it('says nothing for a video at or under 30 MB', () => {
    expect(largeVideoNotice({ size: 15 * 1024 * 1024 })).toBeNull()
    expect(largeVideoNotice({ size: LARGE_VIDEO_BYTES })).toBeNull()
  })

  it('warns, with the size, for a video over 30 MB', () => {
    const notice = largeVideoNotice({ size: 178_182_389 })

    expect(notice).toContain('170 MB')
    expect(notice).toMatch(/several minutes/)
  })

  it('stays a single line, as a toast must', () => {
    expect(largeVideoNotice({ size: LARGE_VIDEO_BYTES + 1 })).not.toMatch(/\n/)
  })
})
