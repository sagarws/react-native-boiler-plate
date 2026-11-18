import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Spacing requests out the way a person would.
 *
 * Forty identical requests exactly five seconds apart is not a person, and the
 * portals these runners talk to rate-limit or challenge on that pattern
 * eventually. The SPREAD is the point, not the delay: a fixed gap is the tell.
 */

const require_ = createRequire(import.meta.url)

const { jitter, humanGapMs, pacedPause } = require_(
  '@trackvid/automation-core/common/humanPace'
) as {
  jitter: (baseMs: number, ratio?: number) => number
  humanGapMs: (baseMs: number, ratio?: number) => number
  pacedPause: (
    index: number,
    options?: { baseMs?: number; ratio?: number; onWait?: (ms: number) => void }
  ) => Promise<number>
}

afterEach(() => {
  vi.useRealTimers()
})

describe('jitter', () => {
  it('stays within the spread either side of the base', () => {
    for (let run = 0; run < 500; run++) {
      const value = jitter(5000, 0.35)

      expect(value).toBeGreaterThanOrEqual(3250)
      expect(value).toBeLessThanOrEqual(6750)
    }
  })

  it('actually varies', () => {
    // The one property that matters. A helper that returned the base every
    // time would pass every bound above and defeat the whole purpose.
    const seen = new Set(Array.from({ length: 200 }, () => jitter(5000, 0.35)))

    expect(seen.size).toBeGreaterThan(50)
  })

  it('spreads wider with a bigger ratio, and not at all with none', () => {
    expect(jitter(5000, 0)).toBe(5000)

    const wide = Array.from({ length: 200 }, () => jitter(5000, 0.9))

    expect(Math.min(...wide)).toBeLessThan(3000)
  })
})

describe('humanGapMs', () => {
  it('never asks for a negative wait', () => {
    // A ratio above 1 would otherwise produce one, and `setTimeout` with a
    // negative delay fires immediately — pacing silently switched off.
    for (let run = 0; run < 200; run++) {
      expect(humanGapMs(1000, 2)).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('pacedPause', () => {
  it('does not pause before the first item', async () => {
    // There is nothing yet to be spaced apart FROM, and pausing here makes an
    // operator watch a spinner for five seconds before anything has happened.
    const waited = await pacedPause(0, { baseMs: 5000 })

    expect(waited).toBe(0)
  })

  it('waits, and says how long before it does', async () => {
    vi.useFakeTimers()

    const told: number[] = []
    const pending = pacedPause(1, { baseMs: 5000, onWait: ms => told.push(ms) })

    // Announced BEFORE the wait: a five-second gap with no explanation reads
    // as the window having frozen.
    expect(told).toHaveLength(1)
    expect(told[0]).toBeGreaterThan(0)

    await vi.advanceTimersByTimeAsync(told[0] as number)

    await expect(pending).resolves.toBe(told[0])
  })

  it('treats a negative index as the first item', async () => {
    expect(await pacedPause(-1, { baseMs: 5000 })).toBe(0)
  })
})
