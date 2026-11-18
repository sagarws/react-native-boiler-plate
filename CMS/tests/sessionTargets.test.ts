import { describe, expect, it } from 'vitest'
import { needsSessionUpdate, sessionUpdateTargets } from '@shared/utils/sessionTargets'
import type { PlatformCredentials } from '@shared/types/platformSession'

/**
 * Which credentials the Session update works on — the one rule.
 *
 * It exists because there were three: the nightly task's, the banner's, and
 * (implicitly) whatever a screen decided to show. The task and the banner
 * disagreed in production — "Every session was still good" printed under a red
 * banner naming a Snapdeal account the task had declined to touch. The Settings
 * card now lists this same set before the run, so a third answer would be a
 * card that lies more convincingly than no card at all.
 */

const KNOWN = new Set(['ajio', 'myntra', 'snapdeal', 'meesho', 'flipkart', 'tatacliq'])
const isKnown = (key: string): boolean => KNOWN.has(key)

const session = (hoursLeft: number) => ({
  savedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + hoursLeft * 3_600_000).toISOString(),
  ip: null,
  source: 'cms-desktop',
  hasProxySession: false,
  cookieNames: ['a']
})

const bucket = (
  platform: string,
  credentials: { username: string; session: unknown; visible?: boolean }[],
  autoLogin = true
): PlatformCredentials =>
  ({
    platform,
    autoLogin,
    credentials: credentials.map((credential, i) => ({
      credentialId: `cred-${platform}-${i}`,
      username: credential.username,
      accountType: '',
      vendorCode: '',
      isVerified: true,
      visible: credential.visible ?? true,
      masterDataSync: null,
      session: credential.session,
      pobCount: 0,
      pobSyncedAt: null,
      slaveCount: 0,
      slavesSyncedAt: null,
      domesticCount: 0,
      domesticsSyncedAt: null
    }))
  }) as unknown as PlatformCredentials

describe('needsSessionUpdate', () => {
  it('counts a never-captured session, which is what the task used to miss', () => {
    expect(needsSessionUpdate('none')).toBe(true)
    expect(needsSessionUpdate('expired')).toBe(true)
    // Renewing before the claim run is the whole point of running at 02:00.
    expect(needsSessionUpdate('expiring')).toBe(true)
    expect(needsSessionUpdate('active')).toBe(false)
  })
})

describe('sessionUpdateTargets', () => {
  it('takes expired, expiring and never-captured, and leaves healthy alone', () => {
    const targets = sessionUpdateTargets(
      [
        bucket('Snapdeal', [{ username: 'never@x.com', session: null }]),
        bucket('Myntra', [{ username: 'dead@x.com', session: session(-2) }]),
        bucket('Ajio', [
          { username: 'soon@x.com', session: session(1) },
          { username: 'fine@x.com', session: session(120) }
        ])
      ],
      isKnown
    )

    expect(targets.map(target => target.username).sort()).toEqual([
      'dead@x.com',
      'never@x.com',
      'soon@x.com'
    ])
  })

  it('canonicalises the platform, so captureSession gets a key it knows', () => {
    const [target] = sessionUpdateTargets([bucket('Snapdeal', [{ username: 'a', session: null }])], isKnown)

    expect(target?.platform).toBe('snapdeal')
    // The label keeps the marketplace's own spelling for the screen.
    expect(target?.label).toBe('Snapdeal')
  })

  it('drops a platform this app keeps no session for', () => {
    // The credentials endpoint returns a bucket per configured platform.
    const targets = sessionUpdateTargets(
      [
        bucket('Amazon', [{ username: 'a@x.com', session: null }]),
        bucket('Other', [{ username: 'o@x.com', session: null }]),
        bucket('Meesho', [{ username: 'm@x.com', session: null }])
      ],
      isKnown
    )

    expect(targets.map(target => target.label)).toEqual(['Meesho'])
  })

  it('drops a credential hidden from the seller UI', () => {
    expect(
      sessionUpdateTargets(
        [bucket('Ajio', [{ username: 'a@x.com', session: null, visible: false }])],
        isKnown
      )
    ).toEqual([])
  })

  it('reports whether each one can be signed in unattended', () => {
    const targets = sessionUpdateTargets(
      [
        bucket('Ajio', [{ username: 'a@x.com', session: null }], true),
        bucket('Myntra', [{ username: 'm@x.com', session: null }], false)
      ],
      isKnown
    )

    // The job uses this to report an account instead of holding a browser
    // window open for somebody who is asleep; the card uses it to say which
    // chips will still be red in the morning.
    expect(targets.find(t => t.label === 'Ajio')?.unattended).toBe(true)
    expect(targets.find(t => t.label === 'Myntra')?.unattended).toBe(false)
  })
})

describe('one source, across the screens that name accounts', () => {
  const health = [
    bucket('Snapdeal', [{ username: 'clothing.vasudha@gmail.com', session: null }]),
    // Expiring: hours left, still usable.
    bucket('Myntra', [{ username: 'veshviti@gmail.com', session: session(1) }]),
    bucket('Ajio', [{ username: 'fine@x.com', session: session(120) }])
  ]

  it('gives the banner and the Session update card the same accounts', () => {
    // The reported mismatch: the banner named Snapdeal, the list under Session
    // update named Snapdeal AND Myntra. Both were right by their own rule,
    // which is why neither could be trusted.
    const targets = sessionUpdateTargets(health, isKnown)

    expect(targets.map(target => target.username).sort()).toEqual([
      'clothing.vasudha@gmail.com',
      'veshviti@gmail.com'
    ])
  })

  it('still lets the claim gate file through an expiring session', async () => {
    // The one rule that stays narrower, on purpose: two hours is longer than a
    // batch, and blocking it would refuse work that would have succeeded. The
    // gate and the banner disagreeing about an EXPIRING session is intended;
    // disagreeing about an expired one is the bug.
    const { inactiveAccounts } = await import('@shared/utils/sessionPreflight')

    const blocked = inactiveAccounts(
      [
        { platform: 'Myntra', username: 'veshviti@gmail.com' },
        { platform: 'Snapdeal', username: 'clothing.vasudha@gmail.com' }
      ],
      health
    )

    expect(blocked.map(entry => entry.username)).toEqual(['clothing.vasudha@gmail.com'])
  })
})

describe('logins the Login update must leave alone', () => {
  it('skips a login the marketplace refused (is_verified: false)', () => {
    const tataCliq = bucket('Tata CliQ', [{ username: 'ppmp@x.com', session: session(-24) }])

    ;(tataCliq.credentials[0] as { refused?: boolean }).refused = true

    const targets = sessionUpdateTargets(
      [tataCliq, bucket('Snapdeal', [{ username: 'ok@x.com', session: null }])],
      isKnown
    )

    expect(targets.map(target => target.username)).toEqual(['ok@x.com'])
  })

  it('skips a platform whose company auto-login switch is off', () => {
    const myntra = {
      ...bucket('Myntra', [{ username: 'm@x.com', session: session(-1) }], false),
      autoLoginBlockedBy: 'company'
    } as PlatformCredentials

    expect(sessionUpdateTargets([myntra], isKnown)).toEqual([])
  })
})
