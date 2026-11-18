import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Normal Bulk Claim's refill: local report backup first, then the marketplace
 * for whatever is still blank — filling blanks only, writing nothing.
 */

const state = vi.hoisted(() => ({
  local: new Map<string, Record<string, string> | null>(),
  offline: false,
  hasLocal: true,
  accounts: [{ username: 'only@x.com', credentialId: 'c1', accountType: '' }],
  resolveCalls: [] as { awb: string; username: string; fields: string[] }[],
  resolveAnswer: {},
  events: [] as { step: string; done: number; total: number }[],
  prepared: 0
}))

vi.mock('@main/services/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (_channel: string, payload: { step: string; done: number; total: number }) => state.events.push(payload)
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'bulk refill',
  withProcessLogResult: (_name: string, fn: () => Promise<unknown>) => fn()
}))
vi.mock('@main/services/automationLock', () => ({ withAutomationLock: (_n: string, fn: () => Promise<unknown>) => fn() }))
vi.mock('@main/services/signInPolicy', () => ({ withoutSignIn: (fn: () => Promise<unknown>) => fn() }))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: () => {
    state.prepared += 1

    return Promise.resolve()
  }
}))
vi.mock('@main/services/refill.service', () => ({ closeRefillContexts: () => Promise.resolve() }))
vi.mock('@main/services/mappingAccounts.service', () => ({ mappingAccounts: () => Promise.resolve(state.accounts) }))
vi.mock('@main/services/accountMapping.service', () => ({
  ProbePool: class {
    probe() {
      return Promise.resolve({ ask: () => Promise.resolve({ found: false }) })
    }
    async closeAll() {}
  }
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    mapAwbToAccount: () => Promise.resolve({ matched: null }),
    describeMiss: (awb: string) => `No account holds ${awb}`,
    RecentFirst: class {}
  })
}))
vi.mock('@main/automations/refill/registry', () => ({
  refillPlatform: () => ({
    offline: state.offline,
    ...(state.hasLocal ? { local: (awb: string) => Promise.resolve(state.local.get(awb) ?? null) } : {}),
    resolve: (input: { awb: string; username: string; fields: string[] }) => {
      state.resolveCalls.push({ awb: input.awb, username: input.username, fields: input.fields })

      return Promise.resolve(state.resolveAnswer)
    }
  })
}))

const { refillBulkRows } = await import('@main/services/bulkRefill.service')

const row = (patch: Record<string, string> = {}) => ({
  id: 'r1',
  awb: 'SDLR1',
  account: '',
  forwardAWB: '',
  subOrderNumber: '',
  sku: '',
  pobId: '',
  ...patch
})

beforeEach(() => {
  state.local.clear()
  state.offline = false
  state.hasLocal = true
  state.accounts = [{ username: 'only@x.com', credentialId: 'c1', accountType: '' }]
  state.resolveCalls.length = 0
  state.resolveAnswer = {}
  state.events.length = 0
  state.prepared = 0
})

describe('bulk refill', () => {
  it('answers from the local backup and does not ask the marketplace for what it filled', async () => {
    state.local.set('SDLR1', { forwardAWB: 'SF1', subOrderNumber: '7524', sku: 'SKU-1' })

    const result = await refillBulkRows({ runId: 'r', platform: 'snapdeal', rows: [row()] })

    expect(result.success && result.data[0]).toMatchObject({
      values: { forwardAWB: 'SF1', subOrderNumber: '7524', sku: 'SKU-1', account: 'only@x.com' },
      source: 'both',
      message: null
    })
    // The sub-order came from the backup and the single login is the account,
    // so nothing was asked — and no browser was opened for it.
    expect(state.resolveCalls).toEqual([])
    expect(state.prepared).toBe(0)
    expect(state.events.some(event => event.step === 'local')).toBe(true)
  })

  it('asks the marketplace for what the backup did not hold', async () => {
    state.resolveAnswer = { subOrderNumber: '9999' }

    const result = await refillBulkRows({ runId: 'r', platform: 'snapdeal', rows: [row()] })

    expect(state.resolveCalls).toEqual([{ awb: 'SDLR1', username: 'only@x.com', fields: ['subOrderNumber'] }])
    expect(result.success && result.data[0]?.values.subOrderNumber).toBe('9999')
    expect(result.success && result.data[0]?.source).toBe('marketplace')
  })

  it('never replaces what the operator typed', async () => {
    state.local.set('SDLR1', { forwardAWB: 'SF-BACKUP', subOrderNumber: '7524' })

    const result = await refillBulkRows({
      runId: 'r',
      platform: 'snapdeal',
      rows: [row({ forwardAWB: 'SF-TYPED', account: 'typed@x.com' })]
    })

    expect(result.success && result.data[0]?.values).toEqual({ subOrderNumber: '7524' })
  })

  it('does not ask the marketplace for a platform answered from disk', async () => {
    state.offline = true

    const result = await refillBulkRows({ runId: 'r', platform: 'ajio', rows: [row()] })

    expect(state.resolveCalls).toEqual([])
    expect(result.success && result.data[0]?.message).toMatch(/not in this machine's ajio report backup/)
  })

  it('says why a row stayed blank when no account holds it', async () => {
    state.hasLocal = false
    state.accounts = [
      { username: 'a@x.com', credentialId: 'c1', accountType: '' },
      { username: 'b@x.com', credentialId: 'c2', accountType: '' }
    ]

    const result = await refillBulkRows({ runId: 'r', platform: 'myntra', rows: [row({ awb: 'MY1' })] })

    expect(state.resolveCalls).toEqual([])
    expect(result.success && result.data[0]?.message).toBe('No account holds MY1')
  })

  it('refuses a run with no id', async () => {
    const result = await refillBulkRows({ platform: 'snapdeal', rows: [row()] })

    expect(result.success).toBe(false)
  })
})
