import { describe, expect, it } from 'vitest'
import { orderedPobIds, pobsOf, type PobRecord } from '@main/services/company.service'

/**
 * Which place of business to search first.
 *
 * AJIO scopes every return search to one POB, and a seller can hold sixty. Only
 * one of them owns any given AWB, so searching in storage order costs sixty
 * requests per claim — for a run over three hundred claims that is eighteen
 * thousand, and the tool is abandoned before it finishes.
 *
 * What makes it cheap is that claims are not random: they arrive in batches
 * from the same warehouse, so the POB that answered last time is
 * overwhelmingly the one that answers next. `lastUsed` records that, survives a
 * re-sync, and is what this ordering reads.
 */

const pob = (id: string, over: Partial<PobRecord> = {}): PobRecord => ({
  id,
  addedAt: null,
  lastUsed: null,
  ...over
})

describe('pobsOf', () => {
  it('reads the object shape the company document stores', () => {
    expect(
      pobsOf({
        pobIds: [
          { id: 'DV00332654', addedAt: '2026-09-01T00:00:00.000Z', lastUsed: null },
          { id: 'DV00337096', addedAt: null, lastUsed: '2026-09-09T10:00:00.000Z' }
        ]
      })
    ).toEqual([
      { id: 'DV00332654', addedAt: '2026-09-01T00:00:00.000Z', lastUsed: null },
      { id: 'DV00337096', addedAt: null, lastUsed: '2026-09-09T10:00:00.000Z' }
    ])
  })

  it('still reads a credential nobody has migrated', () => {
    // Entries were bare strings until 2026-09-09. An unmigrated account is not
    // a broken one — it simply has no dates, and inventing them would assert a
    // first-seen date that is false.
    expect(pobsOf({ pobIds: ['DV00332654', ' DV00337096 '] })).toEqual([
      { id: 'DV00332654', addedAt: null, lastUsed: null },
      { id: 'DV00337096', addedAt: null, lastUsed: null }
    ])
  })

  it('answers with nothing for an account that has never been synced', () => {
    expect(pobsOf({})).toEqual([])
    expect(pobsOf({ pobIds: null })).toEqual([])
    // Junk in the array is dropped rather than becoming a POB with no id, which
    // would be searched and always miss.
    expect(pobsOf({ pobIds: ['', {}, { id: '  ' }, 7, null] })).toEqual([])
  })
})

describe('orderedPobIds', () => {
  it('searches the most recently successful POB first', () => {
    const ordered = orderedPobIds([
      pob('a', { lastUsed: '2026-09-01T00:00:00.000Z' }),
      pob('b', { lastUsed: '2026-09-09T00:00:00.000Z' }),
      pob('c')
    ])

    expect(ordered).toEqual(['b', 'a', 'c'])
  })

  it('puts a POB that has never been used behind every one that has', () => {
    // Never used is not the same as used long ago: one is evidence, the other
    // is the absence of it.
    expect(orderedPobIds([pob('never'), pob('old', { lastUsed: '2020-01-01T00:00:00.000Z' })])).toEqual([
      'old',
      'never'
    ])
  })

  it('breaks a tie on how recently the POB appeared on the account', () => {
    // A POB added yesterday and never used is a better guess than one that has
    // sat there unused for a year.
    const ordered = orderedPobIds([
      pob('old', { addedAt: '2025-01-01T00:00:00.000Z' }),
      pob('new', { addedAt: '2026-09-08T00:00:00.000Z' })
    ])

    expect(ordered).toEqual(['new', 'old'])
  })

  it('keeps stored order when nothing distinguishes them', () => {
    // A freshly synced account has no dates at all; the sort must not shuffle
    // it into an arbitrary order that changes between runs.
    expect(orderedPobIds([pob('a'), pob('b'), pob('c')])).toEqual(['a', 'b', 'c'])
  })

  it('ignores a date it cannot parse rather than sorting on NaN', () => {
    const ordered = orderedPobIds([
      pob('broken', { lastUsed: 'not a date' }),
      pob('good', { lastUsed: '2026-09-09T00:00:00.000Z' })
    ])

    expect(ordered).toEqual(['good', 'broken'])
  })

  it('loses no POB, whatever the dates say', () => {
    const pobs = [
      pob('a', { lastUsed: '2026-09-09T00:00:00.000Z' }),
      pob('b'),
      pob('c', { addedAt: '2026-01-01T00:00:00.000Z' })
    ]

    // The search is only correct if it covers everything — a sort that dropped
    // one would report the AWB as belonging to no account at all.
    expect([...orderedPobIds(pobs)].sort()).toEqual(['a', 'b', 'c'])
  })
})
