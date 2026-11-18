import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedClaim } from '@shared/types/claimQueue'
import type { ClaimDocument } from '@main/automations/common/types'

/**
 * A claim that arrives naming no account — and what is done about it before it
 * is filed.
 *
 * The backend now ROUTES those here instead of refusing them, because this app
 * can ask: the mapping probe opens each login and puts the AWB to it, and
 * exactly one of them holds the return. The rules worth pinning down are the
 * ones that decide what gets spent and what gets written:
 *
 *   • a row that already names an account is left alone
 *   • one login is not a question — it is written back without a probe
 *   • Nykaa has no per-row account at all, so there is no blank to fill
 *   • the account is never the only blank: the fields the same search answers
 *     are taken while the session is open
 *   • every session opened on the way is closed
 */

const calls = vi.hoisted(() => ({
  api: [] as { path: string; body: Record<string, unknown> }[],
  probed: [] as string[],
  refilled: [] as { platform: string; username: string }[],
  closedPools: 0,
  closedContexts: 0
}))

const behaviour = vi.hoisted(() => ({
  accounts: [] as string[],
  /** username → the AWBs it owns. */
  owner: '',
  hasProbe: true,
  companyWide: false,
  named: ''
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: unknown }) => {
    calls.api.push({ path, body: (options.body ?? {}) as Record<string, unknown> })

    return Promise.resolve({ success: true, data: {} })
  }
}))
vi.mock('@main/services/mappingAccounts.service', () => ({
  mappingAccounts: () =>
    Promise.resolve(
      behaviour.accounts.map(username => ({ username, credentialId: `id-${username}`, accountType: '' }))
    )
}))
vi.mock('@main/services/accountMapping.service', () => ({
  ProbePool: class {
    probe(account: { username: string }): Promise<{ ask: () => Promise<{ found: boolean }> }> {
      calls.probed.push(account.username)

      return Promise.resolve({
        ask: () => Promise.resolve({ found: account.username === behaviour.owner })
      })
    }

    closeAll(): Promise<void> {
      calls.closedPools += 1

      return Promise.resolve()
    }
  }
}))
vi.mock('@main/services/refill.service', () => ({
  refillClaimFields: (input: { platform: string; username: string }) => {
    calls.refilled.push({ platform: input.platform, username: input.username })

    return Promise.resolve(['subOrderNumber'])
  },
  closeRefillContexts: () => {
    calls.closedContexts += 1

    return Promise.resolve()
  }
}))
vi.mock('@main/automations/common/claimAccount', () => ({
  claimAccountUsername: () => behaviour.named,
  companyWideAccount: () => behaviour.companyWide,
  requireClaimAccount: () => Promise.resolve(''),
  stampClaimAccount: vi.fn()
}))
vi.mock('@main/automations/accountMapping/registry', () => ({
  probeOpener: () => (behaviour.hasProbe ? vi.fn() : null)
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: () => ({
    // The real engine, near enough: ask each account in turn, stop at the first
    // that says yes.
    mapAwbToAccount: async (input: {
      awb: string
      accounts: { username: string }[]
      probe: (account: { username: string }, awb: string, alternates: string[]) => Promise<unknown>
    }) => {
      for (const account of input.accounts) {
        const answer = (await input.probe(account, input.awb, [])) as { found: boolean }

        if (answer.found) return { matched: account }
      }

      return { matched: null }
    }
  })
}))

// Collaborators the module imports but this path never reaches.
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 't', getSession: () => null }))
vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () => Promise.resolve([]),
  recordDispatch: vi.fn(),
  setStatus: vi.fn()
}))
vi.mock('@main/services/automationRouting.service', () => ({
  claimRoutingSnapshot: vi.fn(),
  runsHere: vi.fn(),
  usesApiFlow: vi.fn()
}))
vi.mock('@main/services/claimSession.service', () => ({ renewForClaim: vi.fn() }))
vi.mock('@main/services/company.service', () => ({ credentialsFor: () => Promise.resolve([]) }))
vi.mock('@main/automations/registry', () => ({
  CLAIM_RUNNERS: {},
  resolveClaimRunner: vi.fn(),
  ticketLookup: vi.fn()
}))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: vi.fn(),
  prepareCoreProcess: vi.fn()
}))
vi.mock('@main/services/claimLiveness.service', () => ({
  beginRun: vi.fn(),
  endRun: vi.fn(),
  reportClaimSkipped: vi.fn(),
  settleIfUnreported: vi.fn()
}))
vi.mock('@main/services/claimSessionGuard', () => ({
  accountKey: vi.fn(),
  describeBlocked: vi.fn(),
  inactiveAccounts: () => Promise.resolve([]),
  sessionVerdicts: vi.fn()
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'claim',
  withProcessLogResult: <T>(_n: string, run: () => Promise<T>): Promise<T> => run()
}))
vi.mock('@main/services/automationLock', () => ({
  automationHolder: vi.fn(),
  isAutomationBusy: () => false,
  withAutomationLock: <T>(_n: string, work: () => Promise<T>): Promise<T> => work()
}))
vi.mock('@main/services/browserLease.service', () => ({
  openClaimLease: vi.fn(),
  closeClaimLease: vi.fn()
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))

const { refillClaimBeforeFiling } = await import('@main/services/claimProcessor.service')

const claim = { cmsId: 'c1', platform: 'snapdeal', awbNumber: 'AWB1' } as QueuedClaim

const run = (doc: ClaimDocument = { AWBNumber: 'AWB1' }): Promise<string | null> =>
  refillClaimBeforeFiling(claim, doc, 'token')

beforeEach(() => {
  calls.api = []
  calls.probed = []
  calls.refilled = []
  calls.closedPools = 0
  calls.closedContexts = 0
  behaviour.accounts = []
  behaviour.owner = ''
  behaviour.hasProbe = true
  behaviour.companyWide = false
  behaviour.named = ''
})

describe('refillClaimBeforeFiling', () => {
  it('declines a row that already names an account', async () => {
    behaviour.named = 'typed@x.com'
    behaviour.accounts = ['a@x.com', 'b@x.com']

    expect(await run()).toBeNull()
    expect(calls.probed).toEqual([])
  })

  it('declines a platform whose company login owns every ticket', async () => {
    // Nykaa. There is no per-row account, so nothing here is a blank.
    behaviour.companyWide = true
    behaviour.accounts = ['company@x.com']

    expect(await run()).toBeNull()
    expect(calls.api).toEqual([])
  })

  it('asks each login and writes back the one that holds the AWB', async () => {
    behaviour.accounts = ['first@x.com', 'second@x.com']
    behaviour.owner = 'second@x.com'

    expect(await run()).toBe('second@x.com')
    expect(calls.probed).toEqual(['first@x.com', 'second@x.com'])
    expect(calls.api).toEqual([
      { path: '/cms/account-map-apply', body: { cmsId: 'c1', username: 'second@x.com' } }
    ])
  })

  it('writes back the sole login without spending a probe', async () => {
    behaviour.accounts = ['only@x.com']

    expect(await run()).toBe('only@x.com')
    expect(calls.probed).toEqual([])
    expect(calls.api[0]?.body).toEqual({ cmsId: 'c1', username: 'only@x.com' })
  })

  it('refills the other blanks through the account it just established', async () => {
    behaviour.accounts = ['first@x.com', 'second@x.com']
    behaviour.owner = 'second@x.com'

    await run()

    expect(calls.refilled).toEqual([{ platform: 'snapdeal', username: 'second@x.com' }])
  })

  it('reports nothing when no login holds the AWB', async () => {
    behaviour.accounts = ['a@x.com', 'b@x.com']

    expect(await run()).toBeNull()
    expect(calls.api).toEqual([])
    expect(calls.refilled).toEqual([])
  })

  it('declines when the platform has no probe and more than one login', async () => {
    behaviour.hasProbe = false
    behaviour.accounts = ['a@x.com', 'b@x.com']

    expect(await run()).toBeNull()
  })

  it('closes the probes and the refill sessions, whatever happened', async () => {
    behaviour.accounts = ['a@x.com', 'b@x.com']
    behaviour.owner = 'b@x.com'

    await run()

    expect(calls.closedPools).toBe(1)
    expect(calls.closedContexts).toBe(1)
  })

  it('does nothing without an AWB to ask about', async () => {
    behaviour.accounts = ['a@x.com']

    expect(await refillClaimBeforeFiling({ cmsId: 'c1', platform: 'snapdeal' } as QueuedClaim, {}, 't')).toBeNull()
  })
})
