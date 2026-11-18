import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaimDocument } from '@main/automations/common/types'
import type { RefillValues } from '@main/automations/refill/types'

/**
 * The refill that runs INSIDE a claim, for the one row about to be filed.
 *
 * A claim that arrives over the socket without an account arrives without
 * whatever else nobody filled in — the sub-order number Snapdeal's and Meesho's
 * forms are keyed on, AJIO's POB and seller SKU, Myntra's forward AWB. The
 * search that names the account answers those too, and taking them then is the
 * difference between filing and failing at the marketplace a minute later.
 *
 * Two things here are easy to get wrong and invisible when they are:
 *
 *   1. The value has to land on the `config` bundle as well. The runner reads
 *      THAT, not the row — a claim stamped only at the top level files with the
 *      same blank that started this.
 *   2. The status is not asked for. `statusChange` reports where a FILED ticket
 *      stands, and this claim has not been filed.
 */

const calls = vi.hoisted(() => ({
  api: [] as { path: string; body: Record<string, unknown> }[],
  resolved: [] as { username: string; fields: string[] }[]
}))

const behaviour = vi.hoisted((): {
  values: RefillValues
  applyFails: boolean
  applied: Record<string, string>
} => ({ values: {}, applyFails: false, applied: {} }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/automationLock', () => ({ withAutomationLock: vi.fn() }))
vi.mock('@main/services/mappingAccounts.service', () => ({ mappingAccounts: () => Promise.resolve([]) }))
vi.mock('@main/services/accountMapping.service', () => ({ ProbePool: class {} }))
vi.mock('@main/services/refillArchive.store', () => ({ writeRefillJob: () => Promise.resolve() }))
vi.mock('@main/automations/common/prepareCore', () => ({ prepareCoreWithBrowser: vi.fn() }))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: () => ({}) }))
vi.mock('@main/automations/refill/registry', () => ({
  refillPlatform: (platform: string) =>
    platform === 'nowhere'
      ? null
      : {
          resolve: (input: { username: string; fields: string[] }) => {
            calls.resolved.push({ username: input.username, fields: input.fields })

            return Promise.resolve(behaviour.values)
          }
        }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown }) => {
    calls.api.push({ path, body: (options.body ?? {}) as Record<string, unknown> })

    return Promise.resolve(
      behaviour.applyFails
        ? { success: false, error: { code: 'INTERNAL_ERROR', message: 'the server said no' } }
        : { success: true, data: { applied: behaviour.applied, skipped: [], replaced: [] } }
    )
  }
}))

const { refillClaimFields } = await import('@main/services/refill.service')

const run = async (platform: string, doc: ClaimDocument): Promise<string[]> =>
  refillClaimFields({
    platform,
    cmsId: 'cms-1',
    doc,
    awb: 'AWB1',
    username: 'seller@x.com',
    token: 'token',
    contexts: new Map<string, unknown>()
  })

beforeEach(() => {
  calls.api = []
  calls.resolved = []
  behaviour.values = {}
  behaviour.applyFails = false
  behaviour.applied = {}
})

describe('refillClaimFields', () => {
  it('asks for the platform’s fields, minus the account and the status', async () => {
    behaviour.values = { subOrderNumber: 'SUB-1' }
    behaviour.applied = { subOrderNumber: 'SUB-1' }

    await run('snapdeal', { AWBNumber: 'AWB1' })

    // snapdeal offers accountMapping, subOrderNumber, statusChange.
    expect(calls.resolved).toEqual([{ username: 'seller@x.com', fields: ['subOrderNumber'] }])
  })

  it('stamps the value on the document AND the config the runner reads', async () => {
    behaviour.values = { subOrderNumber: 'SUB-1' }
    behaviour.applied = { subOrderNumber: 'SUB-1' }

    const doc: ClaimDocument = { AWBNumber: 'AWB1', config: { awbNumber: 'AWB1' } }

    expect(await run('snapdeal', doc)).toEqual(['subOrderNumber'])
    expect(doc.subOrderNumber).toBe('SUB-1')
    expect((doc.config as Record<string, unknown>).subOrderNumber).toBe('SUB-1')
  })

  it('puts AJIO’s SKU and POB where the backend’s config bundle keeps them', async () => {
    behaviour.values = { sellerSku: 'SKU-9', pobId: '1234', forwardAWB: 'FWD-1' }
    behaviour.applied = { sellerSku: 'SKU-9', pobId: '1234', forwardAWB: 'FWD-1' }

    const doc: ClaimDocument = { AWBNumber: 'AWB1', config: {} }

    await run('ajio', doc)

    expect(doc.seller_sku).toBe('SKU-9')
    expect(doc.pobid).toBe('1234')
    expect(doc.forwardAWB).toBe('FWD-1')
    // getPlatformConfig calls the SKU `sku`; the POB keeps its name.
    expect(doc.config).toMatchObject({ sku: 'SKU-9', pobid: '1234' })
  })

  it('never overwrites what the row already carries', async () => {
    behaviour.values = { subOrderNumber: 'SUB-FROM-SEARCH' }

    const doc: ClaimDocument = {
      AWBNumber: 'AWB1',
      subOrderNumber: 'SUB-TYPED',
      config: { subOrderNumber: 'SUB-TYPED' }
    }

    await run('snapdeal', doc)

    expect(doc.subOrderNumber).toBe('SUB-TYPED')
    expect((doc.config as Record<string, unknown>).subOrderNumber).toBe('SUB-TYPED')
  })

  it('sends only what the marketplace answered', async () => {
    behaviour.values = { forwardAWB: 'FWD-1' }
    behaviour.applied = { forwardAWB: 'FWD-1' }

    await run('tatacliq', { AWBNumber: 'AWB1' })

    expect(calls.api).toHaveLength(1)
    expect(calls.api[0]?.path).toBe('/cms/refill-apply')
    expect(calls.api[0]?.body).toEqual({ cmsId: 'cms-1', forwardAWB: 'FWD-1' })
    // Never the account: it was established before this ran, and writing it
    // again from here would be a second claim on the same fact.
    expect(calls.api[0]?.body.username).toBeUndefined()
  })

  it('writes nothing when the marketplace answered nothing', async () => {
    behaviour.values = {}

    expect(await run('snapdeal', { AWBNumber: 'AWB1' })).toEqual([])
    expect(calls.api).toHaveLength(0)
  })

  it('reports a miss without calling the server', async () => {
    behaviour.values = { missing: 'AWB1 is not in this machine’s AJIO backup' }

    expect(await run('ajio', { AWBNumber: 'AWB1' })).toEqual([])
    expect(calls.api).toHaveLength(0)
  })

  it('still stamps the document when the write-back fails', async () => {
    behaviour.values = { subOrderNumber: 'SUB-1' }
    behaviour.applyFails = true

    const doc: ClaimDocument = { AWBNumber: 'AWB1', config: {} }

    // The claim is about to be filed with this value — losing it because the
    // server was unreachable would waste the search that found it.
    expect(await run('snapdeal', doc)).toEqual([])
    expect(doc.subOrderNumber).toBe('SUB-1')
    expect((doc.config as Record<string, unknown>).subOrderNumber).toBe('SUB-1')
  })

  it('does nothing for a platform with no resolver', async () => {
    expect(await run('nowhere', { AWBNumber: 'AWB1' })).toEqual([])
    expect(calls.resolved).toHaveLength(0)
    expect(calls.api).toHaveLength(0)
  })

  it('does nothing for a platform whose only refillable field is the account', async () => {
    // xbees: accountMapping and nothing else — there is no second question.
    expect(await run('xbees', { AWBNumber: 'AWB1' })).toEqual([])
    expect(calls.resolved).toHaveLength(0)
  })
})
