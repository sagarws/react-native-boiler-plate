import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME_SETTINGS } from '@shared/types/appearance'

/**
 * The shipped accent, which is decided in two places that must agree.
 *
 * WHY TWO. `DEFAULT_THEME_SETTINGS` is what the main process writes for a
 * machine with no preferences, so it decides what a fresh installation
 * RENDERS. `defaultSettings()` in the ported settings context reads
 * `primaryColorConfig[0]`, and it decides what the Reset button puts back and
 * whether the card thinks anything has been changed.
 *
 * THEY HAVE DRIFTED BEFORE — the note on DEFAULT_THEME_SETTINGS records it: one
 * said '#7367F0' while the list began with another colour, so a fresh
 * installation drew one swatch as selected and painted the app in a different
 * one, and Reset "changed" a setting nobody had touched.
 *
 * The config file is read as TEXT rather than imported because it lives in the
 * renderer's vendored `configs` tree, which this project compiles with the DOM
 * lib; the one fact needed here is its first entry.
 */

const configSource = readFileSync(
  resolve(__dirname, '..', 'electron/renderer/configs/primaryColorConfig.ts'),
  'utf8'
)

/** The `main` of the first preset in the list. */
const firstPresetMain = (): string => {
  const match = /const primaryColorConfig[\s\S]*?\{[\s\S]*?main:\s*'(#[0-9A-Fa-f]{6})'/.exec(
    configSource
  )

  if (!match?.[1]) throw new Error('could not read the first preset from primaryColorConfig')

  return match[1]
}

describe('the shipped primary colour', () => {
  it('is the Vercel near-black', () => {
    // Named explicitly: this is a product decision, and a test that only
    // checked the two agreed would pass just as happily if both were changed
    // to something nobody chose.
    //
    // IT WAS TrackVid teal (#0D9394) until the app was re-dressed in Vercel's
    // design language, which accents everything with a near-black. Teal is
    // still a preset, one place down the list; it is no longer what ships.
    expect(DEFAULT_THEME_SETTINGS.primaryColor.toUpperCase()).toBe('#171717')
  })

  it('is the first preset in the swatch list, so Reset puts back what ships', () => {
    expect(firstPresetMain().toUpperCase()).toBe(
      DEFAULT_THEME_SETTINGS.primaryColor.toUpperCase()
    )
  })

  it('is one of the presets, so the customiser draws it as selected', () => {
    // A default that is not in the list renders a row with nothing highlighted
    // on a fresh machine.
    const presets = [...configSource.matchAll(/main:\s*'(#[0-9A-Fa-f]{6})'/g)].map(match =>
      (match[1] ?? '').toUpperCase()
    )

    expect(presets).toContain(DEFAULT_THEME_SETTINGS.primaryColor.toUpperCase())
  })
})
