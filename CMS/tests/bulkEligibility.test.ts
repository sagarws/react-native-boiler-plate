import { describe, expect, it } from 'vitest'
import {
  isAccountMapEligible,
  isSkuSweepEligible,
  type MappableRow
} from '@shared/constants/accountMapping'

/**
 * Which rows each bulk tool may be pointed at.
 *
 * Both tools are ARMED before they run: the button switches the checkbox column
 * to that tool's eligibility, the operator ticks, and only then does anything
 * happen. So this rule decides what a tick can mean — and it has to agree with
 * the backend, which applies the same rule to whatever ids it is sent. A
 * checkbox offering a row the server will drop is a promise the run cannot keep.
 *
 * The two rules are deliberately opposites at one point, and that is what
 * orders the tools: mapping wants rows MISSING an identifier, the SKU sweep
 * wants rows that already have them. Map the accounts, then sweep the SKUs.
 */

const row = (over: Partial<MappableRow> = {}): MappableRow => ({
  platform: 'Ajio',
  status: 'Pending',
  username: 'info@tigc.in',
  pobId: 'DV00332648',
  subOrderNumber: '',
  ...over
})

describe('isAccountMapEligible', () => {
  it('takes a row with no account', () => {
    expect(isAccountMapEligible(row({ username: '' }))).toBe(true)
  })

  it('takes an AJIO row that has an account but no POB', () => {
    // The rows an operator most needs: account filled in by master data, POB
    // never imported. A rule that only looked at the account would refuse
    // exactly these.
    expect(isAccountMapEligible(row({ pobId: '' }))).toBe(true)
  })

  it('takes a Meesho row missing its sub-order number', () => {
    expect(
      isAccountMapEligible(row({ platform: 'Meesho', pobId: '', subOrderNumber: '' }))
    ).toBe(true)
    expect(
      isAccountMapEligible(row({ platform: 'Meesho', pobId: '', subOrderNumber: '123_1' }))
    ).toBe(false)
  })

  it('refuses a row that already has everything', () => {
    // Nothing for the run to write. Offering it would only make the count lie.
    expect(isAccountMapEligible(row())).toBe(false)
  })

  it('offers a complete row for RE-CHECKING in developer mode', () => {
    // A filled sub-order number can still be the wrong one — the ORDER number,
    // or one imported against another order — and nothing on the page can tell.
    // Re-running the map is the only way to compare it with the marketplace's.
    const complete = row({ platform: 'Meesho', pobId: '', subOrderNumber: '123_1' })

    expect(isAccountMapEligible(complete)).toBe(false)
    expect(isAccountMapEligible(complete, { verifyMapped: true })).toBe(true)
    expect(isAccountMapEligible(row(), { verifyMapped: true })).toBe(true)
  })

  it('re-checks only where there is a second identifier to re-check', () => {
    // Flipkart's probe answers with the account and nothing else, and the
    // account is never overwritten — so a complete row has nothing to compare.
    const flipkart = row({ platform: 'Flipkart', pobId: '', subOrderNumber: '' })

    expect(isAccountMapEligible(flipkart, { verifyMapped: true })).toBe(false)
  })

  it('still refuses a status no bulk tool may touch, developer mode or not', () => {
    // Back-filling identifiers into a claim already with the marketplace makes
    // the row disagree with the ticket.
    const filed = row({ status: 'In Review' })

    expect(isAccountMapEligible(filed, { verifyMapped: true })).toBe(false)
  })

  it('treats a master-import placeholder as missing', () => {
    // parseExcel writes String(cell), so a file without the column stores the
    // literal "undefined" — truthy, and a plain emptiness check would call the
    // row complete.
    for (const placeholder of ['undefined', 'null', '-', 'N/A', ' na ']) {
      expect(isAccountMapEligible(row({ pobId: placeholder }))).toBe(true)
    }
  })

  it('refuses a claim already with the marketplace', () => {
    // Its ticket was raised against the identifiers it had; changing them now
    // only makes the row disagree with the ticket.
    for (const status of ['In Review', 'Approved', 'Rejected', 'Resolved']) {
      expect(isAccountMapEligible(row({ username: '', status }))).toBe(false)
    }
  })

  it('refuses the platform that has no per-claim account', () => {
    // Nykaa alone now: the company's one login files every Nykaa claim, so a
    // mapping run would ask that account about rows already destined for it.
    expect(isAccountMapEligible(row({ platform: 'Nykaa', username: '' }))).toBe(false)
  })

  it('takes a Tata CliQ row missing its account', () => {
    // It was in the refusal above until it had a probe. Written with the tab's
    // own spelling because that is what a row carries — and "tata cliq" is not
    // the registry key, which is the whole reason platformKey exists.
    expect(isAccountMapEligible(row({ platform: 'Tata CliQ', username: '' }))).toBe(true)
  })
})

describe('isSkuSweepEligible', () => {
  it('takes an AJIO row carrying both an account and a POB', () => {
    expect(isSkuSweepEligible(row())).toBe(true)
  })

  it('refuses what mapping has not finished with', () => {
    // The account is what the lookup signs in as and the POB is what it
    // searches under, so neither is optional — and both are what Map Username
    // fills in. This is what makes the tools sequential rather than parallel.
    expect(isSkuSweepEligible(row({ username: '' }))).toBe(false)
    expect(isSkuSweepEligible(row({ pobId: '' }))).toBe(false)
    expect(isSkuSweepEligible(row({ pobId: 'undefined' }))).toBe(false)
  })

  it('refuses every platform but AJIO', () => {
    // Only AJIO answers "what is on this return" from an AWB.
    expect(isSkuSweepEligible(row({ platform: 'Meesho' }))).toBe(false)
    expect(isSkuSweepEligible(row({ platform: 'Flipkart' }))).toBe(false)
  })

  it('refuses a claim already with the marketplace', () => {
    expect(isSkuSweepEligible(row({ status: 'In Review' }))).toBe(false)
  })

  it('is the exact opposite of mapping on a complete row', () => {
    // The one row both are asked about: mapping has nothing to do with it, the
    // sweep can read it. That inversion is the ordering, stated as a test.
    const complete = row()

    expect(isAccountMapEligible(complete)).toBe(false)
    expect(isSkuSweepEligible(complete)).toBe(true)

    const bare = row({ username: '', pobId: '' })

    expect(isAccountMapEligible(bare)).toBe(true)
    expect(isSkuSweepEligible(bare)).toBe(false)
  })
})
