import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * "Filed" has to mean a ticket exists.
 *
 * The reported symptom: an Auto claim run said `46 filed · 7 failed` for AJIO
 * while the claim list held six tickets. The counter was not lying about how
 * many claims it ran — it was counting the wrong thing. `done` incremented on
 * `result.success` alone, and a runner reports success whether or not the
 * marketplace handed back a ticket id (AJIO's own message says so: "claim
 * raised (no ticket id)"). Worse, the `/cms/update-ticket` write-back is
 * guarded on that same id, so those claims wrote NOTHING to TrackVid and were
 * still counted as filed.
 *
 * These pin the split: a success with a ticket is `filed`, a success without
 * one is `ticketless`, and a ticketless claim is never reported as filed.
 */

const state = vi.hoisted(() => ({
  /** What the runner hands back for each AWB, in order. */
  results: [] as { ticketId: string | null }[],
  ticketWriteBacks: [] as string[],
  progress: [] as Record<string, unknown>[]
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (_channel: string, payload: unknown) => {
    state.progress.push(payload as Record<string, unknown>)
  }
}))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: async <T>(_name: string, work: () => Promise<T>): Promise<T> => work(),
  isAutomationBusy: () => false,
  automationHolder: () => null
}))
vi.mock('@main/services/browserLease.service', () => ({
  openClaimLease: vi.fn(),
  closeClaimLease: () => Promise.resolve(),
  discardLease: () => Promise.resolve(),
  leasedSession: vi.fn()
}))
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => 'token',
  getSession: () => ({ user: { companyId: 'c1', email: 'a@b.com' } })
}))
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: { ticket?: string } }) => {
    // The claim document the runner is handed.
    if (path === '/cms/find-by-awb') {
      return Promise.resolve({ success: true, data: { AWBNumber: 'AWB', otherClaimDetails: {} } })
    }

    // THE WRITE-BACK THIS TEST IS ABOUT. Only ever reached when a ticket id
    // came back, because `processOne` guards it on exactly that.
    if (path === '/cms/update-ticket') {
      state.ticketWriteBacks.push(options.body?.ticket ?? '')

      return Promise.resolve({ success: true, data: {} })
    }

    return Promise.resolve({ success: true, data: {} })
  }
}))
vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () =>
    Promise.resolve(
      state.results.map((_, index) => ({
        cmsId: `cms-${index}`,
        platform: 'ajio',
        awbNumber: `AWB-${index}`,
        status: 'received'
      }))
    ),
  recordDispatch: vi.fn(),
  setStatus: vi.fn()
}))
vi.mock('@main/services/automationRouting.service', () => ({
  claimRoutingSnapshot: vi.fn(),
  // Auto-login off: these cases are not about re-capturing a session.
  autoLoginEnabled: () => Promise.resolve(false),
  runsHere: () => Promise.resolve(true),
  usesApiFlow: () => Promise.resolve(true)
}))
vi.mock('@main/automations/registry', () => ({
  CLAIM_RUNNERS: { ajio: {} },
  // One claim per entry in `state.results`, answered in order.
  resolveClaimRunner: () => ({
    flow: 'api',
    substituted: false,
    runner: (claim: { cmsId: string }) => {
      const index = Number(String(claim.cmsId).split('-')[1] ?? 0)
      const next = state.results[index] ?? { ticketId: null }

      return Promise.resolve({
        cmsId: claim.cmsId,
        ticketId: next.ticketId,
        message: next.ticketId ? `raised (${next.ticketId})` : 'claim raised (no ticket id)'
      })
    }
  }),
  ticketLookup: () => null
}))
vi.mock('@main/services/claimSessionGuard', () => ({
  inactiveAccounts: () => Promise.resolve([]),
  sessionVerdicts: () => Promise.resolve([]),
  accountKey: (platform: string, username: string) => `${platform}:${username}`,
  describeBlocked: () => 'blocked'
}))
vi.mock('@main/services/claimSession.service', () => ({ renewForClaim: vi.fn() }))
vi.mock('@main/automations/common/claimAccount', () => ({
  requireClaimAccount: () => Promise.resolve('seller@shop.com'),
  claimAccountUsername: () => 'seller@shop.com',
  companyWideAccount: () => null,
  stampClaimAccount: vi.fn()
}))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: vi.fn() }))
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
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'claim',
  withProcessLogResult: <T>(_name: string, run: () => Promise<T>): Promise<T> => run()
}))
vi.mock('@main/automations/accountMapping/registry', () => ({ probeOpener: () => null }))
vi.mock('@main/services/accountMapping.service', () => ({ ProbePool: class {} }))
vi.mock('@main/services/mappingAccounts.service', () => ({ mappingAccounts: () => Promise.resolve([]) }))
vi.mock('@main/services/refill.service', () => ({
  refillClaimFields: vi.fn(),
  closeRefingContexts: vi.fn(),
  closeRefillContexts: vi.fn()
}))
vi.mock('@main/services/pendingClaims.service', () => ({
  claimsAwaitingStatus: () => Promise.resolve({ rows: [], upToDate: new Map() }),
  pendingClaims: vi.fn(),
  splitFileable: vi.fn()
}))

const { processClaims } = await import('@main/services/claimProcessor.service')

const run = () =>
  processClaims(
    state.results.map((_, index) => ({
      cmsId: `cms-${index}`,
      platform: 'ajio',
      awbNumber: `AWB-${index}`
    }))
  )

describe('what a run may call "filed"', () => {
  beforeEach(() => {
    state.results = []
    state.ticketWriteBacks = []
    state.progress = []
  })

  it('counts a success WITH a ticket as filed', async () => {
    state.results = [{ ticketId: 'TKT-1' }]

    const result = await run()

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.done).toBe(1)
    expect(result.data.ticketless).toBe(0)
    // The ticket reached TrackVid, which is what makes it a filed claim.
    expect(state.ticketWriteBacks).toEqual(['TKT-1'])
  })

  it('does NOT count a success with no ticket id as filed', async () => {
    state.results = [{ ticketId: null }]

    const result = await run()

    expect(result.success).toBe(true)
    if (!result.success) return

    // The bug, pinned: this used to be done=1, and the run reported it filed.
    expect(result.data.done).toBe(0)
    expect(result.data.ticketless).toBe(1)
    // Nor is it a failure — something was probably raised at the marketplace,
    // and calling it failed invites the retry that raises a second ticket.
    expect(result.data.failed).toBe(0)
    // And nothing was written back, which is the whole reason it cannot count.
    expect(state.ticketWriteBacks).toEqual([])
  })

  it('separates the two on the final tick, per platform', async () => {
    state.results = [{ ticketId: 'TKT-1' }, { ticketId: null }, { ticketId: 'TKT-2' }]

    const result = await run()

    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.done).toBe(2)
    expect(result.data.ticketless).toBe(1)

    const last = state.progress.at(-1)

    expect(last).toMatchObject({ running: false, succeeded: 2, ticketless: 1, failed: 0 })
    // `done` on the tick is ATTEMPTED, so a ticketless claim still counts as
    // work the batch got through — otherwise the bar would stall at 2 of 3.
    expect(last?.done).toBe(3)
    expect(last?.platforms).toMatchObject([
      { platform: 'ajio', total: 3, done: 3, succeeded: 2, ticketless: 1, failed: 0 }
    ])
  })
})
