import { describe, expect, it, vi } from 'vitest'

/**
 * Developer mode, remembered per installation.
 *
 * The password is verified on the SERVER and never reaches this app — what is
 * kept here is only the answer. These pin the reading of that stored answer,
 * because the direction it falls when something is wrong is the whole safety of
 * the thing: an unreadable or absent value must mean OFF, since off is the
 * state that hides the extra screens.
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

const { getPreferences, initialisePreferences, setDevMode } = await import(
  '@main/services/preferences.service'
)

const load = (contents: unknown): void => {
  readFile.mockReturnValue(
    typeof contents === 'string' ? contents : JSON.stringify(contents)
  )
  initialisePreferences()
}

describe('developer mode preference', () => {
  it('is off on a fresh installation', () => {
    readFile.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    initialisePreferences()

    expect(getPreferences().devMode).toBe(false)
  })

  it('is off for a preferences file written before it existed', () => {
    // Every installation upgrading into this has one of these.
    load({ version: 1, theme: 'night' })

    expect(getPreferences().devMode).toBe(false)
  })

  it('is on only for an explicit true', () => {
    load({ version: 1, theme: 'night', devMode: true })
    expect(getPreferences().devMode).toBe(true)

    // Anything else reads as off. A file somebody has been at by hand must not
    // turn the extra screens on with a truthy string.
    for (const value of ['true', 1, {}, null]) {
      load({ version: 1, theme: 'night', devMode: value })
      expect(getPreferences().devMode).toBe(false)
    }
  })

  it('is off when the file cannot be parsed at all', () => {
    load('{ not json')

    expect(getPreferences().devMode).toBe(false)
  })

  it('keeps the theme when developer mode changes', async () => {
    load({ version: 1, theme: 'night', devMode: false })

    // Read back rather than asserted against a literal: the file's theme id is
    // validated on load, so what is stored is not necessarily what was written.
    // The property under test is that toggling one preference leaves the other
    // alone.
    const before = getPreferences().theme
    const after = await setDevMode(true)

    // toMatchObject, not toEqual: this test is about developer mode not
    // disturbing the theme, and it should not fail every time an unrelated
    // preference is added beside them.
    expect(after).toMatchObject({ theme: before, devMode: true })
  })

  it('can be turned off again', async () => {
    load({ version: 1, theme: 'night', devMode: true })

    expect((await setDevMode(false)).devMode).toBe(false)
  })
})
