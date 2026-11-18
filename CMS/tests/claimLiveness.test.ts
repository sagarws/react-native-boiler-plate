import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

/**
 * Recovery is based on the STATUS, not on a clock.
 *
 * The app holds a single-instance lock, so in a fresh process anything still
 * marked `running` is orphaned by definition — its owner is gone. That is what
 * makes this exact where the server's 2-minute heartbeat threshold is a guess:
 * no window in which a slow claim is wrongly declared dead, and none in which a
 * dead one is still believed alive.
 */

const claims = vi.hoisted(() => ({ list: [] as { cmsId: string; status: string }[] }))
const calls = vi.hoisted(() => ({
  status: [] as { cmsId: string; status: string }[],
  reported: [] as { path: string; body: Record<string, unknown> }[]
}))

vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () => Promise.resolve(claims.list),
  setStatus: (cmsId: string, status: string) => {
    calls.status.push({ cmsId, status })

    return Promise.resolve(true)
  },
  touchRun: () => Promise.resolve(true)
}))

vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body: Record<string, unknown> }) => {
    calls.reported.push({ path, body: options.body })

    return Promise.resolve({ success: true, data: {} })
  }
}))

vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const { beginRun, endRun, recoverInterruptedRuns, reportClaimStatus, settleIfUnreported } =
  await import('@main/services/claimLiveness.service')

/**
 * A run that began and never said how it ended.
 *
 * The reported bug: a claim filed from the desktop app sat on "Running" with no
 * error and no attempt charged, while the claims either side of it failed
 * normally. Every outcome in the processor reaches `endRun` — but the reporting
 * inside its catch block can itself throw, and a throw inside a catch leaves
 * the function with the backend still believing the claim is being worked. The
 * six-hourly sweep is the only thing that ever cleared it.
 */
describe('a run that ends without reporting', () => {
  beforeEach(() => {
    calls.status = []
    calls.reported = []
  })

  const lastStatus = (): string | undefined =>
    calls.reported.at(-1)?.body.status as string | undefined

  it('fails the claim rather than leaving it on Running', async () => {
    await beginRun('stranded')

    expect(lastStatus()).toBe('Running')

    await settleIfUnreported('stranded')

    expect(lastStatus()).toBe('Failed')
    // The message has to leave room for a claim that WAS filed before the run
    // died — describing it as never attempted is what invites a second ticket.
    expect(String(calls.reported.at(-1)?.body.error)).toMatch(/check the marketplace/i)
  })

  it('does nothing when the run already reported its outcome', async () => {
    await beginRun('settled')
    await endRun('settled', 'Success', { ticketNumber: 'T-1' })

    const afterOutcome = calls.reported.length

    await settleIfUnreported('settled')

    // No second report: a success followed by a stray "Failed" would be worse
    // than the bug this guards against.
    expect(calls.reported.length).toBe(afterOutcome)
    expect(lastStatus()).toBe('Success')
  })

  it('does nothing for a claim that never began a run', async () => {
    await settleIfUnreported('never-started')

    expect(calls.reported).toEqual([])
  })
})

describe('recoverInterruptedRuns', () => {
  beforeEach(() => {
    claims.list = []
    calls.status = []
    calls.reported = []
  })

  it('recovers every claim left running, whatever its age', async () => {
    claims.list = [
      { cmsId: 'a', status: 'running' },
      { cmsId: 'b', status: 'received' },
      { cmsId: 'c', status: 'running' },
      { cmsId: 'd', status: 'succeeded' }
    ]

    expect(await recoverInterruptedRuns()).toBe(2)
    expect(calls.status).toEqual([
      { cmsId: 'a', status: 'failed' },
      { cmsId: 'c', status: 'failed' }
    ])
  })

  // The backend row is the point: left at Running it is invisible to every
  // retry path, and nothing on the server is watching it.
  it('resets the backend row so the claim becomes claimable again', async () => {
    claims.list = [{ cmsId: 'a', status: 'running' }]

    await recoverInterruptedRuns()

    expect(calls.reported).toHaveLength(1)
    expect(calls.reported[0]?.path).toBe('/cms/desktop-claim-status')
    expect(calls.reported[0]?.body.status).toBe('Not Started')
    expect(String(calls.reported[0]?.body.error)).toContain('stopped before this claim finished')
  })

  it('does nothing when the last run finished cleanly', async () => {
    claims.list = [{ cmsId: 'a', status: 'succeeded' }]

    expect(await recoverInterruptedRuns()).toBe(0)
    expect(calls.reported).toEqual([])
  })
})

describe('reportClaimStatus', () => {
  beforeEach(() => {
    calls.reported = []
  })

  // Three per claim, against forty for a twenty-minute run under the server's
  // 30-second heartbeat. That reduction is the reason this app exists.
  it('sends one call per transition and nothing in between', async () => {
    await reportClaimStatus('a', 'Running')
    await reportClaimStatus('a', 'Success', { ticketNumber: 'TK-1' })

    expect(calls.reported.map(c => c.body.status)).toEqual(['Running', 'Success'])
    expect(calls.reported[1]?.body.ticketNumber).toBe('TK-1')
  })

  it('omits optional fields rather than sending empties', async () => {
    await reportClaimStatus('a', 'Running')

    expect(calls.reported[0]?.body).not.toHaveProperty('ticketNumber')
    expect(calls.reported[0]?.body).not.toHaveProperty('error')
  })
})

/**
 * The desktop signs in on the operator's own connection.
 *
 * A claim that ran without `useDirectConnection()` took the Bright Data path
 * and died on `Cannot find module 'proxy-chain'` — a server-only package. The
 * machine is already on a residential IP, which is the only thing that proxy
 * exists to borrow, so declaring the process direct removes both the relay and
 * the dependency.
 */
describe('direct connection', () => {
  // Loaded through CommonJS `require`, the way the core loads itself. An ESM
  // import gives vitest a separate module instance, so the flag set on one copy
  // would not be the copy proxyConfig reads — the test would pass or fail for
  // reasons unrelated to the behaviour.
  it('turns the Myntra proxy off, so proxy-chain is never required', () => {
    const load = createRequire(import.meta.url)
    const route = load('@trackvid/automation-core/common/networkRoute') as {
      useDirectConnection: (why: string) => void
      useProxiedConnection: () => void
      isDirectConnection: () => boolean
    }
    const proxy = load('@trackvid/automation-core/platforms/myntra/common/proxyConfig') as {
      isProxyEnabled: () => boolean
    }

    route.useProxiedConnection()
    expect(proxy.isProxyEnabled()).toBe(true)

    route.useDirectConnection('desktop app')
    expect(proxy.isProxyEnabled()).toBe(false)
    expect(route.isDirectConnection()).toBe(true)
  })
})
