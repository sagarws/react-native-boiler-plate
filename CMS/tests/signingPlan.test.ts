import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { report } = require('../scripts/signingPlan.cjs') as {
  report: (input: { platforms: string[]; strict: boolean }) => boolean
}

/**
 * The packaging preflight.
 *
 * Worth pinning because its whole job is to be right about a thing nobody
 * checks by hand: electron-builder signs when it finds a certificate and
 * silently does not when it cannot, so an unsigned release reads exactly like
 * a signed one in the build log. The test that matters is the REFUSAL — a
 * guard that never fires is decoration.
 */

const SIGNING = ['CSC_LINK', 'CSC_NAME', 'WIN_CSC_LINK', 'CSC_IDENTITY_AUTO_DISCOVERY']
const NOTARISING = [
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_API_ISSUER',
  'APPLE_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_TEAM_ID',
  'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE'
]

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}

  // The machine running the tests may legitimately hold real credentials, and
  // a test that passes only on an unsigned laptop is not a test.
  for (const key of [...SIGNING, ...NOTARISING]) {
    saved[key] = process.env[key]
    delete process.env[key]
  }

  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }

  vi.restoreAllMocks()
})

describe('the packaging signing plan', () => {
  it('lets a developer build without a certificate', () => {
    expect(report({ platforms: ['mac'], strict: false })).toBe(true)
  })

  it('refuses a release with no certificate', () => {
    expect(report({ platforms: ['mac'], strict: true })).toBe(false)
  })

  it('refuses a macOS release that is signed but not notarised', () => {
    process.env.CSC_LINK = '/tmp/certificate.p12'

    expect(report({ platforms: ['mac'], strict: true })).toBe(false)
  })

  it('allows a release once signing and notarisation are both configured', () => {
    process.env.CSC_LINK = '/tmp/certificate.p12'
    process.env.APPLE_API_KEY = '/tmp/key.p8'
    process.env.APPLE_API_KEY_ID = 'ABC123'
    process.env.APPLE_API_ISSUER = 'issuer-uuid'

    expect(report({ platforms: ['mac'], strict: true })).toBe(true)
  })

  it('accepts the Apple ID set as well as the API key set', () => {
    process.env.CSC_LINK = '/tmp/certificate.p12'
    process.env.APPLE_ID = 'builds@example.com'
    process.env.APPLE_APP_SPECIFIC_PASSWORD = 'app-specific'
    process.env.APPLE_TEAM_ID = 'TEAMID'

    expect(report({ platforms: ['mac'], strict: true })).toBe(true)
  })

  it('does not accept half a credential set', () => {
    process.env.CSC_LINK = '/tmp/certificate.p12'
    process.env.APPLE_ID = 'builds@example.com'
    // No APPLE_APP_SPECIFIC_PASSWORD, no APPLE_TEAM_ID.

    expect(report({ platforms: ['mac'], strict: true })).toBe(false)
  })

  it('treats CSC_IDENTITY_AUTO_DISCOVERY=false as a choice, and still refuses a release', () => {
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'

    expect(report({ platforms: ['mac'], strict: false })).toBe(true)
    expect(report({ platforms: ['mac'], strict: true })).toBe(false)
  })

  /** Windows needs a certificate and has nothing to notarise. */
  it('does not ask Windows for Apple credentials', () => {
    process.env.WIN_CSC_LINK = '/tmp/certificate.pfx'

    expect(report({ platforms: ['win'], strict: true })).toBe(true)
  })

  it('refuses when one platform of a two-platform release is unsigned', () => {
    process.env.WIN_CSC_LINK = '/tmp/certificate.pfx'

    expect(report({ platforms: ['mac', 'win'], strict: true })).toBe(false)
  })
})
