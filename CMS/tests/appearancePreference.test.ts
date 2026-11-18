import { describe, expect, it, vi } from 'vitest'

/**
 * The operator's palette, read back off disk.
 *
 * This file is read BEFORE the first window exists, which decides how it has to
 * behave when something is wrong: there is no screen to show an error on, so a
 * hand-edited JSON, a downgrade from a build with more seeds, or half a file
 * written during a power cut must all end at the palette the app ships with.
 * Never at a stack trace, and never at a half-applied palette — a page colour
 * without the text colour that was picked to sit on it is the one outcome worse
 * than ignoring both.
 */

const readFile = vi.hoisted(() => vi.fn())
const written = vi.hoisted(() => ({ body: '' }))

vi.mock('node:fs', () => ({ readFileSync: readFile }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: (_path: string, body: string) => {
    written.body = body

    return Promise.resolve()
  },
  rename: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/trackvid-test' } }))
vi.mock('@main/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}))

const { getPreferences, initialisePreferences, setAppearance } = await import(
  '@main/services/preferences.service'
)

const load = (contents: unknown): void => {
  readFile.mockReturnValue(typeof contents === 'string' ? contents : JSON.stringify(contents))
  initialisePreferences()
}

const stored = (appearance: unknown): void => load({ version: 1, theme: 'trackvid', appearance })

describe('reading a stored appearance', () => {
  it('is empty on a fresh installation', () => {
    readFile.mockImplementation(() => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    })
    initialisePreferences()

    expect(getPreferences().appearance.overrides).toEqual({})
    expect(getPreferences().appearance.density).toBe('default')
  })

  it('is empty for a file written before this existed', () => {
    load({ version: 1, theme: 'trackvid', devMode: true })

    expect(getPreferences().appearance.overrides).toEqual({})
  })

  it('keeps a palette it understands', () => {
    stored({ overrides: { trackvid: { brand: '#ff7a00', canvas: '#2b1b0f' } }, density: 'compact' })

    expect(getPreferences().appearance.overrides).toEqual({
      trackvid: { brand: '#ff7a00', canvas: '#2b1b0f' }
    })
    expect(getPreferences().appearance.density).toBe('compact')
  })

  it('drops a seed this build has never heard of, and keeps the rest', () => {
    // A file from a later build. Refusing the whole palette would punish the
    // operator for upgrading and then downgrading.
    stored({ overrides: { trackvid: { brand: '#ff7a00', tertiaryGlow: '#123456' } } })

    expect(getPreferences().appearance.overrides).toEqual({ trackvid: { brand: '#ff7a00' } })
  })

  it('drops a value that is not a colour', () => {
    stored({ overrides: { trackvid: { brand: 'cornflowerblue', canvas: '#fff', text: 42 } } })

    // `#fff` is a colour; a keyword and a number are not.
    expect(getPreferences().appearance.overrides).toEqual({ trackvid: { canvas: '#fff' } })
  })

  it('drops a theme id that is not one of ours', () => {
    stored({ overrides: { midnight: { brand: '#ff7a00' }, trackvid: { brand: '#00ff00' } } })

    expect(getPreferences().appearance.overrides).toEqual({ trackvid: { brand: '#00ff00' } })
  })

  it('drops a theme whose every seed was rubbish, rather than keeping an empty one', () => {
    stored({ overrides: { trackvid: { nonsense: 'x' } } })

    expect(getPreferences().appearance.overrides).toEqual({})
  })

  it('falls back on a scale value it does not recognise', () => {
    stored({ density: 'enormous', corner: 'pointy', font: 'comic' })

    const { appearance } = getPreferences()

    expect(appearance.density).toBe('default')
    expect(appearance.corner).toBe('default')
    expect(appearance.font).toBe('system')
  })

  it('survives an appearance that is not an object at all', () => {
    for (const rubbish of ['', 'null', '[]', '"a string"', '7']) {
      stored(JSON.parse(rubbish === '' ? 'null' : rubbish))
      expect(getPreferences().appearance.overrides, rubbish).toEqual({})
    }
  })

  it('survives a file that is not JSON', () => {
    load('{ this is half a fi')

    expect(getPreferences().appearance.overrides).toEqual({})
    expect(getPreferences().theme).toBe('trackvid')
  })
})

describe('writing an appearance', () => {
  it('sanitises on the way in as well as on the way out', async () => {
    // The renderer validates before it applies, but this file outlives the
    // renderer that wrote it and is read by builds that know a different set.
    load({ version: 1, theme: 'trackvid' })

    await setAppearance({
      version: 1,
      overrides: { trackvid: { brand: '#ff7a00', bogus: '#000000' } },
      density: 'sideways',
      corner: 'rounded',
      font: 'mono'
    })

    const { appearance } = getPreferences()

    expect(appearance.overrides).toEqual({ trackvid: { brand: '#ff7a00' } })
    expect(appearance.density).toBe('default')
    expect(appearance.corner).toBe('rounded')
  })

  it('persists it in the file, beside the other preferences', async () => {
    load({ version: 1, theme: 'trackvid', devMode: true })

    await setAppearance({ overrides: { 'trackvid-dark': { sidebar: '#101010' } } })

    const record = JSON.parse(written.body) as {
      theme: string
      devMode: boolean
      appearance: { overrides: Record<string, unknown> }
    }

    expect(record.appearance.overrides).toEqual({ 'trackvid-dark': { sidebar: '#101010' } })
    // The write must not drop what it was not asked about.
    expect(record.theme).toBe('trackvid')
    expect(record.devMode).toBe(true)
  })

  it('takes nothing at all as a reset', async () => {
    load({ version: 1, theme: 'trackvid', appearance: { overrides: { trackvid: { brand: '#f00' } } } })

    await setAppearance(undefined)

    expect(getPreferences().appearance.overrides).toEqual({})
  })
})
