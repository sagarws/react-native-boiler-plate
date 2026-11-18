import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Developer mode after a restart.
 *
 * Without DEV_MODE_PERSIST=true in the build, every launch opens with it OFF,
 * whatever the last session stored — the extra screens are for one sitting.
 * With it, the stored answer is honoured as before (devModePreference.test.ts).
 */

const policy = vi.hoisted(() => ({ persist: false }))
const readFile = vi.hoisted(() => vi.fn())

vi.mock('@main/config/devModePolicy', () => ({ devModePersistsAcrossRestarts: () => policy.persist }))
vi.mock('node:fs', () => ({ readFileSync: readFile }))
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn(), rename: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/trackvid-test' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { getPreferences, initialisePreferences, setDevMode } = await import('@main/services/preferences.service')

const launchWith = (stored: unknown): void => {
  readFile.mockReturnValue(JSON.stringify(stored))
  initialisePreferences()
}

beforeEach(() => {
  policy.persist = false
})

describe('developer mode on restart', () => {
  it('opens off when the build does not persist it, even if the last session left it on', () => {
    launchWith({ version: 1, theme: 'night', devMode: true })

    expect(getPreferences().devMode).toBe(false)
  })

  it('stays on across a restart when the build persists it', () => {
    policy.persist = true
    launchWith({ version: 1, theme: 'night', devMode: true })

    expect(getPreferences().devMode).toBe(true)
  })

  it('can still be switched on for the rest of the session', async () => {
    launchWith({ version: 1, theme: 'night', devMode: false })

    expect((await setDevMode(true)).devMode).toBe(true)
    expect(getPreferences().devMode).toBe(true)
  })

  it('leaves every other preference as it was stored', () => {
    launchWith({ version: 1, theme: 'night', devMode: true, myntraHeadlessLogin: true, automationsOnAtLaunch: false })

    expect(getPreferences()).toMatchObject({ devMode: false, myntraHeadlessLogin: true, automationsOnAtLaunch: false })
  })
})
