import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)

/**
 * Signing Myntra in without a window, and the hop that makes it real.
 *
 * Myntra answers the sign-in POST by setting the session on the ACCOUNTS host,
 * accounts.myntra.com. The cookies this app stores are the PORTAL's —
 * partners.myntrainfo.com — and those are only issued once the portal is loaded
 * and completes its handshake against that new session.
 *
 * Clicking LOG IN gets that for free, because clicking navigates. A `fetch`
 * does not, and the first version of this path only slept afterwards. The
 * harvest then read whatever the cookie partition already held — on a
 * re-capture, the PREVIOUS session's jar — which was enough cookies to look
 * like a successful capture and stale enough for Myntra to answer "nobody is
 * signed in". The capture was refused, nothing was saved, and re-capturing
 * could never fix it however many times it was pressed.
 *
 * The two hosts are the whole point, so they are pinned here.
 */

interface HeadlessLogin {
  EMAIL_LOGIN_URL: string
  readCidx: (url: string) => string
  isLoginPage: (url: string) => boolean
  interpretLoginResponse: (raw: unknown) => { outcome: string; message: string }
}

const core = require_(
  '@trackvid/automation-core/platforms/myntra/common/headlessLogin'
) as HeadlessLogin

interface Platforms {
  getPlatform: (key: string) => { loginUrl: string; cookieDomains: string[] } | undefined
}

const { getPlatform } = require_('@trackvid/automation-core/common/platforms') as Platforms

describe('where Myntra signs in, and where its cookies live', () => {
  it('signs in on the accounts host', () => {
    expect(core.EMAIL_LOGIN_URL).toContain('accounts.myntra.com')
  })

  it('stores cookies from the PORTAL host, which is a different host entirely', () => {
    const myntra = getPlatform('myntra')

    // This is the whole bug in two assertions. The sign-in host and the
    // harvested host are not the same, so a POST that never leaves the
    // accounts page cannot produce the cookies this app keeps.
    expect(myntra?.loginUrl).toContain('partners.myntrainfo.com')
    expect(myntra?.cookieDomains).toContain('.myntrainfo.com')
    expect(myntra?.cookieDomains.some(domain => domain.includes('myntra.com'))).toBe(false)
  })

  it('knows the login page when it sees it, so a bounce-back is not read as success', () => {
    // After the hop, still being here means the portal refused the session —
    // which must surface as a failed sign-in, not as a capture of a stale jar.
    expect(core.isLoginPage('https://accounts.myntra.com/emaillogin?cidx=partners_mdirect-abc')).toBe(
      true
    )
    expect(core.isLoginPage('https://partners.myntrainfo.com/dashboard')).toBe(false)
    expect(core.isLoginPage('')).toBe(false)
  })

  it('reads the per-attempt id the request cannot be made without', () => {
    expect(
      core.readCidx('https://accounts.myntra.com/emaillogin?cidx=partners_mdirect-abc-123')
    ).toBe('partners_mdirect-abc-123')
    expect(core.readCidx('https://partners.myntrainfo.com/')).toBe('')
  })

  it('treats anything but a submitted answer as not signed in', () => {
    // A challenge or a one-time code means a person, and a person needs the
    // visible window — so these must never be read as "carry on and harvest".
    for (const raw of [null, {}, { status: 403 }, { status: 500 }]) {
      expect(core.interpretLoginResponse(raw).outcome).not.toBe('submitted')
    }
  })
})
