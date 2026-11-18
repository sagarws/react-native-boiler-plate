import { describe, expect, it } from 'vitest'
import { platformTally } from '@shared/utils/platformTally'

describe('platformTally', () => {
  it('adds up each platform, in the order the run reached them', () => {
    const tally = platformTally()

    tally.add('Meesho', { total: 1, succeeded: 1 })
    tally.add('ajio', { total: 1, failed: 1, detail: 'refused' })
    tally.add('meesho', { total: 1, failed: 1 })

    expect(tally.list()).toEqual([
      { platform: 'meesho', total: 2, succeeded: 1, failed: 1, detail: null },
      { platform: 'ajio', total: 1, succeeded: 0, failed: 1, detail: 'refused' }
    ])
  })

  it('ignores a blank platform rather than inventing one', () => {
    const tally = platformTally()

    tally.add('  ', { total: 1 })

    expect(tally.list()).toEqual([])
  })
})
