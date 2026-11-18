import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SKIPPED_SESSION_EXPIRED } from '@shared/constants/claims'

/**
 * Filing a claim when the saved login has expired.
 *
 * It used to fail with "the saved login is expired and this run does not sign
 * in — HTTP 401", whatever the company had set. Where
 * `settings.isAutoLoginOnActiveSession.<platform>` is ON, the claim run now
 * re-captures the session by script and files; where it is OFF, nothing
 * changes — the claim is passed over (or refused) and a person signs in.
 *
 * The gate itself (signInPolicy) is pinned at the end: the permission is per
 * platform, and Refill Data inside a batch is still refused everywhere.
 */

const calls = vi.hoisted(() => ({
  autoLogin: new Set<string>(),
  blocked: [] as { platform: string; username: string; detail: string }[],
  renewals: [] as { platform: string; username: string; mayRenew: boolean }[],
  renewSucceeds: true,
  skipped: [] as { cmsId: string; reason: string }[]
}))

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
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => null, getSession: () => null }))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () => Promise.resolve([]),
  recordDispatch: vi.fn(),
  setStatus: vi.fn()
}))
vi.mock('@main/services/automationRouting.service', () => ({
  claimRoutingSnapshot: vi.fn(),
  autoLoginEnabled: (platform: string) => Promise.resolve(calls.autoLogin.has(platform.toLowerCase())),
  runsHere: vi.fn()
}))
vi.mock('@main/automations/registry', () => ({ CLAIM_RUNNERS: {}, resolveClaimRunner: vi.fn() }))
vi.mock('@main/services/claimSessionGuard', () => ({
  inactiveAccounts: () => Promise.resolve(calls.blocked),
  sessionVerdicts: () => Promise.resolve(calls.blocked),
  accountKey: (platform: string, username: string) =>
    `${platform.trim().toLowerCase()}:${username.trim().toLowerCase()}`,
  describeBlocked: () => 'Nothing was filed'
}))
vi.mock('@main/services/claimSession.service', async () => {
  const { signInAllowed } = await import('@main/services/signInPolicy')

  return {
    // Records whether the batch had permission for this platform at the moment
    // it asked — which is the property under test.
    renewForClaim: (platform: string, username: string) => {
      calls.renewals.push({ platform, username, mayRenew: signInAllowed(platform) })

      return Promise.resolve(calls.renewSucceeds ? { jar: [] } : null)
    }
  }
})
vi.mock('@main/automations/common/coreLoader', () => ({ loadCore: vi.fn() }))
vi.mock('@main/automations/common/prepareCore', () => ({
  prepareCoreWithBrowser: vi.fn(),
  prepareCoreProcess: vi.fn()
}))
vi.mock('@main/services/claimLiveness.service', () => ({
  beginRun: vi.fn(),
  endRun: vi.fn(),
  reportClaimSkipped: (cmsId: string, reason: string) => {
    calls.skipped.push({ cmsId, reason })

    return Promise.resolve()
  }
}))
vi.mock('@main/automations/common/processLog', () => ({
  processName: () => 'claim',
  withProcessLogResult: <T>(_name: string, run: () => Promise<T>): Promise<T> => run()
}))

const { processClaims } = await import('@main/services/claimProcessor.service')
const { signInAllowed, withoutSignIn, withSignInFor } = await import('@main/services/signInPolicy')

const DELHIVERY = { platform: 'Delhivery', username: 'ara.ct@tigc.in', detail: 'HTTP 401' }
const MYNTRA = { platform: 'Myntra', username: 'listing@mozafia.com', detail: 'the session was refused' }

beforeEach(() => {
  calls.autoLogin = new Set()
  calls.blocked = []
  calls.renewals = []
  calls.renewSucceeds = true
  calls.skipped = []
})

describe('a scheduled claim run meeting an expired login', () => {
  it('re-captures it by script when auto-login is on, and files instead of passing over', async () => {
    calls.autoLogin.add('delhivery')
    calls.blocked = [DELHIVERY]

    const result = await processClaims(
      [{ cmsId: 'a', platform: 'Delhivery', username: DELHIVERY.username, awbNumber: 'AWB-A' }],
      { onDeadSession: 'skip' }
    )

    expect(calls.renewals).toEqual([{ platform: 'Delhivery', username: DELHIVERY.username, mayRenew: true }])
    expect(calls.skipped).toEqual([])
    expect(result.success && result.data.skipped).toEqual([])
  })

  it('still passes over an account whose re-capture failed, saying so', async () => {
    calls.autoLogin.add('delhivery')
    calls.blocked = [DELHIVERY]
    calls.renewSucceeds = false

    const result = await processClaims(
      [{ cmsId: 'a', platform: 'Delhivery', username: DELHIVERY.username, awbNumber: 'AWB-A' }],
      { onDeadSession: 'skip' }
    )

    expect(calls.renewals).toHaveLength(1)
    expect(calls.skipped).toEqual([{ cmsId: 'a', reason: SKIPPED_SESSION_EXPIRED }])
    expect(result.success && result.data.skipped).toHaveLength(1)
  })

  it('does not sign in where auto-login is off — a person does that', async () => {
    calls.autoLogin.add('delhivery')
    calls.blocked = [MYNTRA]

    await processClaims(
      [{ cmsId: 'm', platform: 'Myntra', username: MYNTRA.username, awbNumber: 'AWB-M' }],
      { onDeadSession: 'skip' }
    )

    expect(calls.renewals).toEqual([])
    expect(calls.skipped).toEqual([{ cmsId: 'm', reason: SKIPPED_SESSION_EXPIRED }])
  })

  it('asks the company setting once per platform, and only for the batch’s own platforms', async () => {
    calls.autoLogin.add('delhivery')
    calls.blocked = [DELHIVERY, MYNTRA]

    await processClaims(
      [
        { cmsId: 'a', platform: 'Delhivery', username: DELHIVERY.username, awbNumber: 'AWB-A' },
        { cmsId: 'm', platform: 'Myntra', username: MYNTRA.username, awbNumber: 'AWB-M' }
      ],
      { onDeadSession: 'skip' }
    )

    // Delhivery renewed; Myntra, with auto-login off, passed over.
    expect(calls.renewals.map(renewal => renewal.platform)).toEqual(['Delhivery'])
    expect(calls.skipped).toEqual([{ cmsId: 'm', reason: SKIPPED_SESSION_EXPIRED }])
  })

  it('gives the permission back when the batch ends', async () => {
    calls.autoLogin.add('delhivery')

    await processClaims([{ cmsId: 'a', platform: 'Delhivery', username: DELHIVERY.username, awbNumber: 'AWB-A' }])

    expect(signInAllowed('Delhivery')).toBe(false)
  })
})

describe('the per-platform sign-in permission', () => {
  it('permits the named platforms only, however they are spelled', async () => {
    await withSignInFor(['Tata CliQ', 'Delhivery'], () => {
      expect(signInAllowed('tatacliq')).toBe(true)
      expect(signInAllowed('DELHIVERY')).toBe(true)
      expect(signInAllowed('Myntra')).toBe(false)
      // A gate that names no platform is not opened by a per-platform permission.
      expect(signInAllowed()).toBe(false)

      return Promise.resolve()
    })
  })

  it('is withdrawn inside withoutSignIn — Refill Data never signs in, even mid-batch', async () => {
    await withSignInFor(['Delhivery'], async () => {
      await withoutSignIn(() => {
        expect(signInAllowed('Delhivery')).toBe(false)

        return Promise.resolve()
      })

      // And restored after it.
      expect(signInAllowed('Delhivery')).toBe(true)
    })
  })
})
