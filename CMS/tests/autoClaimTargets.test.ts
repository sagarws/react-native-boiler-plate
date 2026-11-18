import { describe, expect, it, vi } from 'vitest'
import type { CmsRow } from '@shared/types/cmsList'

/**
 * The marketplaces Auto claim is about to file for.
 *
 * The Settings row draws a chip per marketplace from this, red until that
 * marketplace is finished. What has to hold is that the chips describe the run
 * that will actually happen: counted through `selectionBlockReason`, the same
 * gate the 04:00 task files on and the same one the Claims page ticks a
 * checkbox with. A card listing a different set from the one that runs is a
 * more convincing lie than no card at all.
 */

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/cmsList.service', () => ({ listCms: vi.fn() }))

const { summariseTargets } = await import('@main/services/pendingClaims.service')

/** A Pending claim that nothing blocks. Overrides are what each case is about. */
const row = (over: Partial<CmsRow>): CmsRow => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  platform: 'Myntra',
  ticket: '',
  returnAwb: 'AWB',
  forwardAwb: '',
  sellerSku: '',
  pobId: 'POB',
  status: 'Pending',
  scriptStatus: '',
  attempts: 0,
  refillAttempts: 0,
  scriptError: '',
  scannedNumber: '',
  customerOrderNumber: '',
  subOrderNumber: 'SUB',
  driveStatus: '',
  brand: '',
  username: 'ops@example.com',
  accountType: '',
  forwardOrderDate: '',
  feedName: '',
  createdAt: '',
  hasEvidence: true,
  amount: null,
  rejectReason: '',
  ...over
})

describe('summariseTargets', () => {
  it('counts each marketplace on its own, busiest first', () => {
    expect(
      summariseTargets([
        row({ id: '1', platform: 'Myntra' }),
        row({ id: '2', platform: 'Myntra' }),
        row({ id: '3', platform: 'Snapdeal' })
      ])
    ).toEqual([
      { platform: 'Myntra', ready: 2, blocked: 0 },
      { platform: 'Snapdeal', ready: 1, blocked: 0 }
    ])
  })

  /**
   * The gate is the point. A row with no account cannot be filed — there is no
   * login to file it with — and counting it as ready would promise a run that
   * skips it.
   */
  it('splits the claims the gate refuses out of the ready count', () => {
    expect(
      summariseTargets([
        row({ id: '1', platform: 'Myntra' }),
        row({ id: '2', platform: 'Myntra', username: '' }),
        row({ id: '3', platform: 'Myntra', scriptStatus: 'Running' })
      ])
    ).toEqual([{ platform: 'Myntra', ready: 1, blocked: 2 }])
  })

  /**
   * A marketplace whose every Pending claim is blocked is still listed, with a
   * ready count of zero. The card decides what to draw; dropping it here would
   * take the choice away and leave "why is nothing happening for AJIO"
   * unanswerable.
   */
  it('keeps a platform that has nothing ready, rather than dropping it', () => {
    expect(summariseTargets([row({ id: '1', platform: 'Ajio', pobId: '' })])).toEqual([
      { platform: 'Ajio', ready: 0, blocked: 1 }
    ])
  })

  it('has nothing to say about an empty list', () => {
    expect(summariseTargets([])).toEqual([])
  })
})
