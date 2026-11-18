import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Visible Login info — Settings → Common settings.
 *
 * Off unless explicitly on, and the main process is the gate: with it off, no
 * password leaves for the renderer, whatever the renderer asks for. With it on,
 * every saved password shows — refused logins and manual platforms included.
 */

const readFile = vi.hoisted(() => vi.fn())
const autoLoginEnabled = vi.hoisted(() => vi.fn())
const credentialsFor = vi.hoisted(() => vi.fn())

vi.mock('node:fs', () => ({ readFileSync: readFile }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  rename: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/trackvid-test' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))
vi.mock('@main/services/automationRouting.service', () => ({ autoLoginEnabled }))
vi.mock('@main/services/company.service', () => ({ credentialsFor, credentialFor: vi.fn() }))
vi.mock('@main/services/httpClient', () => ({ apiRequest: vi.fn() }))
vi.mock('@main/services/session.store', () => ({ getAccessToken: () => null }))

const { getPreferences, initialisePreferences, setShowLoginInfo } = await import(
  '@main/services/preferences.service'
)
const { revealCredentialPassword } = await import('@main/services/credentialSecret.service')

const load = (contents: unknown): void => {
  readFile.mockReturnValue(typeof contents === 'string' ? contents : JSON.stringify(contents))
  initialisePreferences()
}

describe('visible login info preference', () => {
  it('is off for a fresh installation, an old file and an unreadable one', () => {
    readFile.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    initialisePreferences()
    expect(getPreferences().showLoginInfo).toBe(false)

    load({ version: 1, theme: 'night' })
    expect(getPreferences().showLoginInfo).toBe(false)

    load('{ not json')
    expect(getPreferences().showLoginInfo).toBe(false)
  })

  it('is on only for an explicit true', () => {
    load({ version: 1, theme: 'night', showLoginInfo: true })
    expect(getPreferences().showLoginInfo).toBe(true)

    for (const value of ['true', 1, null]) {
      load({ version: 1, theme: 'night', showLoginInfo: value })
      expect(getPreferences().showLoginInfo).toBe(false)
    }
  })
})

describe('revealCredentialPassword', () => {
  beforeEach(() => {
    load({ version: 1, theme: 'night' })
    autoLoginEnabled.mockReset().mockResolvedValue(true)
    credentialsFor.mockReset().mockResolvedValue([{ username: 'A@b.com', password: 'hunter2' }])
  })

  it('refuses while the setting is off, without reading the password', async () => {
    const result = await revealCredentialPassword({ platform: 'nykaa', username: 'a@b.com' })

    expect(result.success).toBe(false)
    expect(credentialsFor).not.toHaveBeenCalled()
  })

  it('returns only the password once the setting is on', async () => {
    await setShowLoginInfo(true)

    const result = await revealCredentialPassword({ platform: 'Nykaa', username: ' a@b.com ' })

    expect(result).toEqual({ success: true, data: { password: 'hunter2' } })
    // Refused logins are the ones being fixed, so they are read too.
    expect(credentialsFor).toHaveBeenCalledWith('nykaa', { includeRefused: true })
  })

  it('shows the password on a platform whose auto-login is off', async () => {
    await setShowLoginInfo(true)
    autoLoginEnabled.mockResolvedValue(false)

    const result = await revealCredentialPassword({ platform: 'myntra', username: 'a@b.com' })

    expect(result).toEqual({ success: true, data: { password: 'hunter2' } })
  })

  it('refuses a malformed payload', async () => {
    await setShowLoginInfo(true)

    for (const payload of [null, {}, { platform: 'nykaa' }, { platform: 1, username: 'a@b.com' }]) {
      expect((await revealCredentialPassword(payload)).success).toBe(false)
    }
  })
})
