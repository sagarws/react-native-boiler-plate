import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefillField } from '@shared/types/refill'

/**
 * AJIO's refill, which asks nobody.
 *
 * Every other platform's refill is a question put to a seller portal; AJIO's is
 * a lookup in the copy of the return report this machine already keeps. What
 * matters is that it stays honest about that copy: a row that was never backed
 * up must be reported as missing rather than filled with blanks, the forward
 * AWB must not be the number that was searched for, and the account must come
 * from the POB rather than from a guess.
 */

const backup = new Map([
  [
    '2367064627473',
    {
      awb: '2367064627473',
      year: 2026,
      month: 9,
      forwardAwb: 'FWD90011',
      sellerSku: '8905834507638',
      pobId: 'DV00353155'
    }
  ],
  [
    '4884667802721',
    {
      awb: '4884667802721',
      year: 2026,
      month: 8,
      // A return whose forward leg AJIO never filled in.
      forwardAwb: '',
      sellerSku: '8905834912098',
      pobId: 'DV00349266'
    }
  ],
  [
    'R2469309517AJI',
    {
      awb: 'R2469309517AJI',
      year: 2026,
      month: 9,
      // Searched by its own number: nothing to fill.
      forwardAwb: 'R2469309517AJI',
      sellerSku: '8905198085810',
      pobId: 'DV99999999'
    }
  ]
])

vi.mock('@main/services/masterBackup.store', () => ({
  awbLookup: () => Promise.resolve(backup),
  readCoverage: () =>
    Promise.resolve({
      report: 'return',
      months: [{ year: 2026, month: 9, rows: 3, pages: 1, lastSyncedAt: '', bytes: 0 }],
      days: [
        { date: '2026-03-10', rows: 1 },
        { date: '2026-09-16', rows: 2 }
      ],
      rows: 31814,
      bytes: 0
    })
}))
vi.mock('@main/services/masterDataReport.service', () => ({
  reportAccounts: () =>
    Promise.resolve({
      success: true,
      data: [
        { username: 'online1@wrogn.com', pobCount: 2, pobIds: ['DV00353155', 'DV00349266'] },
        { username: 'online2@wrogn.com', pobCount: 1, pobIds: ['DV00111111'] }
      ]
    })
}))

const { ajioRefill, forgetPobOwners } = await import(
  '@main/automations/platforms/ajio/refill/refillFields'
)

const ALL: RefillField[] = ['accountMapping', 'forwardAwbNumber', 'sellerSku', 'pobId']

const ask = (awb: string, fields: RefillField[] = ALL) =>
  ajioRefill({
    doc: {},
    awb,
    username: '',
    ticketNumber: null,
    fields,
    contexts: new Map()
  })

beforeEach(() => {
  forgetPobOwners()
})

describe('the AJIO refill', () => {
  it('answers all four fields from one backed-up row', async () => {
    const values = await ask('2367064627473')

    expect(values).toEqual({
      forwardAWB: 'FWD90011',
      sellerSku: '8905834507638',
      pobId: 'DV00353155',
      username: 'online1@wrogn.com'
    })
  })

  it('names the account from the POB, not from the AWB', async () => {
    const values = await ask('4884667802721', ['accountMapping'])

    // A different POB under the same login — and nothing else asked for.
    expect(values.username).toBe('online1@wrogn.com')
    expect(values.sellerSku).toBeUndefined()
    expect(values.pobId).toBeUndefined()
  })

  it('leaves the account null when no login holds that POB', async () => {
    const values = await ask('R2469309517AJI', ['accountMapping'])

    expect(values.username).toBeNull()
  })

  it('does not fill the forward AWB with the number it was searched by', async () => {
    const values = await ask('R2469309517AJI', ['forwardAwbNumber'])

    expect(values.forwardAWB).toBeUndefined()
  })

  it('says nothing about a field the row has no value for', async () => {
    const values = await ask('4884667802721', ['forwardAwbNumber', 'sellerSku'])

    expect(values.forwardAWB).toBeUndefined()
    expect(values.sellerSku).toBe('8905834912098')
  })

  it('matches regardless of casing or stray spacing', async () => {
    const values = await ask('  r2469309517aji  ', ['sellerSku'])

    expect(values.sellerSku).toBe('8905198085810')
  })

  it('reports an AWB it does not hold as NOT FOUND, not as a failure', async () => {
    const values = await ask('9999999999999')

    // An answer, not an exception: the run records it as not found and writes
    // nothing, rather than reporting a bug that does not exist.
    expect(values.missing).toBeTruthy()
    expect(values.forwardAWB).toBeUndefined()
    expect(values.sellerSku).toBeUndefined()
    expect(values.pobId).toBeUndefined()
    expect(values.username).toBeUndefined()
  })

  it('says what the backup actually holds, since that is what names the fix', async () => {
    const { missing } = await ask('9999999999999')

    // The three fixes are told apart by the dates: sync the newest days, back
    // up an older month, or check the AWB on the claim.
    expect(missing).toContain('31,814')
    expect(missing).toContain('2026-03-10 → 2026-09-16')
    expect(missing).toContain('9999999999999')
  })
})
