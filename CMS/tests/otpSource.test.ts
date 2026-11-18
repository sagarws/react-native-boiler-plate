import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * One source of one-time codes, for both platforms that need one.
 *
 * The automation server reads the mailbox with `GetFlipKartOTP` /
 * `GetTataCliqOTP` — functions that live in the CORE, which this app already
 * loads. So the server was never required to call them; it just had the
 * credentials and this app did not. Given the same inbox, the app reads it
 * itself and a Tata CliQ sign-in needs nothing else running.
 *
 * Flipkart appeared to work without any of this for weeks. It did not: it is
 * simply not challenged on every account, so most of its sign-ins never ask for
 * a code — while Tata CliQ raises one on EVERY login and so failed the moment
 * the server was down.
 */

const state = vi.hoisted(() => ({
  user: '',
  password: '',
  /** platform → what the core's reader returns. */
  codes: new Map<string, string | null>(),
  asked: [] as { platform: string; address: string; account: string }[],
  throws: false
}))

vi.mock('@main/config/env', () => ({
  env: {
    get gmailImapUser() {
      return state.user
    },
    get gmailImapPassword() {
      return state.password
    }
  }
}))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}))
vi.mock('@main/services/company.service', () => ({
  credentialFor: (_platform: string, username: string) =>
    Promise.resolve(
      username === 'has-otp-address@example.com'
        ? { otpEmail: 'codes@example.com' }
        : { username, otpEmail: '' }
    )
}))
vi.mock('@main/automations/common/coreLoader', () => ({
  loadCore: (subpath: string) => {
    const platform = subpath.includes('flipkart') ? 'flipkart' : 'tatacliq'
    const fn = platform === 'flipkart' ? 'GetFlipKartOTP' : 'GetTataCliqOTP'

    return {
      DEFAULT_TO: 'default-inbox@example.com',
      [fn]: (to: string, options: { account?: { user: string } }) => {
        if (state.throws) return Promise.reject(new Error('IMAP said no'))

        state.asked.push({ platform, address: to, account: options.account?.user ?? '' })

        return Promise.resolve(state.codes.get(platform) ?? null)
      }
    }
  }
}))

const { canReadOtpHere, cloudflareInboxOf, otpAddressFor, readOtpLocally } = await import(
  '@main/services/otpSource'
)

beforeEach(() => {
  state.user = 'shared@example.com'
  state.password = 'app-password'
  state.codes.clear()
  state.asked.length = 0
  state.throws = false
})

describe('reading only the given credential’s codes', () => {
  it('searches the shared inbox for mail to that one address', async () => {
    state.codes.set('flipkart', '123456')

    expect(await readOtpLocally('flipkart', 'seller@example.com')).toBe('123456')
    expect(state.asked).toEqual([
      { platform: 'flipkart', address: 'seller@example.com', account: 'shared@example.com' }
    ])
  })
})

describe('whether this machine can read the codes itself', () => {
  it('can, once it has the mailbox', () => {
    expect(canReadOtpHere()).toBe(true)
  })

  it('cannot with only half of it — and half would fail at connect time', () => {
    state.password = ''
    expect(canReadOtpHere()).toBe(false)

    state.password = 'app-password'
    state.user = ''
    expect(canReadOtpHere()).toBe(false)
  })

  it('reads nothing locally when it cannot, rather than throwing', async () => {
    state.user = ''
    state.password = ''

    expect(await readOtpLocally('tatacliq', 'x@example.com')).toBeNull()
    // And it did not even try: the relay is the whole route in that state.
    expect(state.asked).toEqual([])
  })
})

describe('the same source, for both platforms', () => {
  it('reads Tata CliQ through the core, with the configured mailbox', async () => {
    state.codes.set('tatacliq', '123456')

    expect(await readOtpLocally('tatacliq', 'seller@example.com')).toBe('123456')
    expect(state.asked).toEqual([
      { platform: 'tatacliq', address: 'seller@example.com', account: 'shared@example.com' }
    ])
  })

  it('reads Flipkart the identical way', async () => {
    state.codes.set('flipkart', '654321')

    expect(await readOtpLocally('flipkart', 'seller@example.com')).toBe('654321')
    expect(state.asked[0]?.platform).toBe('flipkart')
    // Same inbox as Tata CliQ's — one mailbox, one credential, two readers.
    expect(state.asked[0]?.account).toBe('shared@example.com')
  })

  it('knows nothing about a platform with no reader', async () => {
    expect(await readOtpLocally('snapdeal', 'seller@example.com')).toBeNull()
  })

  it('falls through on a mailbox error instead of failing the sign-in', async () => {
    // The relay is still a second opinion worth having, and a login that is
    // already standing at the OTP box should not be abandoned over IMAP.
    state.throws = true

    expect(await readOtpLocally('tatacliq', 'seller@example.com')).toBeNull()
  })
})

describe('where the portal sends the code', () => {
  it('uses the credential’s own OTP address when it has one', async () => {
    // The same rule the server applies, so both routes look in one place.
    expect(await otpAddressFor('tatacliq', 'has-otp-address@example.com')).toBe(
      'codes@example.com'
    )
  })

  it('falls back to the login id', async () => {
    expect(await otpAddressFor('tatacliq', 'seller@example.com')).toBe('seller@example.com')
  })
})

describe('the Cloudflare Access inbox the Login page shows', () => {
  it('is the credential’s own when it has one', () => {
    expect(cloudflareInboxOf({ cloudflareEmail: 'cf@example.com' } as never)).toBe('cf@example.com')
  })

  it('is the core’s default when it is empty or there is no local copy', () => {
    expect(cloudflareInboxOf({ cloudflareEmail: '' } as never)).toBe('default-inbox@example.com')
    expect(cloudflareInboxOf(null)).toBe('default-inbox@example.com')
  })

  it('matches where the reader looks', async () => {
    expect(await otpAddressFor('tatacliq-cloudflare', 'seller@example.com')).toBe(
      'default-inbox@example.com'
    )
  })
})
