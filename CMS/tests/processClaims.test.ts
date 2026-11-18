import { describe, expect, it, vi } from 'vitest'
import { SKIPPED_SESSION_EXPIRED } from '@shared/constants/claims'

/**
 * "Create Ticket" over a selection.
 *
 * This loop used to live in the renderer, calling the single-claim entry point
 * once per row, and that had two consequences nobody could see from the code:
 * it ran OUTSIDE `withAutomationLock`, so pressing Create Ticket during a bulk
 * run opened a second marketplace browser; and each call found no open lease
 * and launched its own Chrome, so twenty rows meant twenty launches.
 *
 * Both are properties of the batch, not of a claim, which is why the batch had
 * to move into the main process. These tests pin that it does hold both.
 */

const calls = vi.hoisted(() => ({
  lock: [] as string[],
  /** What the session pre-flight answers with. Empty means every account is fine. */
  blocked: [] as { platform: string; username: string; detail: string }[],
  /** Set when the batch asked to RENEW a dead session — it must not, in skip mode. */
  renewalsAsked: 0,
  /** Claims reported as passed over, with the reason written to the row. */
  skipped: [] as { cmsId: string; reason: string }[],
  leaseOpened: 0,
  leaseClosed: 0,
  progress: [] as {
    done: number
    total: number
    succeeded: number
    failed: number
    failures: { awbNumber: string; error: string }[]
    running: boolean
    cmsId: string
    platforms: {
      platform: string
      total: number
      done: number
      succeeded: number
      ticketless: number
      failed: number
    }[]
    phase?: string
  }[]
}))

vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (_channel: string, payload: unknown) => {
    calls.progress.push(payload as (typeof calls.progress)[number])
  }
}))
vi.mock('@main/services/automationLock', () => ({
  withAutomationLock: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    calls.lock.push(name)

    return work()
  },
  // Nothing else is running in this harness, so the batch never reports itself
  // as queued — the case that matters here is the one where it starts.
  isAutomationBusy: () => false,
  automationHolder: () => null
}))
vi.mock('@main/services/browserLease.service', () => ({
  openClaimLease: () => {
    calls.leaseOpened += 1
  },
  closeClaimLease: () => {
    calls.leaseClosed += 1

    return Promise.resolve()
  }
}))

// Every claim stops at the token check, so nothing here opens a browser — the
// point is the wiring around the loop, not the claim itself.
vi.mock('@main/services/session.store', () => ({
  getAccessToken: () => null,
  getSession: () => null
}))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/claimQueue.service', () => ({
  listClaims: () => Promise.resolve([]),
  recordDispatch: vi.fn(),
  setStatus: vi.fn()
}))
vi.mock('@main/services/automationRouting.service', () => ({
  claimRoutingSnapshot: vi.fn(),
  // Auto-login off: these cases are not about re-capturing a session.
  autoLoginEnabled: () => Promise.resolve(false),
  runsHere: vi.fn()
}))
vi.mock('@main/automations/registry', () => ({ CLAIM_RUNNERS: {}, resolveClaimRunner: vi.fn() }))
// The session pre-flight has its own tests; here it only needs to answer, so
// these cases stay about locking, leasing and progress.
vi.mock('@main/services/claimSessionGuard', () => ({
  // The renewing check. Counted rather than merely stubbed: the whole point of
  // skip mode is that it never reaches this, because renewing means a sign-in
  // window at 04:00 with nobody there to answer it.
  inactiveAccounts: () => {
    calls.renewalsAsked += 1

    return Promise.resolve(calls.blocked)
  },
  // The read-only verdict — what skip mode uses instead.
  sessionVerdicts: () => Promise.resolve(calls.blocked),
  accountKey: (platform: string, username: string) =>
    `${platform.trim().toLowerCase()}:${username.trim().toLowerCase()}`,
  describeBlocked: (blocked: { platform: string; username: string }[]) =>
    `Nothing was filed: ${blocked.map(b => `${b.platform} (${b.username})`).join(', ')} has no active session.`
}))
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

const reset = (): void => {
  calls.lock = []
  calls.leaseOpened = 0
  calls.leaseClosed = 0
  calls.progress = []
  calls.blocked = []
  calls.renewalsAsked = 0
  calls.skipped = []
}

describe('processClaims', () => {
  it('holds the automation lock and ONE browser lease for the whole batch', async () => {
    reset()

    const result = await processClaims([
      { cmsId: 'a', platform: 'ajio', awbNumber: 'AWB-A' },
      { cmsId: 'b', platform: 'ajio', awbNumber: 'AWB-B' },
      { cmsId: 'c', platform: 'ajio', awbNumber: 'AWB-C' }
    ])

    // Once, not once per claim — that is the whole point.
    expect(calls.lock).toEqual(['create-ticket'])
    expect(calls.leaseOpened).toBe(1)
    expect(calls.leaseClosed).toBe(1)

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.failed).toBe(3)
  })

  it('says it has started BEFORE checking any session', async () => {
    reset()

    await processClaims([{ cmsId: 'a', awbNumber: 'AWB-A' }])

    // The very first tick, before the pre-flight. That check probes every
    // account and can open a sign-in window that waits five minutes for a
    // person — and while it ran, the batch announced nothing, so the panel was
    // empty and the only visible sign of life was a spinning button.
    expect(calls.progress[0]).toEqual(
      expect.objectContaining({ done: 0, total: 1, running: true, cmsId: '' })
    )
    expect(calls.progress[0]?.phase).toBeTruthy()
  })

  it('announces the claim it is about to file, then a terminal tick', async () => {
    reset()

    await processClaims([
      { cmsId: 'a', awbNumber: 'AWB-A' },
      { cmsId: 'b', awbNumber: 'AWB-B' }
    ])

    // Before each claim, so the panel names what is running rather than what
    // just finished. `done` counts what was ATTEMPTED, successes and failures
    // alike — it used to count only successes, so a batch failing every claim
    // sat at 0/20 and read as stuck rather than as going badly.
    //
    // Offset by one: the opening tick above comes first.
    expect(calls.progress.slice(1, 3)).toEqual([
      expect.objectContaining({ done: 0, total: 2, cmsId: 'a', running: true }),
      expect.objectContaining({ done: 1, total: 2, cmsId: 'b', running: true })
    ])

    // The last one ends it — a panel still showing a running batch is worse
    // than one showing nothing.
    expect(calls.progress.at(-1)).toEqual(expect.objectContaining({ running: false, total: 2 }))
  })

  it('carries the success and failure tally, and which AWBs failed', async () => {
    reset()

    // Every claim fails in this harness, which is the case worth asserting: the
    // panel is judged on being able to say WHICH ones and why, and a run whose
    // totals vanished with it could not answer either.
    await processClaims([
      { cmsId: 'a', awbNumber: 'AWB-A' },
      { cmsId: 'b', awbNumber: 'AWB-B' }
    ])

    const final = calls.progress.at(-1)

    expect(final).toEqual(
      expect.objectContaining({ running: false, done: 2, total: 2, succeeded: 0, failed: 2 })
    )
    expect(final?.failures.map(failure => failure.awbNumber)).toEqual(['AWB-A', 'AWB-B'])
    // The reason travels with the AWB — a bare list of numbers sends the
    // operator back to the log for the only part that says what to do.
    expect(final?.failures.every(failure => failure.error.length > 0)).toBe(true)
  })

  /**
   * The Auto claim row on the Settings page draws a chip per marketplace and
   * turns it green when that marketplace is finished. It can only do that if
   * the batch says which platform each attempt belonged to — the totals alone
   * cannot tell "every Myntra claim filed, Snapdeal not started" from "halfway
   * through both".
   */
  it('breaks the batch down per platform, from the first tick to the last', async () => {
    reset()

    await processClaims([
      { cmsId: 'a', platform: 'Myntra', awbNumber: 'AWB-A' },
      { cmsId: 'b', platform: 'Myntra', awbNumber: 'AWB-B' },
      { cmsId: 'c', platform: 'Snapdeal', awbNumber: 'AWB-C' }
    ])

    // Both marketplaces are present before either has been touched, so a chip
    // can be drawn for the work still to come rather than only for work done.
    expect(calls.progress[0]?.platforms).toEqual(
      expect.arrayContaining([
        { platform: 'Myntra', total: 2, done: 0, succeeded: 0, ticketless: 0, failed: 0, skipped: 0 },
        { platform: 'Snapdeal', total: 1, done: 0, succeeded: 0, ticketless: 0, failed: 0, skipped: 0 }
      ])
    )

    // Every claim fails in this harness, so the tally lands entirely in
    // `failed` — which is the half that must NOT read as a finished platform.
    expect(calls.progress.at(-1)?.platforms).toEqual(
      expect.arrayContaining([
        { platform: 'Myntra', total: 2, done: 2, succeeded: 0, ticketless: 0, failed: 2, skipped: 0 },
        { platform: 'Snapdeal', total: 1, done: 1, succeeded: 0, ticketless: 0, failed: 1, skipped: 0 }
      ])
    )
  })

  it('falls back to the claim id when a failed row has no AWB to name', async () => {
    reset()

    await processClaims([{ cmsId: 'no-awb-claim' }])

    expect(calls.progress.at(-1)?.failures).toEqual([
      expect.objectContaining({ awbNumber: 'no-awb-claim' })
    ])
  })

  /**
   * The nightly run, behind one expired login.
   *
   * `refuse` is right when a person pressed the button: they can re-capture the
   * session and press it again. At 04:00 nobody can, and refusing the whole
   * batch threw away a night's work over one stale account that might not even
   * own most of the claims.
   */
  describe('with onDeadSession: skip', () => {
    it('files the healthy accounts and passes over the dead one', async () => {
      reset()
      calls.blocked = [
        { platform: 'Myntra', username: 'listing@mozafia.com', detail: 'the session was refused' }
      ]

      const result = await processClaims(
        [
          { cmsId: 'a', platform: 'Myntra', username: 'listing@mozafia.com', awbNumber: 'AWB-A' },
          { cmsId: 'b', platform: 'Myntra', username: 'listing@mozafia.com', awbNumber: 'AWB-B' },
          { cmsId: 'c', platform: 'Snapdeal', username: 'sb8de8', awbNumber: 'AWB-C' }
        ],
        { onDeadSession: 'skip' }
      )

      // NOTHING IS RENEWED. A renewal opens a sign-in window, which at 04:00
      // holds the browser and the lock until it times out.
      expect(calls.renewalsAsked).toBe(0)

      // Both Myntra rows carry the reason; the Snapdeal one was never touched.
      expect(calls.skipped).toEqual([
        { cmsId: 'a', reason: SKIPPED_SESSION_EXPIRED },
        { cmsId: 'b', reason: SKIPPED_SESSION_EXPIRED }
      ])

      // The batch still ran — for the account that could work.
      expect(calls.lock).toEqual(['create-ticket'])
      expect(calls.progress.at(-1)).toEqual(
        expect.objectContaining({ running: false, total: 1, skipped: 2 })
      )

      // Myntra is present with nothing to attempt and two passed over, so the
      // Settings chip can say "Myntra — 2 skipped" rather than dropping it.
      expect(calls.progress.at(-1)?.platforms).toEqual(
        expect.arrayContaining([
          { platform: 'Myntra', total: 0, done: 0, succeeded: 0, ticketless: 0, failed: 0, skipped: 2 },
          { platform: 'Snapdeal', total: 1, done: 1, succeeded: 0, ticketless: 0, failed: 1, skipped: 0 }
        ])
      )

      expect(result.success && result.data.skipped).toEqual([
        {
          platform: 'Myntra',
          username: 'listing@mozafia.com',
          claims: 2,
          detail: 'the session was refused'
        }
      ])
    })

    /**
     * Every account dead is a SUCCESS with nothing done, not a failure: the run
     * happened, it looked at the claims, and it correctly filed none of them.
     * Reported as a failure it would burn one of the scheduler's three attempts
     * and bury the reason.
     */
    it('ends cleanly when every account is dead, without opening anything', async () => {
      reset()
      calls.blocked = [
        { platform: 'Myntra', username: 'listing@mozafia.com', detail: 'the session was refused' }
      ]

      const result = await processClaims(
        [{ cmsId: 'a', platform: 'Myntra', username: 'listing@mozafia.com', awbNumber: 'AWB-A' }],
        { onDeadSession: 'skip' }
      )

      expect(calls.lock).toEqual([])
      expect(calls.leaseOpened).toBe(0)
      expect(result.success).toBe(true)
      expect(result.success && result.data).toEqual(
        expect.objectContaining({ done: 0, failed: 0 })
      )
      expect(calls.progress.at(-1)).toEqual(expect.objectContaining({ running: false }))
    })

    it('leaves the default alone — a batch still refuses over a dead session', async () => {
      reset()
      calls.blocked = [
        { platform: 'Myntra', username: 'listing@mozafia.com', detail: 'the session was refused' }
      ]

      const result = await processClaims([
        { cmsId: 'a', platform: 'Myntra', username: 'listing@mozafia.com', awbNumber: 'AWB-A' }
      ])

      expect(calls.renewalsAsked).toBe(1)
      expect(calls.skipped).toEqual([])
      expect(result.success).toBe(false)
    })
  })

  it('does nothing at all for an empty selection', async () => {
    reset()

    const result = await processClaims([])

    expect(calls.lock).toEqual([])
    expect(calls.leaseOpened).toBe(0)
    expect(calls.progress).toEqual([])
    expect(result.success && result.data).toEqual({
      done: 0,
      ticketless: 0,
      failed: 0,
      failures: [],
      skipped: [],
      platforms: []
    })
  })

  it('runs claims for one account together, whatever order they were ticked in', async () => {
    reset()

    // Interleaved on purpose: only one browser is held at a time, so this order
    // run as-is would close and relaunch Chrome on every single row.
    await processClaims([
      { cmsId: '1', platform: 'ajio', username: 'a@x.com' },
      { cmsId: '2', platform: 'ajio', username: 'b@x.com' },
      { cmsId: '3', platform: 'ajio', username: 'a@x.com' },
      { cmsId: '4', platform: 'ajio', username: 'b@x.com' }
    ])

    // `cmsId` is empty on the opening tick and on the terminal one; the ticks
    // that name a claim are the order the claims ran in.
    const order = calls.progress.filter(tick => tick.running && tick.cmsId).map(tick => tick.cmsId)

    expect(order).toEqual(['1', '3', '2', '4'])
  })

  it('keeps the account that came first, first', async () => {
    reset()

    await processClaims([
      { cmsId: '1', platform: 'ajio', username: 'b@x.com' },
      { cmsId: '2', platform: 'ajio', username: 'a@x.com' },
      { cmsId: '3', platform: 'ajio', username: 'b@x.com' }
    ])

    // Stable: an operator who selected top-to-bottom still sees roughly that.
    expect(
      calls.progress.filter(tick => tick.running && tick.cmsId).map(tick => tick.cmsId)
    ).toEqual([
      '1',
      '3',
      '2'
    ])
  })
})

describe('the session pre-flight', () => {
  it('files nothing when an account has no active session', async () => {
    reset()
    calls.blocked.push({
      platform: 'flipkart',
      username: 'seller@x.com',
      detail: 'the marketplace rejected the saved session'
    })

    const result = await processClaims([
      { cmsId: 'a', platform: 'flipkart', username: 'seller@x.com' },
      { cmsId: 'b', platform: 'flipkart', username: 'seller@x.com' }
    ])

    expect(result.success).toBe(false)
    // Refused BEFORE the lock and the browser. A dead session fails every claim
    // it covers one at a time, burning an attempt each, for a reason the
    // operator could have been told before any of it started.
    expect(calls.lock).toEqual([])
    expect(calls.leaseOpened).toBe(0)
    // Announced, then ended. The batch was real from the moment it was pressed
    // — the pre-flight that refused it is itself minutes of work — so silence
    // here left the panel with a run it could never finish or dismiss.
    expect(calls.progress.at(0)).toEqual(expect.objectContaining({ running: true }))
    expect(calls.progress.at(-1)).toEqual(expect.objectContaining({ running: false }))
  })

  it('names the account rather than the count', async () => {
    reset()
    calls.blocked.push({ platform: 'flipkart', username: 'seller@x.com', detail: 'dead' })

    const result = await processClaims([{ cmsId: 'a', platform: 'flipkart', username: 'seller@x.com' }])

    // "A session is not active" sends someone to the Sessions page to work out
    // which one; the name is the whole message.
    expect(result.success === false && result.error.message).toContain('seller@x.com')
  })

  it('refuses the WHOLE batch, not just the affected claims', async () => {
    reset()
    calls.blocked.push({ platform: 'nykaa', username: 'ops@x.com', detail: 'dead' })

    // A selection is a unit of work somebody pressed once. Half of it quietly
    // succeeding is harder to reason about than none of it running.
    const result = await processClaims([
      { cmsId: 'a', platform: 'ajio', username: 'fine@x.com' },
      { cmsId: 'b', platform: 'nykaa', username: 'ops@x.com' }
    ])

    expect(result.success).toBe(false)

    // It used to announce nothing at all here, which left the panel showing a
    // batch that had already been refused — running forever, with no way to
    // dismiss it. The refusal ends the batch, so it has to be said.
    expect(calls.progress.at(-1)).toEqual(
      expect.objectContaining({ running: false, done: 0, succeeded: 0 })
    )
    // And with the reason, since there is no tally worth reporting.
    expect(calls.progress.at(-1)?.phase).toContain('ops@x.com')
  })
})
