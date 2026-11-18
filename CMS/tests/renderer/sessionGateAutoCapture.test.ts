import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The pre-flight before Create Ticket, Check TAT, Refill… — with
 * AUTO_SESSION_CAPTURE_ON_RUNNIG_PROCESS=true, an expired login on an
 * auto-login platform is re-captured and the action carries on, with no dialog.
 *
 * React is reduced to plain values: the hook's logic is what is under test.
 */

interface Account {
  platform: string
  username: string
  credentialId: string
  state: string
  optional: boolean
}

interface State {
  flag: boolean
  autoLogin: Record<string, boolean>
  staleBefore: Account[]
  staleAfter: Account[]
  healthReads: number
  captured: { platform: string; username: string; unattended: boolean }[]
  captureFails: Set<string>
  gate: unknown
  toasts: string[]
}

const state = vi.hoisted(
  (): State => ({
    flag: true,
    autoLogin: {},
    staleBefore: [],
    staleAfter: [],
    healthReads: 0,
    captured: [],
    captureFails: new Set(),
    gate: null,
    toasts: []
  })
)

vi.mock('react', () => ({
  useCallback: <T,>(fn: T) => fn,
  useState: <T,>(initial: T) => [
    initial,
    (next: unknown) => {
      state.gate = next
    }
  ]
}))
vi.mock('@renderer/utils/sessionCapture', () => ({ autoCaptureOnRunningProcess: () => state.flag }))
vi.mock('@renderer/hooks/useToast', () => ({
  useToast: () => ({
    info: (m: string) => state.toasts.push(`info: ${m}`),
    success: (m: string) => state.toasts.push(`success: ${m}`),
    error: (m: string) => state.toasts.push(`error: ${m}`)
  })
}))
vi.mock('@renderer/services/claimQueue.service', () => ({
  checkClaimSessions: () => Promise.resolve({ success: true, data: [] })
}))
vi.mock('@renderer/services/platformSession.service', () => ({
  sessionHealth: () => {
    state.healthReads += 1

    return Promise.resolve({
      success: true,
      data: Object.entries(state.autoLogin).map(([platform, autoLogin]) => ({
        platform,
        autoLogin,
        credentials: []
      }))
    })
  },
  recaptureSessions: (
    targets: { platform: string; username: string }[],
    options: { unattended?: boolean; onResult?: (target: unknown, response: unknown) => void }
  ) => {
    for (const target of targets) {
      state.captured.push({
        platform: target.platform,
        username: target.username,
        unattended: options.unattended === true
      })
      const failed = state.captureFails.has(target.platform)
      options.onResult?.(
        target,
        failed ? { success: false, error: { message: 'password refused' } } : { success: true, data: {} }
      )
    }

    return Promise.resolve({ failed: 0 })
  }
}))
vi.mock('@shared/utils/sessionPreflight', () => ({
  // First read: the expired accounts. After a capture: whatever is still stale.
  inactiveAccounts: (accounts: { username: string }[]) =>
    (state.healthReads <= 1 ? state.staleBefore : state.staleAfter).filter(stale =>
      accounts.some(account => account.username === stale.username)
    )
}))

const { useSessionGate } = await import('@renderer/hooks/useSessionGate')

const DELHIVERY: Account = {
  platform: 'delhivery',
  username: 'ara.ct@tigc.in',
  credentialId: 'c1',
  state: 'expired',
  optional: false
}
const MYNTRA: Account = {
  platform: 'myntra',
  username: 'listing@mozafia.com',
  credentialId: 'c2',
  state: 'expired',
  optional: false
}

const createTicket = (accounts: Account[]) =>
  useSessionGate().ensureLiveSessions({ accounts }, 'Create Ticket', { directApiCall: false })

beforeEach(() => {
  state.flag = true
  state.autoLogin = { delhivery: true, myntra: false }
  state.staleBefore = []
  state.staleAfter = []
  state.healthReads = 0
  state.captured = []
  state.captureFails = new Set()
  state.gate = null
  state.toasts = []
})

describe('with the flag on', () => {
  it('re-captures an expired auto-login account unattended and carries on, with no dialog', async () => {
    state.staleBefore = [DELHIVERY]

    expect(await createTicket([DELHIVERY])).toBe(true)
    expect(state.captured).toEqual([{ platform: 'delhivery', username: DELHIVERY.username, unattended: true }])
    expect(state.gate).toBeNull()
  })

  it('still opens the dialog for a platform whose auto-login is off', async () => {
    state.staleBefore = [MYNTRA]

    expect(await createTicket([MYNTRA])).toBe(false)
    expect(state.captured).toEqual([])
    expect(state.gate).toMatchObject({ accounts: [expect.objectContaining({ username: MYNTRA.username })] })
  })

  it('fixes what it can and asks only about the rest', async () => {
    state.staleBefore = [DELHIVERY, MYNTRA]

    expect(await createTicket([DELHIVERY, MYNTRA])).toBe(false)
    expect(state.captured.map(capture => capture.platform)).toEqual(['delhivery'])
    expect((state.gate as { accounts: Account[] }).accounts.map(account => account.username)).toEqual([
      MYNTRA.username
    ])
  })

  it('opens the dialog when the re-capture fails', async () => {
    state.staleBefore = [DELHIVERY]
    state.captureFails.add('delhivery')

    expect(await createTicket([DELHIVERY])).toBe(false)
    expect(state.gate).not.toBeNull()
  })

  it("trusts the stored session, not the capture's own word", async () => {
    state.staleBefore = [DELHIVERY]
    state.staleAfter = [DELHIVERY]

    expect(await createTicket([DELHIVERY])).toBe(false)
  })
})

describe('with the flag off', () => {
  it('shows the dialog as it always has', async () => {
    state.flag = false
    state.staleBefore = [DELHIVERY]

    expect(await createTicket([DELHIVERY])).toBe(false)
    expect(state.captured).toEqual([])
  })
})
