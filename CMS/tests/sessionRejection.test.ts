import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PlatformCredentials, SessionSummary } from '@shared/types/platformSession'
import { HEALTH_LABEL, healthOf } from '@shared/utils/sessionHealth'
import { sessionUpdateTargets } from '@shared/utils/sessionTargets'

/**
 * A session the marketplace has refused, and the two screens that used to
 * disagree about it.
 *
 * THE BUG. `healthOf` compared `expiresAt` to the clock — a guess made when the
 * session was captured — so a Snapdeal jar with three days left read "Saved" on
 * the Sessions page, in the banner and on the Session update card. A claim, on
 * the other hand, asked Snapdeal, which refused it. The 02:00 Session update
 * reported nothing to do and the 04:00 Auto claim skipped the account for
 * having no usable session, on the same evening, about the same jar.
 *
 * The probe already knew and threw the answer away. What is pinned here is that
 * it no longer does: a rejection makes the account read as needing work
 * everywhere the shared rules are used.
 */

const state = vi.hoisted(() => ({ directory: '' }))

/** What the store told the rest of the app. */
const sent = vi.hoisted(() => ({ channels: [] as string[] }))

vi.mock('@main/database', () => ({ dataDirectory: () => state.directory }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/ipc/broadcast', () => ({
  broadcast: (channel: string) => {
    sent.channels.push(channel)
  }
}))

const store = await import('@main/services/sessionRejection.store')

const NOW = Date.parse('2026-09-19T12:00:00.000Z')

/*
 * THE CLOCK IS FROZEN AT `NOW`, because the fixtures below are fixed dates.
 *
 * `sessionUpdateTargets` takes no clock and reads `Date.now()` itself, so those
 * dates were only "three days out" until the real clock caught up with them —
 * and on the morning of the expiry date this file began failing on its own,
 * having tested nothing new. Only Date is faked: the timers are left alone so
 * the filesystem work in `beforeAll` still runs.
 */
vi.useFakeTimers({ toFake: ['Date'], now: NOW })

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  savedAt: '2026-09-19T09:00:00.000Z',
  // Three days out: nothing about the dates says this needs touching.
  expiresAt: '2026-09-22T09:00:00.000Z',
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a'],
  rejectedAt: null,
  rejectedDetail: null,
  ...overrides
})

const bucket = (over: Partial<SessionCredential> = {}): PlatformCredentials[] => [
  {
    platform: 'snapdeal',
    reported: true,
    autoLogin: true,
    credentials: [
      {
        credentialId: 'c1',
        username: 'Sb8de8',
        accountType: '',
        vendorCode: '',
        isVerified: true,
        visible: true,
        masterDataSync: null,
        isOtpBased: null,
        session: session(),
        pobCount: 0,
        pobSyncedAt: null,
        slaveCount: 0,
        slavesSyncedAt: null,
        domesticCount: 0,
        domesticsSyncedAt: null,
        ...over
      }
    ]
  }
]

type SessionCredential = PlatformCredentials['credentials'][number]

beforeAll(async () => {
  state.directory = await mkdtemp(join(tmpdir(), 'trackvid-rejection-'))
  store.initialiseSessionRejections()
})

afterAll(async () => {
  await rm(state.directory, { recursive: true, force: true })
})

describe('healthOf', () => {
  it('reads a live expiry date as fine, which is how the bug hid', () => {
    expect(healthOf(session(), NOW)).toBe('active')
  })

  it('reports a refused session as rejected, whatever its expiry says', () => {
    expect(
      healthOf(session({ rejectedAt: '2026-09-19T11:00:00.000Z' }), NOW)
    ).toBe('rejected')
  })

  /**
   * "Expired" would send somebody looking at a date that is three days away and
   * finding nothing wrong with it. The marketplace refused it; that is the
   * thing to act on.
   */
  it('does not call it expired, because it is not', () => {
    expect(HEALTH_LABEL.rejected).toBe('Rejected')
    expect(HEALTH_LABEL.rejected).not.toBe(HEALTH_LABEL.expired)
  })
})

describe('sessionUpdateTargets', () => {
  const known = (): boolean => true

  it('leaves a healthy-looking session alone', () => {
    expect(sessionUpdateTargets(bucket(), known)).toEqual([])
  })

  /**
   * The heart of it. This is the list the Session update card draws and the
   * 02:00 task works through — so a rejected session missing from it is
   * precisely "the card said everything was updated".
   */
  it('includes a session the marketplace refused', () => {
    const targets = sessionUpdateTargets(
      bucket({ session: session({ rejectedAt: '2026-09-19T11:00:00.000Z' }) }),
      known
    )

    expect(targets).toEqual([
      expect.objectContaining({ platform: 'snapdeal', username: 'Sb8de8', state: 'rejected' })
    ])
  })
})

describe('the rejection store', () => {
  it('remembers a refusal and hands it back under a normalised key', async () => {
    await store.rememberSessionRejected('Snapdeal', '  Sb8De8 ', 'the marketplace rejected it')

    const held = await store.sessionRejections()

    expect(held.get(store.sessionRejectionKey('snapdeal', 'sb8de8'))).toEqual(
      expect.objectContaining({
        platform: 'snapdeal',
        username: 'Sb8De8',
        detail: 'the marketplace rejected it'
      })
    )
  })

  /**
   * Without this a rejection outlives the session it was about, and the account
   * is permanently red with no way to clear it — the same class of bug in the
   * other direction.
   */
  it('forgets it when a session is captured', async () => {
    await store.rememberSessionRejected('Snapdeal', 'Sb8de8', 'refused')
    await store.forgetSessionRejected('snapdeal', 'SB8DE8')

    expect((await store.sessionRejections()).size).toBe(0)
  })

  it('keeps one record per account rather than a pile of them', async () => {
    await store.rememberSessionRejected('Snapdeal', 'Sb8de8', 'first')
    await store.rememberSessionRejected('Snapdeal', 'Sb8de8', 'second')

    const held = await store.sessionRejections()

    expect(held.size).toBe(1)
    expect(held.get(store.sessionRejectionKey('snapdeal', 'sb8de8'))?.detail).toBe('second')

    await store.forgetSessionRejected('snapdeal', 'Sb8de8')
  })

  it('ignores an account with no username rather than storing an orphan', async () => {
    await store.rememberSessionRejected('Snapdeal', '   ', 'refused')

    expect((await store.sessionRejections()).size).toBe(0)
  })
})

/**
 * The announcement is debounced on a REAL timer: this file fakes Date only (see
 * the note above), so advancing fake timers would not fire it. A real wait of
 * one second is the honest way to observe a one-second debounce.
 */
const announced = (): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, 1000)
  })

describe('telling the screens a verdict landed', () => {
  /**
   * THE OTHER HALF OF THE SAME BUG. The verdict was being recorded correctly
   * and nothing told the app, so the Login page — which re-reads when it mounts
   * and when a capture lands — kept showing "Saved" for an account the
   * marketplace had refused during a claim run, while Settings → Login update,
   * read a moment later, showed "Rejected". Two screens, one source, two
   * answers, and the one an operator trusts is whichever they opened last.
   */
  it('announces a rejection, so every screen re-reads', async () => {
    sent.channels = []

    await store.rememberSessionRejected('meesho', 'ops@example.com', 'the portal refused it')
    await announced()

    expect(sent.channels).toEqual(['platform-session:changed'])
  })

  it('announces a clearance, which is the same news the other way round', async () => {
    sent.channels = []

    await store.forgetSessionRejected('meesho', 'ops@example.com')
    await announced()

    expect(sent.channels).toEqual(['platform-session:changed'])
  })

  it('says nothing when there was nothing to clear', async () => {
    // Every capture calls this, and most accounts have never been rejected. A
    // broadcast per capture would have every screen re-read for no news.
    sent.channels = []

    await store.forgetSessionRejected('meesho', 'never-rejected@example.com')
    await announced()

    expect(sent.channels).toEqual([])
  })

  it('collapses a sweep of verdicts into one announcement', async () => {
    /*
     * A nightly probe rejects several accounts in a row, and each screen
     * answers this by re-reading the company's credentials over HTTP. One burst
     * is one re-read — which is all the operator experiences anyway.
     */
    sent.channels = []

    await store.rememberSessionRejected('meesho', 'a@example.com', 'refused')
    await store.rememberSessionRejected('snapdeal', 'b@example.com', 'refused')
    await store.rememberSessionRejected('flipkart', 'c@example.com', 'refused')
    await announced()

    expect(sent.channels).toEqual(['platform-session:changed'])
  })
})
