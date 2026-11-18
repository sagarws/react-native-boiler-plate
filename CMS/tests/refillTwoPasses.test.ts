import { describe, expect, it } from 'vitest'
import {
  needsStatusRefill,
  refillBlankFieldsFor,
  refillFieldsFor,
  refillStatusFieldsFor,
  REFILL_STATUS_SKIPPED
} from '@shared/constants/refill'

/**
 * Refill Data asks two different questions of two different sets of rows.
 *
 * THE BUG THAT SPLIT IT. One pass asked for every field, over `Pending` rows
 * only. So `statusChange` — "where does this ticket now stand, and what was
 * paid" — was asked for rows that had no ticket yet, and NEVER asked for the
 * rows that had one, because a filed claim is not Pending. The claim status
 * was, in practice, never refreshed at all.
 *
 * Both halves are pinned here because each is silent when wrong: a blanks pass
 * that still asks for the status wastes the question, and a status pass that
 * includes settled rows re-asks about outcomes that cannot change.
 */

describe('which fields each pass asks for', () => {
  it('keeps the claim status out of the blanks pass', () => {
    // The blanks pass runs over Pending rows, which have no ticket to report on.
    for (const platform of ['ajio', 'meesho', 'snapdeal', 'myntra', 'flipkart', 'delhivery']) {
      expect(refillBlankFieldsFor(platform)).not.toContain('statusChange')
    }
  })

  it('asks for nothing BUT the claim status in the status pass', () => {
    for (const platform of ['ajio', 'meesho', 'snapdeal', 'myntra', 'flipkart', 'delhivery']) {
      expect(refillStatusFieldsFor(platform)).toEqual(['statusChange'])
    }
  })

  it('together they are exactly what the platform offers', () => {
    // No field may be dropped by the split, and none asked twice.
    for (const platform of ['ajio', 'meesho', 'snapdeal', 'myntra', 'nykaa', 'tatacliq', 'xbees']) {
      expect([...refillBlankFieldsFor(platform), ...refillStatusFieldsFor(platform)]).toEqual(
        refillFieldsFor(platform)
      )
    }
  })

  it('skips Nykaa in the blanks pass — it has only a status', () => {
    /*
     * An empty list is how a platform is skipped, and it has to be empty
     * rather than "all of them minus one" — sweeping Nykaa for blanks would
     * sign in to ask questions it has no fields for.
     */
    expect(refillBlankFieldsFor('nykaa')).toEqual([])
    expect(refillStatusFieldsFor('nykaa')).toEqual(['statusChange'])
  })

  it('skips Tata CliQ and Xbees in the status pass — they report no status', () => {
    // Tata CliQ's QC row carries a ticket NUMBER but nothing about where it
    // stands; Xbees has no status field at all.
    expect(refillStatusFieldsFor('tatacliq')).toEqual([])
    expect(refillStatusFieldsFor('xbees')).toEqual([])
    expect(refillBlankFieldsFor('tatacliq')).toContain('accountMapping')
  })
})

describe('which rows the status pass asks about', () => {
  it('leaves the four that cannot answer or cannot move', () => {
    expect(needsStatusRefill('Pending')).toBe(false)
    expect(needsStatusRefill('Failed to Proceed')).toBe(false)
    expect(needsStatusRefill('Approved')).toBe(false)
    expect(needsStatusRefill('Rejected')).toBe(false)
    expect(REFILL_STATUS_SKIPPED).toHaveLength(4)
  })

  it('asks about every status that is still moving', () => {
    for (const status of [
      'In Review',
      'In Progress',
      'Awaiting Agent Response',
      'Customer Replied',
      'Un Attended'
    ]) {
      expect(needsStatusRefill(status), `${status} was skipped`).toBe(true)
    }
  })

  it('asks about a status it has never seen before', () => {
    /*
     * THE REASON THIS IS AN EXCLUDE-LIST. The claims grid already shows nine
     * statuses and a marketplace can start reporting a tenth tomorrow. An
     * include-list would silently stop tracking it — and a claim whose status
     * is never asked about is one nobody finds out about.
     */
    expect(needsStatusRefill('Escalated to Vendor')).toBe(true)
  })

  it('ignores a row with no status at all', () => {
    // Nothing to compare against, and nothing a marketplace could confirm.
    expect(needsStatusRefill(null)).toBe(false)
    expect(needsStatusRefill(undefined)).toBe(false)
    expect(needsStatusRefill('   ')).toBe(false)
  })

  it('is not fooled by surrounding whitespace', () => {
    expect(needsStatusRefill('  Approved  ')).toBe(false)
  })
})
