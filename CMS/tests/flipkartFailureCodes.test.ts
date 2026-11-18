import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

/**
 * The two Flipkart failures an operator is expected to recognise on sight.
 *
 * A claims list is scanned, not read, and in the width of that column two
 * failures look alike. A short code tells them apart, and gives ops something
 * to say to each other that is shorter than the sentence.
 *
 * EF2 also means the claim can NEVER be filed — the packet cannot be selected,
 * so retrying produces the same message twice more while the row sits on
 * Pending. That is what `terminal` carries.
 */

const require_ = createRequire(import.meta.url)

const { describeFailure, FAILURE_CODES } = require_(
  '@trackvid/automation-core/platforms/flipkart/claim-management/script-based-flow/fileClaim'
) as {
  describeFailure: (err: unknown) => { message: string; terminal: boolean }
  FAILURE_CODES: { code: string; terminal: boolean }[]
}

/** As `utils.js` throws them, before any stripping. */
const EXPIRED = new Error('SPF_WINDOW_EXPIRED: 14 days window to claim SPF has passed')
const NO_RADIO = new Error(
  "Step 3 (Select product) failed: neither an enabled product radio, SPF-expired notice, " +
    "nor 'no return packets' banner appeared within 30s"
)

describe('describeFailure', () => {
  it('prefixes the SPF window failure with EF1', () => {
    expect(describeFailure(EXPIRED).message).toBe('EF1: 14 days window to claim SPF has passed')
  })

  it('prefixes the unselectable-packet failure with EF2', () => {
    // The step wrapper is stripped too — "Step 3 (Select product) failed:" is
    // for a developer, and the row is read by an operator.
    expect(describeFailure(NO_RADIO).message).toMatch(
      /^EF2: neither an enabled product radio/
    )
  })

  it('marks EF2 as terminal and EF1 as not', () => {
    // EF2 cannot be retried past — the packet is not selectable at all. The SPF
    // window is a property of the return, and was deliberately left retryable.
    expect(describeFailure(NO_RADIO).terminal).toBe(true)
    expect(describeFailure(EXPIRED).terminal).toBe(false)
  })

  it('leaves an unrecognised failure exactly as it was', () => {
    // A code invented for every error would be a code that means nothing.
    const other = describeFailure(new Error('Step 5 (Upload) failed: network timeout'))

    expect(other.message).toBe('network timeout')
    expect(other.terminal).toBe(false)
  })

  it('matches the RAW message, before the tag is stripped', () => {
    // The tag IS the identity, and `cleanErrorMessage` removes it first — so a
    // matcher running after the strip would recognise nothing.
    expect(describeFailure(new Error('14 days window to claim SPF has passed')).message).toBe(
      '14 days window to claim SPF has passed'
    )
  })

  it('survives a non-Error', () => {
    expect(describeFailure('SPF_WINDOW_EXPIRED: gone').message).toBe('EF1: gone')
    expect(describeFailure(null).message).toBe('')
  })

  it('gives every declared code a decision about retrying', () => {
    for (const entry of FAILURE_CODES) {
      expect(typeof entry.terminal).toBe('boolean')
      expect(entry.code).toMatch(/^EF\d+$/)
    }
  })
})
