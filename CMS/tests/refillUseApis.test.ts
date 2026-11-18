import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Use APIs" — where AJIO's refill gets its answers from.
 *
 * AJIO is the one platform whose refill is answered from THIS MACHINE: the
 * account, POB, SKU and forward AWB are read out of the local report backup, so
 * it needs no login and makes no network call. That is the right answer
 * whenever the backup holds the row — and useless when it does not, which is
 * common, because AJIO caps a report window at 10,000 rows and a busy month is
 * partial until it has been re-read in pieces.
 *
 * With the toggle on, AJIO behaves like every other platform: the mapping probe
 * opens each login and puts the AWB to it. Two things have to be true of that,
 * and both are pinned here:
 *
 *   • the local resolver is NOT consulted for the account — otherwise the
 *     backup would answer first and the toggle would change nothing
 *   • the POB the probe found is WRITTEN. It is a by-product of the search (a
 *     return is found by sweeping the login's POBs), and the mapping run used
 *     to throw it away, leaving the POB blank on the very rows it had located.
 */

const calls = vi.hoisted(() => ({
  applied: [] as Record<string, unknown>[],
  probed: [] as string[],
  resolverCalls: [] as string[][]
}))

const behaviour = vi.hoisted(() => ({
  /** What the probe answers with when it finds the AWB. */
  pobId: 'DV00332648',
  owner: 'ops@seller.com'
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>): Promise<T> => work()
}))
vi.mock('@main/services/mappingAccounts.service', () => ({
  mappingAccounts: () =>
    Promise.resolve([{ username: behaviour.owner, credentialId: 'id-1', accountType: '' }])
}))
vi.mock('@main/services/accountMapping.service', () => ({
  ProbePool: class {
    probe(account: { username: string }): Promise<unknown> {
      calls.probed.push(account.username)

      return Promise.resolve({ ask: () => Promise.resolve({ found: true }) })
    }

    closeAll(): Promise<void> {
      return Promise.resolve()
    }
  }
}))
vi.mock('@main/services/refillArchive.store', () => ({ writeRefillJob: () => Promise.resolve() }))
vi.mock('@main/automations/common/prepareCore', () => ({ prepareCoreWithBrowser: vi.fn() }))

/**
 * The core's mapping engine, answering as AJIO's probe does: found, WITH the
 * POB that held it. `scope` is the field the service used to discard.
 */
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    mapAwbToAccount: async ({
      accounts,
      probe
    }: {
      accounts: { username: string }[]
      probe: (account: { username: string }, awb: string, alternates: string[]) => Promise<unknown>
    }) => {
      for (const account of accounts) await probe(account, 'AWB-1', [])

      return {
        matched: accounts[0] ?? null,
        scope: { pobId: behaviour.pobId },
        attempts: [],
        errors: []
      }
    },
    describeMiss: () => 'nobody has it',
    RecentFirst: class {
      order<T>(items: T[]): T[] {
        return items
      }

      remember(): void {}
    }
  })
}))

/**
 * AJIO's registry entry, as it really is: it answers from disk AND supplies the
 * account itself. Both are what the toggle has to override.
 */
vi.mock('@main/automations/refill/registry', () => ({
  refillPlatform: (platform: string) =>
    platform === 'ajio'
      ? {
          offline: true,
          answersAccount: true,
          reset: vi.fn(),
          resolve: ({ fields }: { fields: string[] }) => {
            calls.resolverCalls.push(fields)

            // The backup's answer. Deliberately a DIFFERENT POB, so a test can
            // tell which source won.
            return Promise.resolve({ username: 'from-backup@seller.com', pobId: 'DV-FROM-DISK' })
          }
        }
      : null,
  refillResolver: () => null
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown }) => {
    if (path === '/cms/refill-apply') {
      calls.applied.push((options.body ?? {}) as Record<string, unknown>)

      return Promise.resolve({ success: true, data: { applied: {}, skipped: [] } })
    }

    // The claim document the run reads before asking anything.
    return Promise.resolve({ success: true, data: { AWBNumber: 'AWB-1' } })
  }
}))

const { runRefill } = await import('@main/services/refill.service')

const run = (useApis: boolean) =>
  runRefill({
    platform: 'ajio',
    claims: [{ cmsId: 'cms-1', awb: 'AWB-1' }],
    fields: ['accountMapping', 'pobId'],
    useApis
  })

describe('AJIO refill · Use APIs', () => {
  beforeEach(() => {
    calls.applied = []
    calls.probed = []
    calls.resolverCalls = []
  })

  it('OFF — answers from the local backup, and never opens a login', async () => {
    await run(false)

    // The disk resolver answered, so no account was ever put to a marketplace.
    expect(calls.probed).toEqual([])
    expect(calls.applied[0]?.username).toBe('from-backup@seller.com')
    expect(calls.applied[0]?.pobId).toBe('DV-FROM-DISK')
  })

  it('ON — asks the marketplace, and writes the POB the probe found', async () => {
    await run(true)

    // The probe ran, which it cannot do while the resolver is answering the
    // account: `answersAccount` has to be overridden, not just `offline`.
    expect(calls.probed).toEqual([behaviour.owner])
    expect(calls.applied[0]?.username).toBe(behaviour.owner)
    // THE HALF THAT USED TO BE LOST. The sweep finds the return by trying each
    // POB, so the POB is part of the answer — and an AJIO claim cannot be filed
    // without it.
    expect(calls.applied[0]?.pobId).toBe('DV00332648')
  })
})
