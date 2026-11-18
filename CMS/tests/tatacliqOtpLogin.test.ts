import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require_ = createRequire(import.meta.url)

interface TataCliqLogin {
  SELECTORS: { otpModal: string; otpSubmit: string }
  typeOtpIntoModal: (page: unknown, code: string) => Promise<boolean>
  loginTataCliq: (
    page: unknown,
    credentials: { username: string; password: string },
    options: { fetchOtp?: unknown; isSignedIn?: unknown; logger?: unknown }
  ) => Promise<{ ok: true }>
}

/*
 * NO SETTLE IN THE TEST.
 *
 * The sign-in now waits half a minute after the password before reading the
 * mailbox, because reading sooner returns the code the portal just retired —
 * see the core's common/otpTiming. That is the right behaviour and the wrong
 * thing to sit through here, and `0` is a supported value rather than a
 * test-only escape hatch: an operator running a sign-in by hand wants it too.
 */
process.env.OTP_SETTLE_MS = '0'

const MODULE = '@trackvid/automation-core/platforms/tatacliq/common/login'

const login = require_(MODULE) as TataCliqLogin

/**
 * Signing in to Tata CliQ, which always costs an OTP.
 *
 * Two failures worth pinning, both seen in the field. A run sat in front of the
 * portal's OTP box for two silent minutes because every failed read of the
 * mailbox relay was swallowed and retried — so the reason has to survive into
 * the error. And the code is submitted through one captured URL, so when that
 * stops working the run should do what a person would: type it into the box
 * that is on screen.
 */

/** Just enough puppeteer page for the login to drive. */
const stubPage = (over: Partial<Record<string, unknown>> = {}) => ({
  goto: vi.fn(() => Promise.resolve()),
  waitForSelector: vi.fn(() => Promise.resolve({})),
  waitForFunction: vi.fn(() => Promise.resolve(true)),
  click: vi.fn(() => Promise.resolve()),
  type: vi.fn(() => Promise.resolve()),
  $: vi.fn(() => Promise.resolve({})),
  $eval: vi.fn(() => Promise.resolve('')),
  focus: vi.fn(() => Promise.resolve()),
  keyboard: { press: vi.fn(() => Promise.resolve()), type: vi.fn(() => Promise.resolve()) },
  evaluate: vi.fn(() => Promise.resolve(true)),
  ...over
})

const credentials = { username: 'ppmp.tataunistore@wrogn.com', password: 'secret' }

/**
 * The desktop cannot read the OTP mailbox, so it brings its own fetch and needs
 * only the WAITING from the core. It asked this module for that and got
 * `undefined` — which the packaged build reported as "r is not a function",
 * four milliseconds into a two-minute wait, on every attempt.
 */
describe('the Tata CliQ OTP module', () => {
  it('exposes the shared poller, not only the mailbox read', () => {
    const otp = require_('@trackvid/automation-core/platforms/tatacliq/common/getOtp') as Record<
      string,
      unknown
    >

    expect(typeof otp.pollForOtp).toBe('function')
    expect(typeof otp.GetTataCliqOTP).toBe('function')
    // The factory the server passes to the login, kept alongside.
    expect(typeof otp.gmailOtpReader).toBe('function')
  })
})

describe('typeOtpIntoModal', () => {
  it('fills the box and presses the button inside the modal', async () => {
    // The real work happens in the browser; what is checked here is that the
    // code and the modal selector actually reach it.
    const evaluate = vi.fn(() => Promise.resolve(true))
    const page = stubPage({ evaluate })

    await expect(login.typeOtpIntoModal(page, '129614')).resolves.toBe(true)

    const [, selector, value, submit] = evaluate.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
      string
    ]

    expect(selector).toBe(login.SELECTORS.otpModal)
    expect(value).toBe('129614')
    // The portal's own button, by the id it gave it.
    expect(submit).toBe('#submitOTP')
  })

  it('says so rather than throwing when there is no box to type into', async () => {
    const page = stubPage({ evaluate: vi.fn(() => Promise.reject(new Error('detached'))) })

    await expect(login.typeOtpIntoModal(page, '129614')).resolves.toBe(false)
  })
})

describe('loginTataCliq when the code never arrives', () => {
  it('carries the reason the mailbox could not be read into the failure', async () => {
    const page = stubPage()
    const fetchOtp = vi.fn(() =>
      Promise.reject(new Error('Neither TATACLIQ_SCRIPT_URL nor SCRIPT_URL is configured'))
    )

    // A short budget, so the test is not the two-minute wait itself.
    process.env.TATACLIQ_OTP_WAIT_MS = '200'

    // Re-required so the module re-reads the budget from the environment.
    const fresh = createRequire(import.meta.url)

    delete fresh.cache[fresh.resolve(MODULE)]

    const quick = fresh(MODULE) as TataCliqLogin

    await expect(quick.loginTataCliq(page, credentials, { fetchOtp })).rejects.toThrow(
      /OTP_FETCH_FAILED[\s\S]*SCRIPT_URL is configured/
    )

    delete process.env.TATACLIQ_OTP_WAIT_MS
  })

  it('refuses to start without somewhere to get a code from', async () => {
    await expect(login.loginTataCliq(stubPage(), credentials, {})).rejects.toThrow(
      /`fetchOtp` function is required/
    )
  })
})
