import { describe, expect, it, vi } from 'vitest'
import type { PlatformCredentials, SessionSummary } from '@shared/types/platformSession'

/**
 * The Session update run asking the marketplace before it trusts a date.
 *
 * WHAT IT IS FOR. Everything else in the session view judges a jar by
 * `expiresAt` — a guess made at capture time — so one revoked, or invalidated
 * by a login elsewhere, keeps its expiry and reads "Saved". The 02:00 task
 * found nothing to do, and Auto claim at 04:00 passed the account's claims over
 * because the marketplace refused that exact jar.
 *
 * So the task now probes the ones the dates call fine. What has to hold is
 * which verdicts change anything: an explicit refusal, and nothing else. AJIO's
 * probe needs a live page and can only ever answer "cannot tell"; a flat
 * network answers the same for everybody. Re-capturing on those would sign in
 * to every account, every night, over a question nobody answered.
 */

const state = vi.hoisted(() => {
  /** platform:username → what `reusableSession` says about it. */
  const verdicts: Record<string, { reason: string; detail: string }> = {}

  return { verdicts, probed: [] as string[] }
})

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/trackvid-test', getVersion: () => '0.0.0' },
  BrowserWindow: { getAllWindows: () => [] },
  session: { fromPartition: () => ({}) },
  dialog: {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/company.service', () => ({
  credentialFor: () => Promise.resolve(null),
  credentialsFor: () => Promise.resolve([]),
  rememberCompanySession: vi.fn(),
  rememberOtpMode: vi.fn()
}))
vi.mock('@main/services/sessionRejection.store', () => ({
  sessionRejections: () => Promise.resolve(new Map()),
  sessionRejectionKey: (platform: string, username: string) =>
    `${platform}:${username.toLowerCase()}`,
  rememberSessionRejected: vi.fn(),
  forgetSessionRejected: vi.fn()
}))
vi.mock('@main/services/sessionReuse.service', () => ({
  reusableSession: (platform: string, username: string) => {
    state.probed.push(`${platform}:${username}`)

    return Promise.resolve(
      state.verdicts[`${platform}:${username}`] ?? {
        session: null,
        reason: 'reused',
        detail: 'fine'
      }
    )
  }
}))

const { verifySavedSessions } = await import('@main/services/platformSession.service')

const DAY_MS = 24 * 60 * 60 * 1000

const session = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  /*
   * RELATIVE TO NOW, not a date somebody typed.
   *
   * These were fixed timestamps — savedAt three days before expiresAt — and
   * they were true until the clock reached them. On the morning of the expiry
   * date every test here began failing: `healthOf` reads anything within two
   * hours of expiry as `expiring`, so the "healthy" fixture stopped being one
   * and the rows stopped being probed. A fixture that decays into a false
   * failure teaches people to ignore a red suite.
   */
  savedAt: new Date(Date.now() - 3 * DAY_MS).toISOString(),
  // Days out — nothing about the dates asks for a re-capture.
  expiresAt: new Date(Date.now() + 3 * DAY_MS).toISOString(),
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a'],
  rejectedAt: null,
  rejectedDetail: null,
  ...overrides
})

const credential = (
  username: string,
  over: Partial<PlatformCredentials['credentials'][number]> = {}
): PlatformCredentials['credentials'][number] => ({
  credentialId: `c-${username}`,
  username,
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
})

const buckets = (): PlatformCredentials[] => [
  {
    platform: 'snapdeal',
    reported: true,
    autoLogin: true,
    credentials: [credential('Sb8de8'), credential('other@example.com')]
  }
]

const reset = (): void => {
  state.verdicts = {}
  state.probed = []
}

describe('verifySavedSessions', () => {
  it('marks the session the marketplace refuses, and leaves the rest alone', async () => {
    reset()
    state.verdicts['snapdeal:Sb8de8'] = {
      reason: 'dead',
      detail: 'the marketplace rejected the saved session'
    }

    const rows = buckets()

    const verdicts = await verifySavedSessions(rows)

    expect(verdicts.filter(entry => !entry.usable && !entry.unreachable)).toHaveLength(1)

    const [refused, fine] = rows[0]!.credentials

    expect(refused?.session?.rejectedAt).toBeTruthy()
    expect(refused?.session?.rejectedDetail).toBe('the marketplace rejected the saved session')
    expect(fine?.session?.rejectedAt).toBeNull()
  })

  /**
   * AJIO is permanently here — its probe needs a live browser page, so a
   * caller holding only a jar is always told "cannot tell". Treating that as a
   * refusal would re-capture every AJIO account every single night.
   */
  it('changes nothing on a verdict that could not be reached', async () => {
    reset()
    state.verdicts['snapdeal:Sb8de8'] = {
      reason: 'unverifiable',
      detail: 'the saved session could not be verified'
    }

    const rows = buckets()

    const verdicts = await verifySavedSessions(rows)

    // Reported as unreachable, never as refused: "could not ask" is not "no".
    expect(verdicts.filter(entry => !entry.usable && !entry.unreachable)).toHaveLength(0)
    expect(verdicts.find(entry => entry.username === 'Sb8de8')?.unreachable).toBe(true)
    expect(rows[0]?.credentials[0]?.session?.rejectedAt).toBeNull()
  })

  it('asks about a session the dates call expired, because the dates are a guess', async () => {
    /*
     * A REVERSAL, and the reason is what `expiresAt` actually is: not a
     * measurement, but a TTL from a constant applied when the session was
     * captured — and the constant is wrong.
     *
     * This used to skip anything the dates condemned, on the reasoning that
     * asking about a session already due for re-capture buys nothing. It buys
     * the whole answer. A session the wrong constant calls expired is often
     * still accepted, and re-capturing it costs a browser sign-in — on Tata
     * CliQ an emailed one-time code — for a jar that was working.
     *
     * Asking is one request. Guessing is a sign-in.
     */
    reset()

    const rows = buckets()

    rows[0]!.credentials[0]!.session = session({ expiresAt: '2026-01-01T00:00:00.000Z' })

    await verifySavedSessions(rows)

    expect(state.probed).toEqual(['snapdeal:Sb8de8', 'snapdeal:other@example.com'])
  })

  it('reports how long a refused session had lasted', async () => {
    /*
     * The measurement the constant was guessing at, and the only place this
     * app records it. Without it there is no way to tell whether the TTL is
     * nearly right or nowhere near.
     */
    reset()
    state.verdicts['snapdeal:Sb8de8'] = { reason: 'dead', detail: 'refused' }

    const rows = buckets()
    const savedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString()

    rows[0]!.credentials[0]!.session = session({ savedAt })

    const verdicts = await verifySavedSessions(rows)

    expect(verdicts.find(entry => entry.username === 'Sb8de8')?.maintainedHours).toBe(5)
  })

  it('clears an old rejection stamp when the marketplace accepts again', async () => {
    /*
     * `healthOf` reads the stamp before anything else, so one left behind kept
     * the account marked "rejected" for ever — re-captured on every run long
     * after the marketplace had started accepting it.
     */
    reset()

    const rows = buckets()

    rows[0]!.credentials[0]!.session = session({ rejectedAt: '2026-01-01T00:00:00.000Z' })

    await verifySavedSessions(rows)

    expect(rows[0]?.credentials[0]?.session?.rejectedAt).toBeNull()
  })

  it('skips a hidden credential, which nothing else would sign in either', async () => {
    reset()

    const rows = buckets()
    rows[0]!.credentials[0]!.visible = false

    await verifySavedSessions(rows)

    expect(state.probed).toEqual(['snapdeal:other@example.com'])
  })
})
