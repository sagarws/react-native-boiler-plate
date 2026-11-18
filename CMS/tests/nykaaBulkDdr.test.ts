/* eslint-disable @typescript-eslint/require-await -- fakes for async dependencies; most resolve immediately */
import { describe, expect, it, vi } from 'vitest'
import {
  cellText,
  descriptionHtml,
  parseSheetRows,
  planDdrRows,
  ticketEntry,
  type SheetRow
} from '@main/automations/platforms/nykaa/claim-management/api-based-flow/bulkDdrSheet'
import { runDdrGroup, type DdrRunnerDeps } from '@main/automations/platforms/nykaa/claim-management/api-based-flow/bulkDdrRunner'
import { isNykaaDdrRetryable, type NykaaDdrResultRow } from '@shared/types/nykaaBulkDdr'

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test' },
  dialog: {},
  shell: {},
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { buildRunRows } = await import('@main/services/nykaaBulkDdr.service')

/**
 * The Nykaa DDR bulk claim: every sheet row becomes one "Delivered but Not
 * Received" ticket, filed under the Nykaa login its vendor code names.
 */

const TEMPLATE = { subject: 'Delivery dispute Returns', body: 'Dear Team,\n\nPlease share the POD.' }

const row = (over: Partial<SheetRow> = {}): SheetRow => ({
  sheetRow: 2,
  account: '',
  vendorCode: 'V1',
  sku: 'SKU1',
  awb: 'AWB1',
  returnType: 'RTO',
  description: '',
  ...over
})

describe('parseSheetRows', () => {
  it('reads the template columns, under a title line, and upper-cases the return type', () => {
    const read = parseSheetRows([
      ['Nykaa returns export'],
      ['Vendor Code', 'SKU ID', 'AWB (DTO/RTO)', 'Return Type', 'Description', 'Ticket No'],
      ['V1', 'SKU1', 123456789012345, 'rto', 'hello', ''],
      ['', '', '', '', '', ''],
      // A Ticket No column is not read: Nykaa itself is asked whether the AWB has a ticket.
      ['V2', 'SKU2', 'AWB2', 'DTO', '', '7061852']
    ])

    expect(read.hasVendorCode).toBe(true)
    expect(read.rows).toEqual([
      { sheetRow: 3, account: '', vendorCode: 'V1', sku: 'SKU1', awb: '123456789012345', returnType: 'RTO', description: 'hello' },
      { sheetRow: 5, account: '', vendorCode: 'V2', sku: 'SKU2', awb: 'AWB2', returnType: 'DTO', description: '' }
    ])
  })

  it('names the missing required columns', () => {
    expect(() => parseSheetRows([['Return AWB', 'Vendor Code']])).toThrow(/"SKU ID", "Return Type"/)
  })

  it('refuses a sheet with no AWB column, saying what it found', () => {
    expect(() => parseSheetRows([['Order', 'SKU']])).toThrow(/No "Return AWB" column.*Order, SKU/)
  })

  it('writes long numeric AWBs out in full', () => {
    expect(cellText(1.23456789012e11)).toBe('123456789012')
  })
})

describe('planDdrRows', () => {
  const two = [
    { username: 'a@x.in', vendorCode: 'V1' },
    { username: 'b@x.in', vendorCode: 'v2' }
  ]

  it('files each row under the login whose vendor code it names (case-insensitive)', () => {
    const plan = planDdrRows([row(), row({ sheetRow: 3, awb: 'AWB2', vendorCode: 'V2' })], two)

    expect(plan.groups.map(group => [group.account, group.entries.map(entry => entry.awb)])).toEqual([
      ['a@x.in', ['AWB1']],
      ['b@x.in', ['AWB2']]
    ])
    expect(plan.buckets.claimable).toBe(2)
  })

  it('files under the login the Account column names, over the vendor code', () => {
    const plan = planDdrRows([row({ account: ' B@X.IN ', vendorCode: 'V1' })], two)

    expect(plan.groups.map(group => group.account)).toEqual(['b@x.in'])
    // The row's own vendor code is still what the ticket carries.
    expect(plan.groups[0]?.entries[0]?.vendorCode).toBe('V1')
  })

  it('takes the vendor code from the named login when the row has none', () => {
    const plan = planDdrRows([row({ account: 'b@x.in', vendorCode: '' })], two)

    expect(plan.groups[0]?.entries[0]?.vendorCode).toBe('v2')
  })

  it('skips a row naming a login this machine does not have, never re-routing it', () => {
    const plan = planDdrRows([row({ account: 'c@x.in', vendorCode: 'V1' })], two)

    expect(plan.groups).toEqual([])
    expect(plan.skipped[0]?.reason).toMatch(/No Nykaa login "c@x.in"/)
  })

  it('never guesses an account when several logins could file a row', () => {
    const plan = planDdrRows([row({ vendorCode: '' }), row({ sheetRow: 3, awb: 'AWB2', vendorCode: 'V9' })], two)

    expect(plan.groups).toEqual([])
    expect(plan.buckets.noAccount).toBe(2)
  })

  it('with one login, a row without a vendor code takes the login’s', () => {
    const plan = planDdrRows([row({ vendorCode: '' })], [{ username: 'a@x.in', vendorCode: 'V1' }])

    expect(plan.groups[0]?.entries[0]?.vendorCode).toBe('V1')
  })

  it('with one login and no vendor code anywhere, the row is skipped rather than sent blank', () => {
    const plan = planDdrRows([row({ vendorCode: '' })], [{ username: 'a@x.in', vendorCode: '' }])

    expect(plan.groups).toEqual([])
    expect(plan.skipped[0]?.reason).toMatch(/No Vendor Code/)
  })

  it('sorts every unfileable row into its bucket, with a reason', () => {
    const plan = planDdrRows(
      [
        row({ sheetRow: 3, awb: '' }),
        row({ sheetRow: 4, awb: 'A4', sku: '' }),
        row({ sheetRow: 5, awb: 'A5', returnType: 'RETURN' }),
        row({ sheetRow: 6, awb: 'A6' }),
        row({ sheetRow: 7, awb: 'a6' })
      ],
      two
    )

    expect(plan.buckets).toEqual({
      claimable: 1,
      missingAwb: 1,
      missingSku: 1,
      badReturnType: 1,
      noAccount: 0,
      duplicate: 1
    })
    expect(plan.skipped.find(skip => skip.bucket === 'duplicate')?.reason).toMatch(/sheet row 6/)
    expect(plan.skipped.filter(skip => skip.final).map(skip => skip.bucket).sort()).toEqual(['duplicate'])
  })
})

describe('ticketEntry', () => {
  it('raises "Delivered but Not Received" with the DDR subject, the sheet’s fields and no evidence', () => {
    const plan = planDdrRows([row({ returnType: 'DTO' })], [{ username: 'a@x.in', vendorCode: 'V1' }])
    const entry = plan.groups[0]!.entries[0]!

    expect(ticketEntry(entry, TEMPLATE)).toEqual({
      subject: 'Delivery dispute Returns',
      issue: 'Delivered but Not Received',
      typeOfClaim: 'Delivered but Not Received',
      vendorCode: 'V1',
      skuId: 'SKU1',
      sku: 'SKU1',
      reverseAwb: 'AWB1',
      awbNumber: 'AWB1',
      returnType: 'DTO',
      description: '<div>Dear Team,<br><br>Please share the POD.</div>',
      evidenceUrl: ''
    })
  })

  it('escapes a Description from the sheet before it becomes ticket HTML', () => {
    expect(descriptionHtml('<img src=x onerror=alert(1)> & co')).toBe(
      '<div>&lt;img src=x onerror=alert(1)&gt; &amp; co</div>'
    )
  })
})

describe('runDdrGroup', () => {
  const group = {
    account: 'a@x.in',
    entries: planDdrRows(
      [row(), row({ sheetRow: 3, awb: 'AWB2' }), row({ sheetRow: 4, awb: 'AWB3' })],
      [{ username: 'a@x.in', vendorCode: 'V1' }]
    ).groups[0]!.entries
  }

  const deps = (over: Partial<DdrRunnerDeps>): { deps: DdrRunnerDeps; results: NykaaDdrResultRow[] } => {
    const results: NykaaDdrResultRow[] = []

    return {
      results,
      deps: {
        openContext: async () => ({ portalId: 'p' }),
        fileClaim: async (_ctx, entry) => ({ ticketId: `T-${entry.reverseAwb}`, alreadyExisted: false }),
        template: TEMPLATE,
        shouldStop: async () => false,
        onResult: async result => {
          results.push(result)
        },
        attemptOf: () => 1,
        ...over
      }
    }
  }

  it('reports a new ticket as Success and an existing one as Already Filed', async () => {
    const { deps: d, results } = deps({
      fileClaim: async (_ctx, entry) => ({ ticketId: `T-${entry.reverseAwb}`, alreadyExisted: entry.reverseAwb === 'AWB2' })
    })

    await runDdrGroup(group, d)

    expect(results.map(r => [r.awb, r.result, r.ticketNumber])).toEqual([
      ['AWB1', 'Success', 'T-AWB1'],
      ['AWB2', 'Already Filed', 'T-AWB2'],
      ['AWB3', 'Success', 'T-AWB3']
    ])
  })

  it('fails every row with the reason when the account’s session cannot be opened', async () => {
    const { deps: d, results } = deps({
      openContext: async () => {
        throw new Error('sign-in refused')
      }
    })

    await runDdrGroup(group, d)

    expect(results.map(r => r.result)).toEqual(['Failed', 'Failed', 'Failed'])
    expect(results[0]?.reason).toMatch(/sign-in refused/)
  })

  it('renews an expired session once and files the row again', async () => {
    let calls = 0
    const opened: boolean[] = []
    const { deps: d, results } = deps({
      openContext: async (_account, fresh) => {
        opened.push(fresh)

        return {}
      },
      fileClaim: async (_ctx, entry) => {
        calls++
        if (calls === 1) throw Object.assign(new Error('expired'), { code: 'AUTH_EXPIRED' })

        return { ticketId: `T-${entry.reverseAwb}`, alreadyExisted: false }
      }
    })

    await runDdrGroup(group, d)

    expect(opened).toEqual([false, true])
    expect(results.map(r => r.result)).toEqual(['Success', 'Success', 'Success'])
  })

  it('fails the rest of the account when the session expires again after renewing', async () => {
    const { deps: d, results } = deps({
      fileClaim: async () => {
        throw Object.assign(new Error('expired'), { code: 'AUTH_EXPIRED' })
      }
    })

    await runDdrGroup(group, d)

    expect(results.map(r => r.result)).toEqual(['Failed', 'Failed', 'Failed'])
    expect(results[2]?.reason).toMatch(/could not be renewed/)
  })

  it('reports a disabled submit as Dry Run, never as a filed ticket', async () => {
    const { deps: d, results } = deps({
      fileClaim: async () => {
        throw Object.assign(new Error('off'), { code: 'CLAIM_SUBMIT_DISABLED' })
      }
    })

    await runDdrGroup(group, d)

    expect(results.map(r => r.result)).toEqual(['Dry Run', 'Dry Run', 'Dry Run'])
  })

  it('stops between rows when automations are switched off', async () => {
    let checks = 0
    const { deps: d, results } = deps({ shouldStop: async () => ++checks > 1 })

    expect(await runDdrGroup(group, d)).toEqual({ stopped: true })
    expect(results).toHaveLength(1)
  })
})

describe('buildRunRows (retry)', () => {
  const accounts = [{ username: 'a@x.in', vendorCode: 'V1' }]

  it('keeps tickets already raised and re-files only the rest, one attempt further on', () => {
    const plan = planDdrRows([row(), row({ sheetRow: 3, awb: 'AWB2' }), row({ sheetRow: 4, awb: 'AWB3', sku: '' })], accounts)
    const first = buildRunRows(plan).rows.map(r =>
      r.awb === 'AWB1' ? { ...r, result: 'Success' as const, ticketNumber: 'T1' } : r.awb === 'AWB2' ? { ...r, result: 'Failed' as const } : r
    )

    // The operator fixes the missing SKU and retries.
    const fixed = planDdrRows([row(), row({ sheetRow: 3, awb: 'AWB2' }), row({ sheetRow: 4, awb: 'AWB3', sku: 'SKU3' })], accounts)
    const { rows, groups } = buildRunRows(fixed, first)

    expect(groups[0]?.entries.map(entry => entry.awb)).toEqual(['AWB2', 'AWB3'])
    expect(rows.map(r => [r.awb, r.result, r.attempt])).toEqual([
      ['AWB1', 'Success', 1],
      ['AWB2', 'Pending', 2],
      ['AWB3', 'Pending', 1]
    ])
  })

  it('never retries a final skip', () => {
    const plan = planDdrRows([row(), row({ sheetRow: 3 })], accounts)

    expect(buildRunRows(plan).rows.filter(isNykaaDdrRetryable)).toEqual([])
  })
})
