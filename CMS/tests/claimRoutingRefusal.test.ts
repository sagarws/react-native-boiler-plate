import { describe, expect, it, vi } from 'vitest'

/**
 * A claim the SERVER owns, dispatched to this machine anyway.
 *
 * The backend routes claims per platform. When AJIO runs on the automation
 * server for a company, this app must not file one — and it does not. What it
 * also has to do is say so ON THE ROW, and for a long time it did not: the
 * routing check was the one refusal in `fileClaim` that returned without
 * writing anything back.
 *
 * The result was a queue that could never empty. The dispatch arrives, the
 * record is written as `received`, every drain refuses it, nothing changes the
 * status — and the Background work panel, which calls anything not `running`
 * "queued", showed five AJIO claims sitting there from the minute they landed
 * with no reason attached to any of them.
 *
 * The other half matters just as much: the backend is NOT told. The server is
 * going to file this claim, so reporting a failure from here would be false and
 * would spend one of the row's three attempts on a machine that never touched
 * it.
 */

const calls = vi.hoisted(() => ({
  status: [] as { cmsId: string; status: string; error?: string }[],
  ended: [] as string[],
  reported: [] as string[]
}))

const CLAIM = {
  cmsId: 'claim-1',
  companyId: 'company-1',
  platform: 'ajio',
  awbNumber: 'R2474474903AJI',
  dispatchedAt: '2026-09-19T04:47:42.368Z',
  status: 'received' as const,
  receivedAt: '2026-09-19T04:47:42.368Z',
  updatedAt: '2026-09-19T04:47:42.368Z'
}

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_name: string, work: () => Promise<T>): Promise<T> => work(),
  isAutomationBusy: () => false,
  automationHolder: () => null
}))
vi.mock('@main/services/browserLease.service', () => ({
  openClaimLease: vi.fn(),
  closeClaimLease: () => Promise.resolve()
}))
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => 'token',
  getSession: () => ({ user: { companyId: 'company-1' } })
}))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () => Promise.resolve([CLAIM]),
  recordDispatch: vi.fn(),
  setStatus: (cmsId: string, status: string, extra: { error?: string } = {}) => {
    calls.status.push({ cmsId, status, ...extra })

    return Promise.resolve(true)
  }
}))
// THE POINT OF THE TEST: this company files AJIO claims on the server.
vi.mock('@main/services/automationRouting.service', () => ({
  claimRoutingSnapshot: vi.fn(),
  // Auto-login off: these cases are not about re-capturing a session.
  autoLoginEnabled: () => Promise.resolve(false),
  runsHere: () => Promise.resolve(false),
  usesApiFlow: () => Promise.resolve(false)
}))
vi.mock('@main/automations/registry', () => ({ CLAIM_RUNNERS: {}, resolveClaimRunner: vi.fn() }))
vi.mock('@main/services/claimSessionGuard', () => ({
  inactiveAccounts: () => Promise.resolve([]),
  sessionVerdicts: () => Promise.resolve([]),
  accountKey: (platform: string, username: string) => `${platform}:${username}`,
  describeBlocked: () => ''
}))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: vi.fn() }))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: vi.fn(),
  prepareCoreProcess: vi.fn()
}))
vi.mock('@main/services/claimLiveness.service', () => ({
  beginRun: vi.fn(),
  endRun: (cmsId: string) => {
    calls.ended.push(cmsId)

    return Promise.resolve()
  },
  reportClaimSkipped: (cmsId: string) => {
    calls.reported.push(cmsId)

    return Promise.resolve()
  }
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'claim',
  withProcessLogResult: <T>(_name: string, run: () => Promise<T>): Promise<T> => run()
}))

const { runClaim } = await import('@main/services/claimProcessor.service')

describe('a claim routed to the server', () => {
  it('is refused, and the refusal is written to the local row', async () => {
    calls.status = []
    calls.ended = []
    calls.reported = []

    const result = await runClaim('claim-1')

    expect(result.success).toBe(false)

    // Without this the record stays `received` for good and the Background
    // work panel shows it as queued forever.
    expect(calls.status).toEqual([
      {
        cmsId: 'claim-1',
        status: 'failed',
        error: expect.stringContaining('run on the server for this company')
      }
    ])
  })

  /**
   * The server owns this claim and is going to file it. A failure reported from
   * here would be untrue and would cost the row one of its three attempts —
   * three dispatches to the wrong machine would retire a perfectly fileable
   * claim to Failed to Proceed.
   */
  it('tells the backend nothing at all', async () => {
    calls.status = []
    calls.ended = []
    calls.reported = []

    await runClaim('claim-1')

    expect(calls.ended).toEqual([])
    expect(calls.reported).toEqual([])
  })
})
