import { describe, expect, it, vi } from 'vitest'
import { sheetClaimEntries } from '@trackvid/automation-core/platforms/ajio/claim-management/api-based-flow/bulkSpfBuckets'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { assignAccounts } = await import('@main/services/bulkSpf.service')

/**
 * The NDR/DDR bulk claim, filed straight from the sheet with no master data.
 *
 * Everything a claim needs has to come from the row itself (AWB, SKU, POB) and
 * the slot it was uploaded in (NDR/DDR → template), and the AJIO login has to
 * come from whichever account holds the row's POB.
 */

const row = (over: Record<string, string>) => ({
  id: 'R1',
  awb: 'R1',
  ron: '',
  sku: 'SKU1',
  claimType: 'NDR',
  pobid: 'DV1',
  ticketNumber: '',
  ...over
})

describe('sheetClaimEntries', () => {
  it('builds the raiseClaim entry from the row and the slot', () => {
    const { entries } = sheetClaimEntries([row({}), row({ id: 'R2', awb: 'R2', claimType: 'DDR', pobid: 'DV2' })])

    expect(entries[0]).toMatchObject({
      awbNumber: 'R1',
      sku: 'SKU1',
      pobid: 'DV1',
      claimType: 'NDR',
      typeOfClaim: 'NOT DELIVERED RETURNS',
      subIssueType: 'Not Delivered Returns',
      emailTemplate: { subject: 'Not Delivered Returns' }
    })
    expect(entries[1]).toMatchObject({ claimType: 'DDR', typeOfClaim: 'DELIVERY DISPUTE RETURNS', pobid: 'DV2' })
    expect(typeof entries[0]?.imageUrl).toBe('string')
  })

  it('skips a row with a ticket in the sheet, no POB, or no claim type', () => {
    const { entries, buckets } = sheetClaimEntries([
      row({ ticketNumber: 'T1' }),
      row({ id: 'R2', awb: 'R2', pobid: '' }),
      row({ id: 'R3', awb: 'R3', claimType: '' })
    ])

    expect(entries).toEqual([])
    expect(buckets.alreadyClaimed.map(r => r.awb)).toEqual(['R1'])
    expect(buckets.missingPob.map(r => r.awb)).toEqual(['R2'])
    expect(buckets.unknownType.map(r => r.awb)).toEqual(['R3'])
  })

  it('carries a Return Order No so the claim can skip the AWB search', () => {
    const { entries } = sheetClaimEntries([row({ id: 'RON9', awb: '', ron: 'RON9' })])

    // The order number also stands in as the row's identifier: raiseClaim skips
    // the AWB search whenever return_order_no is set, and a blank AWB would give
    // every RON-keyed row with the same SKU the same report key.
    expect(entries[0]).toMatchObject({ awbNumber: 'RON9', return_order_no: 'RON9' })
  })
})

describe('assignAccounts', () => {
  const account = (username: string, pobs: string[]) => ({
    username,
    password: 'pw',
    accountType: 'API',
    pobIds: pobs.map(id => ({ id, addedAt: null, lastUsed: null }))
  })

  it('sends each row to the login holding its POB — one group per account', () => {
    const { entries } = sheetClaimEntries([
      row({ pobid: 'dv1 ' }),
      row({ id: 'R2', awb: 'R2', pobid: 'DV2' }),
      row({ id: 'R3', awb: 'R3', pobid: 'DV1' })
    ])

    const { groups, unassigned } = assignAccounts(
      entries,
      [account('a@x.com', ['DV1']), account('B@x.com', ['DV2', 'DV1'])],
      'company-1'
    )

    expect(unassigned).toEqual([])
    expect(groups.map(g => [g.accountEmail, g.configArr.map(e => e.awbNumber)])).toEqual([
      // POBs compare case- and space-insensitively; a POB on two logins goes to the first.
      ['a@x.com', ['R1', 'R3']],
      ['b@x.com', ['R2']]
    ])
    expect(groups[0]?.credentials).toEqual({ username: 'a@x.com', password: 'pw', accountType: 'API' })
    expect(groups[0]?.companyId).toBe('company-1')
  })

  it('never guesses an account for a POB no login lists', () => {
    const { entries } = sheetClaimEntries([row({ pobid: 'DV9' })])
    const { groups, unassigned } = assignAccounts(entries, [account('a@x.com', ['DV1'])], 'c')

    expect(groups).toEqual([])
    expect(unassigned.map(e => e.pobid)).toEqual(['DV9'])
  })
})
