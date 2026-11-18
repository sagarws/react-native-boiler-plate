import { createRequire } from 'node:module'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'

/**
 * Signing Myntra in without a display.
 *
 * Myntra is the one platform whose scripted sign-in needs a screen: its LOG IN
 * button ignores a synthetic click, so the established path finishes with a
 * real mouse click at screen coordinates. A capture of a successful sign-in
 * (api-network-records (13).json) shows the click produces one ordinary JSON
 * POST, with no captcha token, no Akamai sensor payload, no OTP and no cookie
 * header — so the same request can be issued from inside the page, and the
 * display requirement goes with the click.
 *
 * What is pinned here is everything that can be decided without a browser: the
 * per-attempt id, the shape of the submitted script, and what each answer
 * means. The request itself is proved by a real sign-in, not by a test.
 */

const require_ = createRequire(import.meta.url)

const {
  EMAIL_LOGIN_URL,
  readCidx,
  isLoginPage,
  emailLoginScript,
  interpretLoginResponse
} = require_('@trackvid/automation-core/platforms/myntra/common/headlessLogin') as {
  EMAIL_LOGIN_URL: string
  readCidx: (url: string) => string
  isLoginPage: (url: string) => boolean
  emailLoginScript: (input: {
    email: string
    password: string
    cidx: string
    pageRequested?: string
  }) => string
  interpretLoginResponse: (result: unknown) => { outcome: string; message: string }
}

describe('the per-attempt id', () => {
  it('is read off the login page URL, as captured', () => {
    expect(
      readCidx(
        'https://accounts.myntra.com/emaillogin?cidx=partners_mdirect-bb952a4d-38dd-4e69-91c1-90be8e98ff29&pageRequested=https%3A%2F%2Fpartners.myntrainfo.com%2F'
      )
    ).toBe('partners_mdirect-bb952a4d-38dd-4e69-91c1-90be8e98ff29')
  })

  it('answers empty rather than guessing when there is none', () => {
    // It cannot be invented — it is minted by the portal's redirect — so a
    // caller must be able to tell that it has not arrived yet.
    expect(readCidx('https://partners.myntrainfo.com/')).toBe('')
    expect(readCidx('')).toBe('')
    expect(readCidx('not a url')).toBe('')
  })

  it('knows the page the sign-in can be submitted from', () => {
    expect(isLoginPage('https://accounts.myntra.com/emaillogin?cidx=x')).toBe(true)
    expect(isLoginPage('https://partners.myntrainfo.com/')).toBe(false)
  })
})

describe('the script that submits it', () => {
  const script = emailLoginScript({
    email: 'ops@example.com',
    // A password with a quote and a backslash: interpolating it would break the
    // script, or worse, turn it into code.
    password: 'pa"ss\\word',
    cidx: 'partners_mdirect-1'
  })

  it('is valid JavaScript with an awkward password in it', () => {
    // Compiled, never run: `new Script` parses without executing, which is
    // the whole question here — a password carrying a quote must arrive as
    // data and not as a syntax error in the page.
    expect(() => new Script(script)).not.toThrow()
  })

  it('posts to the endpoint the capture shows, with credentials included', () => {
    expect(script).toContain(EMAIL_LOGIN_URL)
    expect(script).toContain('"POST"')
    expect(script).toContain('credentials: "include"')
    // Echoed in the body as well as the query string, as the portal does.
    expect(script).toContain('partners_mdirect-1')
  })

  it('never lets the password reach the page as raw source', () => {
    // JSON.stringify, so the quote and the backslash arrive as data.
    expect(script).toContain(JSON.stringify('pa"ss\\word'))
  })

  it('resolves a non-2xx instead of throwing across the evaluate boundary', () => {
    // A thrown string loses the status, and the status is what decides whether
    // a person is needed.
    expect(script).toContain('status: res.status')
  })
})

describe('what the answer means', () => {
  it('calls a 2xx submitted — not signed in', () => {
    // The capture could not record a successful body, so nothing here pretends
    // to know its shape: the session is proved by asking the portal.
    expect(interpretLoginResponse({ status: 200, ok: true, body: '{}' }).outcome).toBe('submitted')
  })

  it('reports a refused password as rejected', () => {
    expect(interpretLoginResponse({ status: 401, body: 'Invalid password' }).outcome).toBe('rejected')
    expect(interpretLoginResponse({ status: 200, body: 'Please enter valid credentials' }).outcome).toBe(
      'rejected'
    )
  })

  it('reports a captcha as its own outcome, so the caller stops', () => {
    // reCAPTCHA is loaded on that page and asked for nothing in the capture —
    // invisible until it is not, and a browser with no window is what provokes
    // it. Retrying into that is pointless; handing the operator the window is
    // not.
    const verdict = interpretLoginResponse({ status: 200, body: 'recaptcha verification required' })

    expect(verdict.outcome).toBe('challenged')
    expect(verdict.message).toContain('captcha')
  })

  it('reports a one-time code demand separately from a failure', () => {
    expect(interpretLoginResponse({ status: 200, body: 'Enter the OTP sent to your email' }).outcome).toBe(
      'otp'
    )
  })

  it('treats a request that never completed as failed, not rejected', () => {
    // A network error is not a wrong password, and marking a credential
    // unverified over one is how a working account gets switched off.
    expect(interpretLoginResponse({ status: 0, body: 'net::ERR_CONNECTION_RESET' }).outcome).toBe('failed')
    expect(interpretLoginResponse({ status: 503, body: '' }).outcome).toBe('failed')
  })
})
