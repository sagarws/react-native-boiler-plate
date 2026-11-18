import { describe, expect, it, vi } from 'vitest'

/**
 * What the company document viewer is allowed to show.
 *
 * The stored document holds the keys to every seller account this company has,
 * and the Settings page renders it as a tree. The redaction is the boundary
 * between "a viewer that answers is my session stored" and "a screen that hands
 * over the accounts", so what crosses it is pinned here rather than reread.
 *
 * THE PASSWORD NOW CROSSES, deliberately. It is the operator's own credential,
 * already on this machine and already typed into a login window by this app,
 * and it is the one field whose value answers a real question — "is the stored
 * password the one I changed at the marketplace last week?". The viewer shows
 * it on a click rather than printing it, which is where that risk is managed.
 *
 * TOKENS AND COOKIE JARS DO NOT. A bearer token or a session cookie is not
 * something an operator can recognise or correct; it is a live key, useful only
 * to whoever takes it.
 */

vi.mock('@shared/constants/channels', () => ({ COMPANY_CHANNELS: { view: 'c:view', refresh: 'c:refresh' } }))
vi.mock('@main/services/company.store', () => ({ readCompany: vi.fn() }))
vi.mock('@main/services/company.service', () => ({ refreshCompany: vi.fn() }))
vi.mock('@main/ipc/handler', () => ({ registerHandler: vi.fn() }))

const { redact } = await import('@main/ipc/company.ipc')

const MASK = '••••••••'

describe('redact', () => {
  it('lets the marketplace password through', () => {
    const out = redact({ info: [{ username: 'ops@x.com', password: 'hunter2' }] }) as {
      info: { password: string }[]
    }

    expect(out.info[0]?.password).toBe('hunter2')
  })

  it('still hides every session secret', () => {
    const out = redact({
      csrfToken: 'abc',
      token: 'def',
      accessToken: 'ghi',
      refreshToken: 'jkl'
    }) as Record<string, string>

    expect(out).toEqual({
      csrfToken: MASK,
      token: MASK,
      accessToken: MASK,
      refreshToken: MASK
    })
  })

  it('keeps cookie names and drops their values, in both jar shapes', () => {
    // The tree can still say "17 cookies including JSESSIONID", which is the
    // question this page is actually opened to answer.
    const map = redact({ jar: { JSESSIONID: 'secret', bm_sv: 'secret' } }) as {
      jar: Record<string, string>
    }

    expect(map.jar).toEqual({ JSESSIONID: MASK, bm_sv: MASK })

    const array = redact({ cookies: [{ name: 'at', value: 'secret', domain: '.ajio.com' }] }) as {
      cookies: { name: string; value: string; domain: string }[]
    }

    expect(array.cookies[0]).toEqual({ name: 'at', value: MASK, domain: '.ajio.com' })
  })

  it('leaves a null or missing secret as it found it', () => {
    // A mask over nothing would read as "there is a token here", which is the
    // opposite of what the page is being asked.
    expect(redact({ accessToken: null })).toEqual({ accessToken: null })
    expect(redact({ accessToken: undefined })).toEqual({ accessToken: undefined })
  })

  it('reaches secrets at every depth, and leaves the shape alone', () => {
    const out = redact({
      settings: { eCommercePlatformLoginInfo: [{ info: [{ password: 'p', accessToken: 'a' }] }] }
    }) as never as { settings: { eCommercePlatformLoginInfo: { info: { password: string; accessToken: string }[] }[] } }

    const entry = out.settings.eCommercePlatformLoginInfo[0]?.info[0]

    expect(entry?.password).toBe('p')
    expect(entry?.accessToken).toBe(MASK)
  })
})
