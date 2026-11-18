import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProcessResult, QueuedClaim } from '@shared/types/claimQueue'

/**
 * A session that dies WHILE a claim is being filed.
 *
 * A pre-flight check cannot cover this, and not only because of timing: the two
 * questions are not the same question. Myntra's probe reads the partner boot
 * payload, which answers happily, while the SPF API the claim actually calls
 * replies "session expired" for the very same jar. Nine claims failed that way
 * against a session the probe had just called healthy.
 *
 * The core already labels these: `authError` tags them `AUTH_EXPIRED` with the
 * comment "so callers can re-login and retry once". Nothing ever did.
 */

const state = vi.hoisted(() => ({ renewed: true, renewals: 0 }))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/claimSession.service', () => ({
  renewForClaim: () => {
    state.renewals += 1

    return Promise.resolve(state.renewed ? { jar: {}, source: 'local-capture' } : null)
  }
}))
vi.mock('@main/automations/common/claimAccount', () => ({
  requireClaimAccount: () => Promise.resolve('seller@example.com')
}))

// Collaborators the module pulls in at import time but this path never reaches.
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
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
vi.mock('@main/automations/registry', () => ({ CLAIM_RUNNERS: {}, resolveClaimRunner: vi.fn() }))
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: vi.fn() }))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: vi.fn(),
  prepareCoreProcess: vi.fn()
}))
vi.mock('@main/services/claimLiveness.service', () => ({ beginRun: vi.fn(), endRun: vi.fn() }))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'claim',
  withProcessLogResult: <T>(_n: string, run: () => Promise<T>): Promise<T> => run()
}))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: <T>(_n: string, work: () => Promise<T>): Promise<T> => work()
}))
vi.mock('@main/services/browserLease.service', () => ({
  openClaimLease: vi.fn(),
  closeClaimLease: vi.fn()
}))
vi.mock('@main/ipc/broadcast', () => ({ broadcast: vi.fn() }))

const { runWithSessionRetry } = await import('@main/services/claimProcessor.service')

const claim = { cmsId: 'c1', platform: 'myntra' } as QueuedClaim
const doc = {} as never
const filed = { cmsId: 'c1', ticketId: 'TK-1', message: 'filed' } as ProcessResult

const expired = (): Error => {
  const error = new Error('fetchNewClaim: session expired (HTTP 101)') as Error & { code?: string }

  error.code = 'AUTH_EXPIRED'

  return error
}

beforeEach(() => {
  state.renewed = true
  state.renewals = 0
})

describe('runWithSessionRetry', () => {
  it('renews and files successfully on the second attempt', async () => {
    const runner = vi.fn().mockRejectedValueOnce(expired()).mockResolvedValueOnce(filed)

    await expect(runWithSessionRetry(claim, doc, runner)).resolves.toEqual(filed)
    expect(state.renewals).toBe(1)
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('leaves every other failure alone', async () => {
    // "No valid orders found" is a business outcome. Renewing a session over it
    // would sign the account in again for no reason and hide the real answer.
    const runner = vi.fn().mockRejectedValue(new Error('No valid orders found'))

    await expect(runWithSessionRetry(claim, doc, runner)).rejects.toThrow('No valid orders found')
    expect(state.renewals).toBe(0)
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('retries ONCE — a second expiry is something else wearing the same message', async () => {
    // Looping here would sign a marketplace account in over and over.
    const runner = vi.fn().mockRejectedValue(expired())

    await expect(runWithSessionRetry(claim, doc, runner)).rejects.toThrow(/session expired/)
    expect(runner).toHaveBeenCalledTimes(2)
    expect(state.renewals).toBe(1)
  })

  it('reports what the marketplace said when the renewal itself fails', async () => {
    // Not "the sign-in window closed" — that would bury the actual answer.
    state.renewed = false

    const runner = vi.fn().mockRejectedValue(expired())

    await expect(runWithSessionRetry(claim, doc, runner)).rejects.toThrow(/session expired/)
    expect(runner).toHaveBeenCalledTimes(1)
  })
})
