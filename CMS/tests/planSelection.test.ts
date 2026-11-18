import { describe, expect, it } from 'vitest'
import type { BulkSpfPlanRow } from '@shared/types/bulkSpf'
import { keysInRange, lastClaimableKeys, whole } from '@shared/utils/planSelection'

/** Ticking the review's rows by number — "22 to 45", "the last 30". */

const plan = (claimable: number, skipped: number): BulkSpfPlanRow[] =>
  Array.from({ length: claimable + skipped }, (_, i) => ({
    key: `DDR::A${i + 1}::S`,
    awb: `A${i + 1}`,
    sku: 'S',
    claimType: 'DDR',
    pobid: 'DV1',
    account: i < claimable ? 'a@x.com' : '',
    claimable: i < claimable,
    reason: i < claimable ? '' : 'No POB ID in the sheet'
  }))

describe('keysInRange', () => {
  it('ticks exactly the numbered rows, inclusive', () => {
    expect(keysInRange(plan(50, 0), 22, 25)).toEqual(['DDR::A22::S', 'DDR::A23::S', 'DDR::A24::S', 'DDR::A25::S'])
  })

  it('reads a reversed range the right way round and clamps past the end', () => {
    expect(keysInRange(plan(10, 0), 12, 9)).toEqual(['DDR::A9::S', 'DDR::A10::S'])
  })

  it('never ticks a skipped row the range reaches', () => {
    // Rows 1–3 claimable, 4–5 skipped.
    expect(keysInRange(plan(3, 2), 2, 5)).toEqual(['DDR::A2::S', 'DDR::A3::S'])
  })
})

describe('lastClaimableKeys', () => {
  it('takes the last N claimable rows, ignoring skipped rows below them', () => {
    expect(lastClaimableKeys(plan(5, 3), 2)).toEqual(['DDR::A4::S', 'DDR::A5::S'])
    expect(lastClaimableKeys(plan(2, 0), 10)).toEqual(['DDR::A1::S', 'DDR::A2::S'])
  })
})

describe('whole', () => {
  it('accepts only positive whole numbers', () => {
    expect(whole(' 22 ')).toBe(22)
    expect(['', '0', '-3', '2.5', 'abc'].map(whole)).toEqual([null, null, null, null, null])
  })
})
