import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Background work waits for the home page: nothing queued at launch or sign-in
 * starts until the shell has rendered and five seconds have passed — or, if
 * the screen never reports in, after a minute regardless.
 */

vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetModules()
})

afterEach(() => {
  vi.useRealTimers()
})

const gate = () => import('@main/services/startupGate.service')

describe('the startup gate', () => {
  it('starts nothing before the home page, and everything five seconds after it', async () => {
    const { afterHomePage, homeRendered, HOME_SETTLE_MS } = await gate()
    const started: string[] = []

    afterHomePage('automations', () => started.push('automations'))
    afterHomePage('claim socket', () => started.push('claim socket'))

    await vi.advanceTimersByTimeAsync(30_000)
    expect(started).toEqual([])

    homeRendered()
    await vi.advanceTimersByTimeAsync(HOME_SETTLE_MS - 1)
    expect(started).toEqual([])

    await vi.advanceTimersByTimeAsync(1)
    expect(started).toEqual(['automations', 'claim socket'])
  })

  it('starts anyway when the home page never reports in', async () => {
    const { afterHomePage, FALLBACK_MS } = await gate()
    const run = vi.fn()

    afterHomePage('automations', run)
    await vi.advanceTimersByTimeAsync(FALLBACK_MS)

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('queues a later sign-in behind the next home page too', async () => {
    const { afterHomePage, homeRendered, HOME_SETTLE_MS } = await gate()
    const first = vi.fn()
    const later = vi.fn()

    afterHomePage('launch', first)
    homeRendered()
    await vi.advanceTimersByTimeAsync(HOME_SETTLE_MS)

    afterHomePage('sign-in', later)
    expect(later).not.toHaveBeenCalled()

    homeRendered()
    await vi.advanceTimersByTimeAsync(HOME_SETTLE_MS)

    expect(first).toHaveBeenCalledTimes(1)
    expect(later).toHaveBeenCalledTimes(1)
  })

  it('keeps going when one starter throws', async () => {
    const { afterHomePage, homeRendered, HOME_SETTLE_MS } = await gate()
    const after = vi.fn()

    afterHomePage('broken', () => {
      throw new Error('boom')
    })
    afterHomePage('fine', after)
    homeRendered()
    await vi.advanceTimersByTimeAsync(HOME_SETTLE_MS)

    expect(after).toHaveBeenCalled()
  })
})
