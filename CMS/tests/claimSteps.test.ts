import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { TICKET_LOOKUPS } from '@main/automations/registry'

const require_ = createRequire(import.meta.url)

interface Steps {
  CLAIM_STEPS: Record<string, Record<string, string>>
  claimSteps: (platform: string) => { key: string; description: string }[]
}

const core = require_('@trackvid/automation-core/common/claimSteps') as Steps

/**
 * The claim pipeline, written down.
 *
 * It is description rather than dispatch — nothing reads these strings to
 * decide what to call — which is exactly why it needs a test: a document that
 * can drift from the code it describes is worse than no document, because it is
 * read as authoritative.
 *
 * So the two things that CAN be checked mechanically are: the steps are ordered
 * and complete (no step3 without a step2), and every platform whose sequence
 * ends in a ticket lookup actually has one registered.
 */

describe('the claim steps', () => {
  it('covers the platforms that file claims', () => {
    for (const platform of ['meesho', 'snapdeal', 'ajio', 'myntra', 'flipkart']) {
      expect(core.claimSteps(platform).length).toBeGreaterThan(0)
    }
  })

  it('numbers them from one, with no gaps', () => {
    for (const [platform, steps] of Object.entries(core.CLAIM_STEPS)) {
      const numbers = Object.keys(steps).map(key => Number(key.replace(/\D/g, '')))

      expect(numbers, platform).toEqual(
        Array.from({ length: numbers.length }, (_, index) => index + 1)
      )
    }
  })

  it('reads them back in order, whatever the object order happens to be', () => {
    const steps = core.claimSteps('meesho')

    expect(steps[0]?.key).toBe('step1')
    expect(steps.at(-1)?.key).toBe(`step${steps.length}`)
    // Every step says something.
    for (const step of steps) expect(step.description.length).toBeGreaterThan(10)
  })

  it('says nothing for a platform it does not describe', () => {
    expect(core.claimSteps('nykaa')).toEqual([])
    expect(core.claimSteps('')).toEqual([])
  })

  it('only promises a ticket lookup where one is registered', () => {
    // The last step of Meesho's and Snapdeal's sequences is "if the claim
    // failed, search for a ticket". A platform that promises that in prose and
    // has no lookup would be a lie in the one place people go to check.
    for (const [platform, steps] of Object.entries(core.CLAIM_STEPS)) {
      const promisesLookup = Object.values(steps).some(step =>
        /if the claim failed/i.test(step)
      )

      if (promisesLookup) expect(Boolean(TICKET_LOOKUPS[platform]), platform).toBe(true)
    }
  })

  it('registers a lookup only for platforms that can be asked without a ticket id', () => {
    // Myntra's read-back needs the ticket id, which is the thing that is
    // missing after a failed submit — so it has none, deliberately.
    expect(Object.keys(TICKET_LOOKUPS).sort()).toEqual(['meesho', 'snapdeal'])
  })
})
