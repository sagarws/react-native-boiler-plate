import { describe, expect, it, vi } from 'vitest'

/**
 * Whether Automations come up on when the app opens — Settings → Common settings.
 *
 * The direction it falls is the opposite of developer mode's: every launch
 * switched Automations on before this existed, so an absent or unreadable value
 * must keep doing that. Only an explicit `false` opens the app with them off.
 */

const readFile = vi.hoisted(() => vi.fn())

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

const { getPreferences, initialisePreferences, setAutomationsOnAtLaunch } = await import(
  '@main/services/preferences.service'
)

const load = (contents: unknown): void => {
  readFile.mockReturnValue(typeof contents === 'string' ? contents : JSON.stringify(contents))
  initialisePreferences()
}

describe('automations at launch preference', () => {
  it('is on for a fresh installation', () => {
    readFile.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    initialisePreferences()

    expect(getPreferences().automationsOnAtLaunch).toBe(true)
  })

  it('is on for a preferences file written before it existed', () => {
    load({ version: 1, theme: 'night' })

    expect(getPreferences().automationsOnAtLaunch).toBe(true)
  })

  it('is on for an unreadable file', () => {
    load('{ not json')

    expect(getPreferences().automationsOnAtLaunch).toBe(true)
  })

  it('is off only for an explicit false', () => {
    load({ version: 1, theme: 'night', automationsOnAtLaunch: false })
    expect(getPreferences().automationsOnAtLaunch).toBe(false)

    for (const value of ['false', 0, null]) {
      load({ version: 1, theme: 'night', automationsOnAtLaunch: value })
      expect(getPreferences().automationsOnAtLaunch).toBe(true)
    }
  })

  it('remembers what Settings sets', async () => {
    load({ version: 1, theme: 'night' })

    expect((await setAutomationsOnAtLaunch(false)).automationsOnAtLaunch).toBe(false)
    expect(getPreferences().automationsOnAtLaunch).toBe(false)
  })
})
