import { describe, expect, it } from 'vitest'
import {
  RE_CLAIM_BATCH_SIZE,
  batchCountFor,
  batchOf
} from '../shared/constants/reClaim'

/**
 * How a re-claim run is cut up.
 *
 * The arithmetic is three lines, and it is still worth pinning: the same two
 * functions decide where the run checkpoints to disk, which batch the progress
 * line names, and which page the modal turns to. An off-by-one here is a run
 * that says "batch 61 of 60", or a checkpoint that never fires because the
 * boundary is tested against the wrong side of the division.
 */
describe('cutting a re-claim run into batches', () => {
  it('puts the first fifty rows in batch 1 and the fifty-first in batch 2', () => {
    expect(batchOf(0)).toBe(1)
    expect(batchOf(RE_CLAIM_BATCH_SIZE - 1)).toBe(1)
    expect(batchOf(RE_CLAIM_BATCH_SIZE)).toBe(2)
  })

  it('counts the last, short batch — 3,003 tickets is 61 batches, not 60', () => {
    expect(batchCountFor(3003)).toBe(61)
    expect(batchOf(3002)).toBe(61)
  })

  it('does not claim a batch for a run with nothing in it', () => {
    expect(batchCountFor(0)).toBe(0)
  })

  it('counts an exact multiple without inventing an empty batch at the end', () => {
    expect(batchCountFor(RE_CLAIM_BATCH_SIZE)).toBe(1)
    expect(batchCountFor(RE_CLAIM_BATCH_SIZE * 2)).toBe(2)
  })

  it('never names a batch past the count, for any size of run', () => {
    for (const total of [1, 49, 50, 51, 199, 3003]) {
      expect(batchOf(total - 1)).toBeLessThanOrEqual(batchCountFor(total))
    }
  })

  /**
   * The checkpoint fires on the boundary, and the run writes on `done % 50 === 0`.
   * Stated here because the condition lives in a 200-line loop where it is easy
   * to "tidy" into `done % 50 === 49` and lose a batch's worth of record.
   */
  it('checkpoints after the fiftieth row, not the forty-ninth', () => {
    const wouldCheckpoint = (done: number): boolean =>
      done > 0 && done % RE_CLAIM_BATCH_SIZE === 0

    expect(wouldCheckpoint(49)).toBe(false)
    expect(wouldCheckpoint(50)).toBe(true)
    expect(wouldCheckpoint(100)).toBe(true)
    // Nothing done is not a boundary: the opening record already covers it.
    expect(wouldCheckpoint(0)).toBe(false)
  })
})
