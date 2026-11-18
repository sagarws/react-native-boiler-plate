import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Passing over ONE marketplace on a run, and carrying on with the rest.
 *
 * WHY IT IS NOT THE TASK-LEVEL SKIP. That one abandons everything because one
 * marketplace is slow; this leaves the other six working. The distinction is
 * the whole feature, and the store is where it could quietly stop being true.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const {
  clearPlatformSkips,
  platformSkipped,
  requestPlatformSkip,
  skippedPlatforms,
  whenPlatformSkipped
} = await import('@main/services/platformSkip.store')

beforeEach(() => {
  clearPlatformSkips('refill-data')
  clearPlatformSkips('auto-claim')
  clearPlatformSkips('session-refresh')
})

describe('passing over one marketplace', () => {
  it('skips the one asked for and nothing else', () => {
    requestPlatformSkip('refill-data', 'myntra')

    expect(platformSkipped('refill-data', 'myntra')).toBe(true)
    // The six behind it carry on, which is the entire point.
    expect(platformSkipped('refill-data', 'ajio')).toBe(false)
  })

  it('keeps each task’s skips to itself', () => {
    // Skipping Myntra on the refill says nothing about Myntra's claims: they
    // are different work, hours apart, and an operator skipping one did not
    // ask for the other.
    requestPlatformSkip('refill-data', 'myntra')

    expect(platformSkipped('auto-claim', 'myntra')).toBe(false)
  })

  it('matches however the caller spells it', () => {
    // The button sends a key, a loop may hold a label. A skip that does not
    // match is the worst failure this can have: the operator watches the
    // marketplace they just skipped carry on working.
    requestPlatformSkip('session-refresh', 'TataCliq')

    expect(platformSkipped('session-refresh', 'tatacliq')).toBe(true)
  })

  it('forgets everything when the run ends', () => {
    // A skip belongs to the run it was pressed on. Surviving it would mean a
    // marketplace quietly passed over tomorrow night because of a button
    // pressed tonight.
    requestPlatformSkip('refill-data', 'myntra')
    clearPlatformSkips('refill-data')

    expect(platformSkipped('refill-data', 'myntra')).toBe(false)
    expect(skippedPlatforms('refill-data')).toEqual([])
  })
})

describe('ending the sign-in in flight', () => {
  const settled = async (promise: Promise<void>): Promise<boolean> => {
    let done = false

    void promise.then(() => {
      done = true
    })
    await Promise.resolve()
    await Promise.resolve()

    return done
  }

  it('wakes the loop waiting on that marketplace when Skip is pressed', async () => {
    const watch = whenPlatformSkipped('session-refresh', 'flipkart')

    expect(await settled(watch.promise)).toBe(false)

    requestPlatformSkip('session-refresh', 'Flipkart')

    expect(await settled(watch.promise)).toBe(true)
    watch.cancel()
  })

  it('does not wake for another marketplace or another task', async () => {
    const watch = whenPlatformSkipped('session-refresh', 'flipkart')

    requestPlatformSkip('session-refresh', 'tatacliq')
    requestPlatformSkip('auto-claim', 'flipkart')

    expect(await settled(watch.promise)).toBe(false)
    watch.cancel()
  })

  it('is already settled when the skip came first', async () => {
    requestPlatformSkip('session-refresh', 'snapdeal')

    expect(await settled(whenPlatformSkipped('session-refresh', 'snapdeal').promise)).toBe(true)
  })

  it('a cancelled watch is never woken', async () => {
    const watch = whenPlatformSkipped('session-refresh', 'flipkart')

    watch.cancel()
    requestPlatformSkip('session-refresh', 'flipkart')

    expect(await settled(watch.promise)).toBe(false)
  })
})
