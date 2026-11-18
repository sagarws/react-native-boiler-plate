import { describe, expect, it, vi, beforeEach } from 'vitest'
import type * as SessionReuse from '@main/services/sessionReuse.service'

/**
 * When a stored session may be used instead of signing in.
 *
 * The rule is strict on purpose: ONLY an explicit "it works" from the probe
 * skips the login. Getting this wrong is silent — an expired marketplace
 * session answers 302 to a login page or returns an empty report rather than
 * an error, and Snapdeal's ingest will accept a downloaded login page as a
 * report. So every branch is pinned.
 */

const probePlatformSession = vi.fn()
const credentialFor = vi.fn()

/**
 * The core, as this service uses it: the probe, and the table that says what
 * each platform's session must CARRY.
 *
 * The second matters as much as the first. Delhivery and Xbees are bearer-token
 * APIs whose jar is legitimately empty — judging them by cookie count threw
 * every one of their sessions away — so the real `missingContextFields` is
 * stood in for here rather than assumed.
 */
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (module: string) =>
    module === 'common/claimContext'
      ? {
          missingContextFields: (platform: string, record: Record<string, unknown> | null) => {
            // Jarless platforms need a token; everything else needs cookies.
            const jarless = ['delhivery', 'xbees'].includes(platform.toLowerCase())
            const jar = record?.jar
            const hasJar = Boolean(
              jar && (Array.isArray(jar) ? jar.length > 0 : Object.keys(jar).length > 0)
            )
            const missing: string[] = []

            if (jarless && typeof record?.accessToken !== 'string') missing.push('accessToken')
            if (!jarless && !hasJar) missing.push('jar')

            return missing
          }
        }
      : { probePlatformSession }
}))
vi.mock('@main/services/company.service', () => ({ credentialFor }))

/**
 * The rejection stamp — what proved a session dead last time.
 *
 * Controlled here because it is now a VERDICT, not just a badge: a platform
 * with no identity endpoint has nothing else to go on, and the stamp is the
 * most recent evidence there is.
 */
const stamps = new Map<string, { detail?: string }>()

vi.mock('@main/services/sessionRejection.store', () => ({
  sessionRejections: () => Promise.resolve(stamps),
  // The REAL key uses `platformKey`, which strips spaces — "Tata CliQ" and
  // "tatacliq" are one account. A mock that only lower-cased would make the
  // casing test pass against a key the store never writes.
  sessionRejectionKey: (platform: string, username: string) =>
    `${platform.trim().toLowerCase().replace(/\s+/g, '')}:${username.trim().toLowerCase()}`,
  rememberSessionRejected: vi.fn(),
  forgetSessionRejected: vi.fn()
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))

const load = async (): Promise<typeof SessionReuse> => {
  vi.resetModules()

  return import('@main/services/sessionReuse.service')
}

const withSession = (session: unknown): void => {
  credentialFor.mockResolvedValue({ username: 'a@b.c', password: 'p', session })
}

beforeEach(() => {
  probePlatformSession.mockReset()
  credentialFor.mockReset()
})

describe('reusableSession', () => {
  it('reuses a session the probe confirms', async () => {
    const { reusableSession } = await load()

    withSession({ jar: { JSESSIONID: 'abc' }, source: 'cms-desktop' })
    probePlatformSession.mockResolvedValue(true)

    const outcome = await reusableSession('snapdeal', 'a@b.c')

    expect(outcome.reason).toBe('reused')
    expect(outcome.session).toEqual({ jar: { JSESSIONID: 'abc' }, source: 'cms-desktop' })
  })

  it('signs in when the probe says the session is dead', async () => {
    const { reusableSession } = await load()

    withSession({ jar: { JSESSIONID: 'abc' } })
    probePlatformSession.mockResolvedValue(false)

    const outcome = await reusableSession('snapdeal', 'a@b.c')

    expect(outcome.session).toBeNull()
    expect(outcome.reason).toBe('dead')
    // The wording matters: a session can read "Saved · 20h left" on the
    // Sessions page and still be dead, because that badge only compares
    // `expiresAt` — a guess made at capture — with now.
    expect(outcome.detail).toContain('expiry date')
  })

  // The source is CONTEXT, not a verdict. An earlier version claimed a
  // server-minted session "cannot be reused here" — and the automation server
  // then reused the very session this app had just called dead. Only the probe
  // decides; the line says where the jar came from so a reader can follow up.
  it('names where a rejected session came from', async () => {
    const { reusableSession } = await load()

    // Myntra binds a session to the egress IP that created it, so a jar the
    // automation server captured is dead here however fresh it looks. Saying
    // "it is dead" would send the operator to Re-capture, which does not help;
    // saying WHERE it came from explains why.
    withSession({ jar: { at: 'x' }, source: 'claim-api' })
    probePlatformSession.mockResolvedValue(false)

    const outcome = await reusableSession('myntra', 'a@b.c')

    expect(outcome.session).toBeNull()
    expect(outcome.detail).toContain('claim-api')
    expect(outcome.detail).toContain('is dead despite its expiry date')
  })

  it('signs in when the probe cannot tell', async () => {
    const { reusableSession } = await load()

    // AJIO returns null — its probe needs a live page. "Cannot tell" must not
    // be optimistically read as "fine".
    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(null)

    const outcome = await reusableSession('ajio', 'a@b.c')

    expect(outcome.session).toBeNull()
    expect(outcome.reason).toBe('unverifiable')
  })

  it('signs in when the probe itself throws', async () => {
    const { reusableSession } = await load()

    withSession({ jar: { JSESSIONID: 'abc' } })
    probePlatformSession.mockRejectedValue(new Error('socket hang up'))

    // A probe that fails tells us nothing about the session — the network may
    // simply be down — so it is not evidence the session is good.
    const outcome = await reusableSession('snapdeal', 'a@b.c')

    expect(outcome.session).toBeNull()
    expect(outcome.reason).toBe('probe-failed')
  })

  it('rejects an empty jar without even probing', async () => {
    const { reusableSession } = await load()

    withSession({ jar: {} })

    expect((await reusableSession('snapdeal', 'a@b.c')).reason).toBe('empty-jar')
    expect(probePlatformSession).not.toHaveBeenCalled()
  })

  it('rejects an empty cookie ARRAY too', async () => {
    const { reusableSession } = await load()

    // AJIO stores its jar as an array; `Object.keys([]).length` is 0 but a
    // careless length check on the wrong shape would pass it through.
    withSession({ jar: [] })

    expect((await reusableSession('ajio', 'a@b.c')).reason).toBe('empty-jar')
    expect(probePlatformSession).not.toHaveBeenCalled()
  })

  it('returns null when the credential has never had a session', async () => {
    const { reusableSession } = await load()

    withSession(null)

    const outcome = await reusableSession('meesho', 'a@b.c')

    expect(outcome.reason).toBe('none-stored')
    // Points at the likely cause: this reads the LOCAL copy, the Sessions page
    // reads the server, so a just-captured session is visible there and not here.
    expect(outcome.detail).toContain('Sync')
    expect(probePlatformSession).not.toHaveBeenCalled()
  })
})

/**
 * A bearer-token platform has no cookies, and that is not a missing session.
 *
 * Delhivery's capture succeeded, stored its access token, and was then reported
 * as having no session at all — because this check counted cookies. The gate
 * blocked every run on the account, re-capturing produced another perfectly
 * good token session, and nothing said why. From the outside it looked exactly
 * like a capture that had never happened.
 */
describe('a jarless platform', () => {
  it('reuses a token session with an empty jar', async () => {
    const { reusableSession } = await load()

    withSession({ jar: {}, accessToken: 'eyJhbGciOi...', realm: 'cms' })
    probePlatformSession.mockResolvedValue(true)

    await expect(reusableSession('delhivery', 'shashidhara.ct@tigc.in')).resolves.toMatchObject({
      reason: 'reused'
    })
  })

  it('still refuses one with neither cookies nor a token', async () => {
    const { reusableSession } = await load()

    withSession({ jar: {} })

    const verdict = await reusableSession('delhivery', 'shashidhara.ct@tigc.in')

    expect(verdict.reason).toBe('empty-jar')
    // Names what is missing rather than saying "no cookies" to a platform that
    // never has any.
    expect(verdict.detail).toContain('accessToken')
  })

  it('still demands cookies from a platform that uses them', async () => {
    const { reusableSession } = await load()

    withSession({ jar: {}, accessToken: 'not-used-here' })

    await expect(reusableSession('meesho', 'seller@example.com')).resolves.toMatchObject({
      reason: 'empty-jar'
    })
  })
})


/**
 * A session nothing can verify over HTTP, and what decides it anyway.
 *
 * Tata CliQ has no identity endpoint: the only thing that can judge its session
 * is a browser page asking for the slave list. So every pre-flight check landed
 * on `unverifiable`, which does not block — and Create Ticket started, opened a
 * browser, found the session signed out, and spent an emailed OTP mid-batch
 * with nobody watching. On an account the app had ALREADY discovered was dead
 * on a previous run.
 *
 * The stamp is that discovery, kept. It is cleared the moment a session is
 * reused successfully, so anything still stamped is current evidence.
 */
describe('a platform with no identity endpoint', () => {
  beforeEach(() => stamps.clear())

  it('is unverifiable when nothing has ever refused it', async () => {
    // Unchanged, and deliberately so: AJIO lands here by design, and calling
    // "cannot tell" dead would stop AJIO claims entirely.
    const { reusableSession } = await load()

    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(null)

    const outcome = await reusableSession('tatacliq', 'a@b.c')

    expect(outcome.reason).toBe('unverifiable')
  })

  it('is DEAD once something has refused it', async () => {
    // The stamp is the only evidence available, and it says no. Reported as
    // dead so Create Ticket shows "Update sessions first" before it opens a
    // browser or spends an OTP.
    const { reusableSession } = await load()

    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(null)
    stamps.set('tatacliq:a@b.c', { detail: 'signed out' })

    const outcome = await reusableSession('tatacliq', 'a@b.c')

    expect(outcome.reason).toBe('dead')
    expect(outcome.detail).toMatch(/refused this login earlier/i)
  })

  it('matches the stamp however the platform and account are cased', async () => {
    // The caller passes whatever the row holds — "Tata CliQ", "tatacliq" — and
    // a stamp that fails to match is a dead session let through.
    const { reusableSession } = await load()

    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(null)
    stamps.set('tatacliq:a@b.c', {})

    expect((await reusableSession('Tata CliQ', ' A@B.C ')).reason).toBe('dead')
  })

  it('stops blocking once the stamp is gone', async () => {
    // Re-capturing clears it. A block that outlived the fix would send an
    // operator back to a dialog they had already answered.
    const { reusableSession } = await load()

    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(null)

    expect((await reusableSession('tatacliq', 'a@b.c')).reason).toBe('unverifiable')
  })

  it('does not let a stamp override a session the marketplace just accepted', async () => {
    // A live probe outranks a record of the past. The stamp is consulted only
    // where nothing can be asked.
    const { reusableSession } = await load()

    withSession({ jar: [{ name: 'bff_session', value: 'x' }] })
    probePlatformSession.mockResolvedValue(true)
    stamps.set('tatacliq:a@b.c', {})

    expect((await reusableSession('tatacliq', 'a@b.c')).reason).toBe('reused')
  })
})
