import { describe, expect, it } from 'vitest'
import {
  claimStatusTabs,
  claimStatusesFor,
  isClaimStatusFor
} from '@trackvid/automation-core/common/claimStatuses'

const labels = (platform: string): string[] =>
  claimStatusTabs(platform).map((tab: { label: string }) => tab.label)

/**
 * The tab strip must match the admin panel exactly.
 *
 * The desktop app showed one flat list on every platform — AJIO's nine — so
 * Myntra rows sat in states it could not name and Snapdeal grew four tabs that
 * platform never emits. These assertions are the screenshots of
 * TrackVid-FE's CMS page, written down.
 */
describe('claimStatusTabs', () => {
  it('gives AJIO its full portal workflow', () => {
    expect(labels('ajio')).toEqual([
      'All',
      'Failed to Proceed',
      'Pending',
      'In Review',
      'Un Attended',
      'In Progress',
      'Customer Replied',
      'Approved',
      'Rejected',
      'Resolved'
    ])
  })

  // Ordered to follow Myntra's SPF lifecycle, not alphabetically: Awaiting
  // Seller Response comes before a decision, the payout states after it.
  it('gives Myntra its payout lifecycle, in order', () => {
    expect(labels('myntra')).toEqual([
      'All',
      'Failed to Proceed',
      'Pending',
      'In Review',
      'Awaiting Seller Response',
      'Approved',
      'Awaiting Agent Response',
      'Paid',
      'Rejected'
    ])
  })

  it('keeps everyone else on the base set', () => {
    const base = ['All', 'Failed to Proceed', 'Pending', 'In Review', 'Approved', 'Rejected']

    expect(labels('snapdeal')).toEqual(base)
    expect(labels('flipkart')).toEqual(base)
  })

  // A marketplace nobody has classified yet must still be usable.
  it('falls back to the base set for an unknown platform', () => {
    expect(labels('some-new-marketplace')).toHaveLength(6)
  })

  it('is case-insensitive about the platform', () => {
    expect(labels('MYNTRA')).toEqual(labels('myntra'))
  })

  it('carries a colour for every tab', () => {
    for (const tab of claimStatusTabs('ajio')) expect(tab.dot).toMatch(/^#[0-9A-Fa-f]{6}$/)
  })
})

describe('isClaimStatusFor', () => {
  it('knows which statuses belong to which platform', () => {
    expect(isClaimStatusFor('myntra', 'Paid')).toBe(true)
    expect(isClaimStatusFor('snapdeal', 'Paid')).toBe(false)
    expect(isClaimStatusFor('ajio', 'Resolved')).toBe(true)
    expect(isClaimStatusFor('myntra', 'Resolved')).toBe(false)
  })

  it('excludes "All", which is a filter and not a stored status', () => {
    expect(claimStatusesFor('ajio')).not.toContain('All')
  })
})
