import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Which source a Return Order Number lookup actually reads from.
 *
 * THE CASE THIS PINS. An operator selected Report on a machine whose backup
 * holds nothing, typed a return order number, and the log showed AJIO being
 * called — `AJIO Return Report … after 1 window(s)`. Report must never reach
 * AJIO: it reads this machine's backup, and when that has nothing the answer is
 * "Record not found", not a live lookup behind the operator's back.
 *
 * The opposite matters just as much and is easier to get wrong later: API must
 * NOT quietly answer from the backup, or a stale copy would be presented as
 * current.
 */

const calls = vi.hoisted(() => ({ api: 0, backup: 0 }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>) => work(),
  isAutomationBusy: () => false,
  automationHolder: () => null
}))
vi.mock('@main/automations/platforms/ajio/master-import/api-based-flow/reportView', () => ({
  findAjioReturnOrder: () => {
    calls.api += 1

    return Promise.resolve({
      lines: [{ returnOrderNo: 'RT229465783', returnAwbNo: 'R2527029722AJI' }],
      window: { from: '2026-09-05', to: '2026-10-05' },
      searched: 1,
      source: 'api',
      username: 'online1@wrogn.com'
    })
  },
  findReturnOrderInBackup: () => {
    calls.backup += 1

    // The reported machine: a backup with nothing in it.
    return Promise.resolve({
      lines: [],
      window: null,
      searched: 0,
      source: 'report',
      username: 'online1@wrogn.com',
      coverage: null
    })
  },
  readAjioDropshipReport: vi.fn(),
  reportColumns: vi.fn()
}))

const { returnOrderLookup } = await import('@main/services/masterDataReport.service')

const lookup = (source?: string) =>
  returnOrderLookup({ username: 'online1@wrogn.com', returnOrderNo: 'RT229465783', ...(source ? { source } : {}) })

beforeEach(() => {
  calls.api = 0
  calls.backup = 0
})

describe('with Report selected', () => {
  it('reads the backup and never calls AJIO', async () => {
    const result = await lookup('report')

    expect(calls.backup).toBe(1)
    // The whole point: not one request to the marketplace.
    expect(calls.api).toBe(0)
    expect(result.success && result.data.lines).toEqual([])
  })

  it('answers empty rather than falling back to AJIO when the backup has nothing', async () => {
    // Falling through would make "Record not found" unreachable and hide which
    // source answered — exactly the confusion that prompted this test.
    const result = await lookup('report')

    expect(result.success).toBe(true)
    expect(calls.api).toBe(0)
  })
})

describe('with API selected', () => {
  it('asks AJIO and never reads the backup', async () => {
    const result = await lookup('api')

    expect(calls.api).toBe(1)
    expect(calls.backup).toBe(0)
    expect(result.success && result.data.lines).toHaveLength(1)
  })
})

describe('with no source given', () => {
  it('asks AJIO, which is what this did before the choice existed', async () => {
    // An older renderer bundle sends nothing. Defaulting to the live source is
    // the safe half: it is current, just slower.
    await lookup()

    expect(calls.api).toBe(1)
    expect(calls.backup).toBe(0)
  })
})
