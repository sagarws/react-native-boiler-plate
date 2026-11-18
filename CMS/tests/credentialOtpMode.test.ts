import { describe, expect, it, vi } from 'vitest'

/**
 * Whether signing in to one account costs a one-time code.
 *
 * Snapdeal, Flipkart and AJIO raise a code on some seller accounts and not others —
 * it is a setting on the account, not a property of the marketplace — and
 * nothing here can work out which without spending a login finding out. So it
 * is recorded per credential, and what is pinned here is the three-state
 * reading of it: TRUE expects a code, FALSE skips the wait, and NULL means
 * nobody has said, which must behave exactly as every sign-in did before this
 * field existed.
 *
 * Get the null case wrong and the field is not a setting, it is a regression:
 * every existing credential would silently stop waiting for a code it is
 * genuinely sent.
 */

const state = vi.hoisted(() => ({
  isOtpBased: null as boolean | null,
  posted: null as Record<string, unknown> | null,
  patched: null as { platform: string; credentialId: string; isOtpBased: boolean } | null
}))

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
vi.mock('@main/services/httpClient', () => ({
  apiRequest: (path: string, options: { body?: Record<string, unknown> }) => {
    state.posted = { path, ...options.body }

    return Promise.resolve({ success: true, data: { isOtpBased: options.body?.isOtpBased } })
  }
}))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => 'token' }))
vi.mock('@main/services/company.service', () => ({
  credentialFor: () => Promise.resolve({ isOtpBased: state.isOtpBased }),
  credentialsFor: () => Promise.resolve([]),
  rememberCompanySession: vi.fn(),
  rememberOtpMode: (platform: string, credentialId: string, isOtpBased: boolean) => {
    state.patched = { platform, credentialId, isOtpBased }

    return Promise.resolve()
  }
}))

const { setCredentialOtpMode, OTP_OPTIONAL_PLATFORMS } = await import(
  '@main/services/platformSession.service'
)

describe('recording a credential’s OTP mode', () => {
  it('is offered for the marketplaces where it varies by account', () => {
    expect([...OTP_OPTIONAL_PLATFORMS].sort()).toEqual(['ajio', 'flipkart', 'snapdeal'])
  })

  it('refuses a platform whose sign-in does not vary', async () => {
    // Every Tata CliQ login raises a code; a switch there could only break one.
    const result = await setCredentialOtpMode({
      platform: 'tatacliq',
      credentialId: '6a6477c68bee52ba0de0a843',
      isOtpBased: false
    })

    expect(result.success).toBe(false)
  })

  it('writes to TrackVid and patches the local copy in the same breath', async () => {
    const result = await setCredentialOtpMode({
      platform: 'flipkart',
      credentialId: '6a6477c68bee52ba0de0a843',
      isOtpBased: true
    })

    expect(result.success).toBe(true)
    expect(state.posted).toMatchObject({
      path: '/cms/credential-otp-mode',
      platform: 'flipkart',
      credentialId: '6a6477c68bee52ba0de0a843',
      isOtpBased: true
    })
    // Without the local patch the setting would only take effect after the
    // next Sync — which is most of its value gone.
    expect(state.patched).toEqual({
      platform: 'flipkart',
      credentialId: '6a6477c68bee52ba0de0a843',
      isOtpBased: true
    })
  })

  it('refuses a request that names no account', async () => {
    const result = await setCredentialOtpMode({ platform: 'snapdeal', isOtpBased: true })

    expect(result.success).toBe(false)
  })
})
