import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What each pass actually ASKS FOR, and on whose behalf.
 *
 * `refillTwoPasses` pins the rules against plain values. This pins the WIRING —
 * that the task hands the right rows, the right fields and the right budget
 * flag to the sweep. Both are needed: a correct rule passed to nobody changes
 * nothing, and it fails silently, because a run with the wrong fields still
 * reports a tidy "0 filled".
 */

interface PassEvent {
  running: boolean
  phase: string | null
  platforms: { platform: string; state: string; checked: number; changed: number; skipped: number }[]
}

const calls = vi.hoisted(() => ({
  passEvents: [] as PassEvent[],
  refills: [] as { platform: string; fields: string[]; countsAttempt: unknown; rows: number }[],
  pending: [] as Record<string, unknown>[],
  awaiting: [] as Record<string, unknown>[]
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/trackvid-test' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string, payload: unknown) => {
    if (channel === 'claim-refill:pass') calls.passEvents.push(payload as PassEvent)
  }
}))
vi.mock('@main/services/cronLog.store', () => ({ cronLog: vi.fn() }))
vi.mock('@main/services/pendingClaims.service', () => ({
  pendingClaims: () => Promise.resolve(calls.pending),
  // The sweep reports what it left behind as well as what it carries — see
  // StatusSweep. Nothing is up to date in these tests, so every row is asked
  // about, which is what each case here is actually about.
  claimsAwaitingStatus: () => Promise.resolve({ rows: calls.awaiting, upToDate: new Map() })
}))
// Every platform has a live login, so the session gate is not what is under
// test here.
vi.mock('@main/services/platformSession.service', () => ({
  // `null` means the health question could not be asked, which switches the
  // session gate off entirely — it is not what is under test here.
  sessionHealth: () => Promise.resolve({ success: false, error: { message: 'offline' } }),
  verifySavedSessions: () => Promise.resolve([]),
  captureSession: () => Promise.resolve({ success: true, data: {} }),
  announceSessionCapturing: () => undefined
}))
vi.mock('@main/services/cmsList.service', () => ({
  listCms: () => Promise.resolve({ success: true, data: { rows: [] } })
}))
vi.mock('@main/services/claimProcessor.service', () => ({
  processClaims: () => Promise.resolve({ success: true, data: {} })
}))
vi.mock('@main/services/masterBackup.service', () => ({
  runDailyBackup: () => Promise.resolve({ success: true, data: {} })
}))
vi.mock('@main/services/refill.service', () => ({
  runRefill: (input: {
    platform: string
    fields: string[]
    countsAttempt?: unknown
    claims: unknown[]
  }) => {
    calls.refills.push({
      platform: input.platform,
      fields: input.fields,
      countsAttempt: input.countsAttempt,
      rows: input.claims.length
    })

    return Promise.resolve({
      success: true,
      data: { filled: 1, untouched: 0, notFound: 0, failed: 0 }
    })
  }
}))

const { runRefillPhase } = await import('@main/services/automationTasks')

/** A claim row, as the list hands one over. */
const claim = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'c1',
  platform: 'Meesho',
  returnAwb: 'AWB1',
  status: 'Pending',
  refillAttempts: 0,
  ...over
})

beforeEach(() => {
  calls.refills.length = 0
  calls.passEvents.length = 0
  calls.pending = []
  calls.awaiting = []
})

describe('the blanks pass', () => {
  it('asks for the gaps and never for the claim status', async () => {
    calls.pending = [claim()]

    await runRefillPhase('blanks')

    expect(calls.refills).toHaveLength(1)
    expect(calls.refills[0]?.fields).toEqual(['accountMapping', 'subOrderNumber'])
    expect(calls.refills[0]?.fields).not.toContain('statusChange')
  })

  it('spends the row budget', async () => {
    /*
     * Three fruitless asks about an AWB means the number is wrong, and a
     * fourth answers nothing. That cap is this pass's and belongs to it.
     */
    calls.pending = [claim()]

    await runRefillPhase('blanks')

    expect(calls.refills[0]?.countsAttempt).toBe(true)
  })

  it('does not sweep a platform whose only field is the status', async () => {
    // Nykaa has a claim status and nothing else; sweeping it here would sign
    // in to ask questions this pass has no fields for.
    calls.pending = [claim({ platform: 'Nykaa' })]

    await runRefillPhase('blanks')

    expect(calls.refills).toHaveLength(0)
  })
})

describe('the claim status pass', () => {
  it('asks only for the status', async () => {
    calls.awaiting = [claim({ status: 'In Review' })]

    await runRefillPhase('status')

    expect(calls.refills).toHaveLength(1)
    expect(calls.refills[0]?.fields).toEqual(['statusChange'])
  })

  it('does NOT spend the row budget', async () => {
    /*
     * THE ONE THAT WOULD BE SILENT. "Still In Review" is the answer, not a
     * failed ask. Counting it would stop tracking a ticket after three nights
     * — the one thing this pass exists to do — and nothing would say so: the
     * rows would simply stop appearing, looking like a quiet week.
     */
    calls.awaiting = [claim({ status: 'In Review' })]

    await runRefillPhase('status')

    expect(calls.refills[0]?.countsAttempt).toBe(false)
  })

  it('carries a row that has already spent its blanks budget', async () => {
    // The budget is the blanks pass's. A row that used it up is still a filed
    // ticket whose status can move.
    calls.awaiting = [claim({ status: 'In Review', refillAttempts: 99 })]

    await runRefillPhase('status')

    expect(calls.refills).toHaveLength(1)
  })

  it('does not sweep a platform that reports no status', async () => {
    // Tata CliQ's QC row carries a ticket number but nothing about where it
    // stands; Xbees has no status field at all.
    calls.awaiting = [claim({ platform: 'Tata CliQ', status: 'In Review' })]

    await runRefillPhase('status')

    expect(calls.refills).toHaveLength(0)
  })

  it('reads from the status list, not the Pending one', async () => {
    // The two passes must not share a source: Pending rows have no ticket to
    // report on, which is how the status came to be asked of rows that could
    // never answer it.
    calls.pending = [claim({ id: 'pending-row' })]
    calls.awaiting = []

    await runRefillPhase('status')

    expect(calls.refills).toHaveLength(0)
  })
})

describe('what the card is told while a pass runs', () => {
  it('lists every marketplace before the first one starts', async () => {
    /*
     * The list has to exist UP FRONT. A card that only learns about a platform
     * when the run reaches it can show one chip working and nothing about the
     * six waiting behind it — so a sweep through seven marketplaces looks the
     * same as one stuck on the first.
     */
    calls.pending = [claim({ platform: 'Meesho' }), claim({ id: 'c2', platform: 'Snapdeal' })]

    await runRefillPhase('blanks')

    const first = calls.passEvents[0]

    expect(first?.platforms.map(entry => entry.platform).sort()).toEqual(['meesho', 'snapdeal'])
    expect(first?.platforms.every(entry => entry.state === 'waiting')).toBe(true)
  })

  it('says which of the two passes is running', async () => {
    // "Refill Data is running" does not say which question it is asking, and
    // the two ask different things of different rows.
    calls.awaiting = [claim({ status: 'In Review' })]

    await runRefillPhase('status')

    expect(calls.passEvents[0]?.phase).toBe('status')
  })

  it('marks the platform it is on, and what it finished with', async () => {
    calls.pending = [claim()]

    await runRefillPhase('blanks')

    expect(calls.passEvents.some(event =>
      event.platforms.some(entry => entry.platform === 'meesho' && entry.state === 'running')
    )).toBe(true)

    const done = calls.passEvents
      .flatMap(event => event.platforms)
      .filter(entry => entry.platform === 'meesho' && entry.state === 'done')
      .pop()

    // One row, filled: one checked, one changed.
    expect(done?.checked).toBe(1)
    expect(done?.changed).toBe(1)
  })

  it('says the run is over, so no chip is left spinning', async () => {
    calls.pending = [claim()]

    await runRefillPhase('blanks')

    expect(calls.passEvents.at(-1)?.running).toBe(false)
  })

  it('marks a platform it passed over, with the reason', async () => {
    // Skipped is not the same as done with nothing, and the chip says which.
    calls.pending = [claim({ returnAwb: '' })]

    await runRefillPhase('blanks')

    const skipped = calls.passEvents
      .flatMap(event => event.platforms)
      .filter(entry => entry.state === 'skipped')
      .pop()

    expect(skipped?.platform).toBe('meesho')
  })
})
