import { describe, expect, it } from 'vitest'
import veylixTheme, {
  CONTROL_BLOCK_SIZE_SM,
  PAGE_GUTTER,
  TABLE_ROW_BLOCK_SIZE
} from '../../electron/renderer/theme/veylixTheme'

/**
 * The Veylix layer, which is the whole of the re-dress (renamed from the Vercel
 * layer's test; the two invariants below are carried over unchanged).
 *
 * Values are pinned to docs/veylix-tokens.md, which records each one's source
 * selector in the template CSS.
 */

const schemes = ['light', 'dark'] as const

const globals = () =>
  veylixTheme('default', 'light').components.MuiCssBaseline.styleOverrides as unknown as Record<
    string,
    Record<string, string>
  >

describe('the Veylix theme layer', () => {
  describe('leaves the accent to the operator', () => {
    /*
     * THE ONE THAT MATTERS (unchanged from the Vercel layer). The accent ships
     * as a preset in primaryColorConfig and arrives through the operator's own
     * setting. Define `palette.primary` here and Settings → Theme silently stops
     * working: the swatch moves and the screen does not.
     */
    it.each(schemes)('does not set palette.primary on %s', scheme => {
      const layer = veylixTheme('default', 'light')
      const palette = layer.colorSchemes[scheme].palette as Record<string, unknown>

      expect(palette).not.toHaveProperty('primary')
    })

    it('writes every accent as a variable of the primary, so a picked colour reaches it', () => {
      const button = veylixTheme('default', 'light').components.MuiButton.styleOverrides.root({
        ownerState: { variant: 'contained', color: 'primary' }
      })

      expect(button.backgroundImage).toContain('--mui-palette-primary-light')
      expect(button.backgroundImage).toContain('--mui-palette-primary-main')
      expect(button.color).toContain('--mui-palette-primary-contrastText')
    })
  })

  describe('keeps the colour channels neutral', () => {
    /*
     * The ported theme derives text, divider and every action state from these
     * channels. Veylix's are WARM NEUTRALS — its ink and its cream — not a hue:
     * each channel within a few points of the others.
     */
    it('sets the main colour channels to the template ink and the derived cream', () => {
      const { mainColorChannels } = veylixTheme('default', 'light')

      expect(mainColorChannels.light).toBe('37 37 31')
      expect(mainColorChannels.dark).toBe('243 236 223')
    })

    it.each(['light', 'dark'] as const)('keeps the %s channel a neutral, not a hue', key => {
      const channels = veylixTheme('default', 'light').mainColorChannels[key].split(' ').map(Number)
      const spread = Math.max(...channels) - Math.min(...channels)

      expect(spread).toBeLessThanOrEqual(20)
    })
  })

  describe('uses the template palette', () => {
    const light = () => veylixTheme('default', 'light').colorSchemes.light.palette
    const dark = () => veylixTheme('default', 'dark').colorSchemes.dark.palette

    it('sets text in the template ink and secondary', () => {
      expect(light().text.primary).toBe('#25251F')
      expect(light().text.secondary).toBe('#696B61')
    })

    it('puts the warm cream page under the light scheme', () => {
      expect(light().background.default).toBe('#E9DFCE')
      expect(light().background.paper).toBe('#FCFAF5')
    })

    it('puts a warm espresso page under the dark scheme, with cream text', () => {
      expect(dark().background.default).toBe('#1B1712')
      expect(dark().text.primary).toBe('#F3ECDF')
    })

    it('flattens the page to the solid glass colour when the skin is bordered', () => {
      const bordered = veylixTheme('bordered', 'light').colorSchemes.light.palette

      expect(bordered.background.default).toBe('#FCFAF5')
    })

    it.each([
      ['success', '#D9F5E1', '#0B7843'],
      ['info', '#E1F0FF', '#0766A6'],
      ['warning', '#FFF0B9', '#835B10'],
      ['error', '#FFEADF', '#B54124']
    ] as const)('gives %s the template badge fill and text', (tone, fill, text) => {
      const status = (light() as unknown as Record<string, { lightOpacity: string; dark: string }>)[tone]

      expect(status?.lightOpacity).toBe(fill)
      expect(status?.dark).toBe(text)
    })
  })

  describe('casts the template shadows', () => {
    it('gives MUI a full ramp so no elevation falls off the end', () => {
      expect(veylixTheme('default', 'light').shadows).toHaveLength(25)
      expect(veylixTheme('default', 'light').shadows[0]).toBe('none')
    })

    it('fills every key of the custom ramp the shell and Tailwind read', () => {
      const { customShadows } = veylixTheme('default', 'light')

      for (const key of ['xs', 'sm', 'md', 'lg', 'xl'] as const) expect(customShadows[key]).toBeTruthy()

      for (const tone of ['primary', 'secondary', 'error', 'warning', 'info', 'success'] as const) {
        // A missing entry resolves to an undefined CSS variable — an invalid
        // declaration rather than no shadow.
        expect(Object.keys(customShadows[tone]).sort()).toEqual(['lg', 'md', 'sm'])
      }
    })

    it('draws cards as glass: gradient, white edge, soft shadow, blur', () => {
      const card = veylixTheme('default', 'light').components.MuiCard.styleOverrides.root

      expect(card.backgroundImage).toBe('var(--veylix-glass)')
      expect(card.border).toBe('1px solid var(--veylix-glass-border)')
      expect(card.boxShadow).toBe('var(--veylix-shadow-glass)')
      expect(card.backdropFilter).toBe('blur(16px)')
      expect(card.borderRadius).toBe(16)
    })

    it('floats menus, popovers and dialogs on their own shadows', () => {
      const { components } = veylixTheme('default', 'light')

      expect(components.MuiMenu.styleOverrides.paper.boxShadow).toBe('var(--veylix-shadow-popover)')
      expect(components.MuiPopover.styleOverrides.paper.boxShadow).toBe('var(--veylix-shadow-popover)')
      expect(components.MuiDialog.styleOverrides.paper.boxShadow).toBe('var(--veylix-shadow-dialog)')
      expect(components.MuiDialog.styleOverrides.paper.borderRadius).toBe(23)
    })

    it.each([':root', ':root[data-dark]'])(
      'derives every accent variable from the operator primary on %s',
      key => {
        // A fixed gold here is a hard-coded accent: picking teal in Settings →
        // Theme would leave the nav pill, the title dot and selections gold.
        const vars = globals()[key] ?? {}

        for (const name of [
          '--veylix-nav-active',
          '--veylix-nav-active-text',
          '--veylix-nav-bar',
          '--veylix-accent-text',
          '--veylix-accent-wash',
          '--veylix-title-dot',
          '--veylix-row-hover',
          '--veylix-avatar'
        ]) {
          expect(vars[name]).toContain('--mui-palette-primary-')
        }
      }
    )

    it('defines every surface variable in both schemes', () => {
      const g = globals()
      const lightKeys = Object.keys(g[':root'] ?? {}).filter(key => key.startsWith('--veylix-'))
      const darkKeys = Object.keys(g[':root[data-dark]'] ?? {})

      expect(lightKeys.length).toBeGreaterThan(30)
      expect(darkKeys.sort()).toEqual(lightKeys.sort())
    })
  })

  describe('keeps every table, field and chip on one scale', () => {
    it('gives the header and the body one row height', () => {
      const g = globals()

      expect(TABLE_ROW_BLOCK_SIZE).toBe(40)
      expect(g['table thead th']?.['blockSize']).toBe(`${TABLE_ROW_BLOCK_SIZE}px !important`)
      expect(g['table tbody th, table tbody td']?.['blockSize']).toBe(`${TABLE_ROW_BLOCK_SIZE}px !important`)
    })

    it('draws the header as a quiet label row, not uppercase', () => {
      const th = globals()['table thead th']

      expect(th?.['textTransform']).toBe('none')
      expect(th?.['fontWeight']).toBe('600 !important')
      expect(th?.['backgroundColor']).toContain('--mui-palette-customColors-tableHeaderBg')
    })

    it('tints body rows in the template five-step cycle', () => {
      const g = globals()

      for (let step = 1; step <= 5; step += 1) {
        expect(g[`table:has(> thead) > tbody > tr:nth-of-type(5n + ${step})`]?.['--veylix-row']).toBe(
          `var(--veylix-row-${step})`
        )
      }
    })

    it('makes a small field the height of a small button, at 13px', () => {
      const field = globals()['.MuiInputBase-root.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline)']

      expect(CONTROL_BLOCK_SIZE_SM).toBe(32)
      expect(field?.['blockSize']).toBe(`${CONTROL_BLOCK_SIZE_SM}px`)
      expect(field?.['fontSize']).toBe('0.8125rem !important')
    })

    it("makes every small button the small field's height", () => {
      const button = veylixTheme('default', 'light').components.MuiButton.styleOverrides as unknown as Record<
        string,
        Record<string, string>
      >

      expect(button['sizeSmall']?.['minBlockSize']).toBe(`${CONTROL_BLOCK_SIZE_SM}px`)
    })

    it('sets small chips in the same 13px', () => {
      const chip = veylixTheme('default', 'light').components.MuiChip.styleOverrides as unknown as Record<
        string,
        Record<string, string>
      >

      expect(chip['sizeSmall']?.['fontSize']).toBe('0.8125rem !important')
    })

    it('pads every page by the template shell inset', () => {
      expect(PAGE_GUTTER).toBe(16)
      expect(globals()['.ts-vertical-layout-content']?.['padding']).toBe(`${PAGE_GUTTER}px !important`)
    })

    it('overrides the ported 2px focus ring back to 1px', () => {
      expect(globals()['.MuiInputBase-root.Mui-focused']?.['borderWidth']).toBe('1px !important')
    })

    it('pitches medium inputs at main text, not the ported 17px', () => {
      expect(globals()['.MuiInputBase-root:not(.MuiInputBase-sizeSmall)']?.['fontSize']).toBe(
        '0.875rem !important'
      )
    })
  })

  describe('draws the two template buttons', () => {
    const root = (variant: string, color: string) =>
      veylixTheme('default', 'light').components.MuiButton.styleOverrides.root({
        ownerState: { variant, color }
      })

    it('gives the secondary button the white control and its edge', () => {
      const style = root('tonal', 'secondary')

      expect(style.backgroundColor).toBe('var(--veylix-control) !important')
      expect(style.border).toBe('1px solid var(--mui-palette-Chip-defaultBorder)')
      // The ported tonal fill is a `variants` entry, applied after root.
      expect(style.color).toContain('!important')
    })

    it('rounds every button to the template 10px', () => {
      expect(root('contained', 'primary').borderRadius).toBe(10)
      expect(root('outlined', 'secondary').borderRadius).toBe(10)
    })

    it('leaves non-primary contained buttons to their own colour', () => {
      expect(root('contained', 'error').backgroundImage).toBeUndefined()
    })
  })

  describe('never paints a filter chip as a slab', () => {
    const chip = (variant: string, color: string) =>
      veylixTheme('default', 'light').components.MuiChip.styleOverrides.root({
        ownerState: { variant, color }
      })

    it('marks the selected filter with the gold wash, not a solid fill', () => {
      const selected = chip('filled', 'primary')

      expect(selected.backgroundColor).toBe('var(--veylix-accent-wash) !important')
      expect(selected.backgroundColor).not.toContain('primary-main')
    })

    it('gives the unselected filter a white pill on an edge', () => {
      const idle = chip('tonal', 'secondary')

      expect(idle.backgroundColor).toBe('var(--veylix-control) !important')
      expect(idle.border).toBe('1px solid var(--mui-palette-Chip-defaultBorder)')
    })

    it.each(['info', 'success', 'warning', 'error'])('tints %s as a template badge', tone => {
      const style = chip('tonal', tone)

      expect(style.backgroundColor).toBe(`var(--mui-palette-${tone}-lightOpacity) !important`)
      expect(style.color).toBe(`var(--mui-palette-${tone}-dark) !important`)
      expect(style.border).toBe('none')
    })

    it('lifts the label on the dark scheme, where `dark` would sink into the fill', () => {
      const darkRule = chip('tonal', 'info')['[data-dark] &']

      expect(darkRule?.color).toBe('var(--mui-palette-info-light) !important')
    })
  })

  describe("speaks in the template's voice", () => {
    const type = () => veylixTheme('default', 'light').typography

    it('never shouts in capitals', () => {
      expect(type().button.textTransform).toBe('none')
      expect(type().overline.textTransform).toBe('none')
    })

    it('sets headings heavy and tight', () => {
      expect(type().h1.fontWeight).toBe(800)
      expect(type().h1.letterSpacing.startsWith('-')).toBe(true)
      // `.commerce-heading h1`: 28px, 750.
      expect(type().h3.fontSize).toBe('1.75rem')
      expect(type().h3.fontWeight).toBe(750)
    })

    it('keeps main text on the Tailwind steps', () => {
      expect(type().body1.fontSize).toBe('0.875rem')
      expect(type().body2.fontSize).toBe('0.8125rem')
      expect(type().caption.fontSize).toBe('0.75rem')
    })

    it('never puts two roles on the same step by accident', () => {
      const t = type()
      const steps = [
        t.caption.fontSize,
        t.body2.fontSize,
        t.body1.fontSize,
        t.h6.fontSize,
        t.h5.fontSize,
        t.h4.fontSize,
        t.h3.fontSize,
        t.h2.fontSize,
        t.h1.fontSize
      ]

      expect(new Set(steps).size).toBe(steps.length)
      const px = steps.map(step => parseFloat(step))
      expect([...px].sort((a, b) => a - b)).toEqual(px)
    })
  })
})
