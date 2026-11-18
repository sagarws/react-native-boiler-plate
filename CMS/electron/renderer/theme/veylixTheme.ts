/**
 * THE VEYLIX LAYER — the app's look, as one theme-shaped object.
 *
 * WHAT THIS IS. A theme-shaped object deep-merged ON TOP of `@core/theme`
 * (Monitor's ported theme) in `VuexyThemeProvider.tsx`, in the place
 * the Vercel layer (`vercelTheme.ts`, removed) used to occupy. Same mechanism,
 * same position, same exports.
 *
 * WHERE THE VALUES COME FROM. Every colour, corner, shadow and size below is
 * copied from the Veylix template's CSS and recorded, with its source selector,
 * in `docs/veylix-tokens.md`. Nothing here is from memory. The dark scheme is
 * the one exception: the template has none, so it is DERIVED from the light
 * tokens (warm espresso surfaces, cream text, the same gold) and the derivation
 * is recorded in the same file.
 *
 * WHAT VEYLIX LOOKS LIKE, in one paragraph: a warm cream page with a soft
 * gradient; glass cards (a white-to-cream gradient, a 1px white edge, a 16px
 * corner, a soft warm shadow, a backdrop blur); a gold accent used as a FILL
 * with dark-brown text on it rather than as a text colour; pastel status pills;
 * tables whose rows are tinted bands; Manrope at heavy heading weights.
 *
 * THE OPERATOR'S CHOICES STILL WIN. This layer never defines `palette.primary`
 * (pinned by tests/renderer/veylixTheme.test.ts). The gold ships as the first
 * entry of `primaryColorConfig`, and every accent below is written as a CSS
 * variable of the primary — so picking teal in Settings → Theme turns the gold
 * gradient button teal, and nothing else moves.
 */

// MUI Imports
import { lighten } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'

// Type Imports
import type { Skin, SystemMode } from '@core/types'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

/** The two schemes' surfaces and text. Light = template; dark = derived. */
const VEYLIX = {
  light: {
    /** `body` background colour, under the gradient below. */
    page: '#E9DFCE',
    /** The solid glass fallback — `.solid-glass .glass-card`. MUI's paper. */
    paper: '#FCFAF5',
    /** The hairline: `.c-details > div`, `.c-form fieldset`. */
    border: '#E9DFCE',
    /** The secondary button's edge — `.secondary-button`. */
    controlBorder: '#E4DECE',
    /** An input's resting edge — `.c-field input`. */
    inputBorder: '#E1D7C5',
    text: '#25251F',
    textSecondary: '#696B61',
    /** Placeholder — `.c-field input::placeholder`. */
    textTertiary: '#958B78',
    /** `.icon-button:hover`. */
    hover: '#C7BCA426',
    /** `.header-popover [aria-checked=true]`. */
    selected: '#FFE9B3A8'
  },
  dark: {
    page: '#1B1712',
    paper: '#221D16',
    border: '#3A3226',
    controlBorder: '#4A4032',
    inputBorder: '#4A4032',
    text: '#F3ECDF',
    textSecondary: '#B9B09F',
    textTertiary: '#8F8676',
    hover: '#FFF3DC14',
    selected: '#5A451566'
  }
} as const

/**
 * Status colours. `main` is the template's saturated tone (status dot, tile
 * icon, amber fill); `dark` is its badge TEXT; `lightOpacity` is its badge
 * FILL — so a tonal chip renders exactly as `.badge-success` / `.badge-info` /
 * `.badge-amber` / `.badge-danger`.
 */
const STATUS = {
  light: {
    success: { main: '#34BF78', dark: '#0B7843', fill: '#D9F5E1', contrastText: '#FFFFFF' },
    info: { main: '#187CB5', dark: '#0766A6', fill: '#E1F0FF', contrastText: '#FFFFFF' },
    warning: { main: '#F6B727', dark: '#835B10', fill: '#FFF0B9', contrastText: '#49340B' },
    error: { main: '#D35B37', dark: '#B54124', fill: '#FFEADF', contrastText: '#FFFFFF' }
  },
  dark: {
    success: { main: '#4FCB8A', dark: '#7FDAA6', fill: '#1D3B2A', contrastText: '#0F1F16' },
    info: { main: '#4C9FD3', dark: '#8CC4F0', fill: '#1B2F42', contrastText: '#0D1823' },
    warning: { main: '#F6B727', dark: '#F3CD6A', fill: '#3B3016', contrastText: '#2A1E05' },
    error: { main: '#E27A5A', dark: '#F3A088', fill: '#432419', contrastText: '#22100A' }
  }
} as const

type StatusKey = keyof (typeof STATUS)['light']

const statusFor = (mode: 'light' | 'dark') =>
  (Object.keys(STATUS[mode]) as StatusKey[]).reduce<
    Record<string, { main: string; light: string; dark: string; contrastText: string; lightOpacity: string }>
  >((acc, key) => {
    const seed = STATUS[mode][key]

    acc[key] = {
      main: seed.main,
      // In dark the `light` step carries pill labels (see MuiChip), so it is
      // the readable one there.
      light: mode === 'light' ? lighten(seed.main, 0.25) : seed.dark,
      dark: seed.dark,
      contrastText: seed.contrastText,
      lightOpacity: seed.fill
    }

    return acc
  }, {})

/**
 * The text/divider/action channel. WARM NEUTRAL, not a hue: the template's ink
 * (#25251F) and the derived cream (#F3ECDF). The ported theme derives every
 * `action.*` state and several hundred greys as an opacity on these.
 */
const MAIN_COLOR_CHANNELS = {
  light: '37 37 31',
  dark: '243 236 223',
  lightShadow: '117 94 45',
  darkShadow: '0 0 0'
} as const

/**
 * Corners, from the template: 7px badge, 10px button/control, 13px nav link
 * and toast, 16px card, 20px popover, 23px dialog.
 */
const RADIUS = { xs: 4, sm: 7, md: 10, lg: 13, xl: 16 } as const
const POPOVER_RADIUS = 20
const DIALOG_RADIUS = 23

/** One row height for every data table, header included. Exported for tests. */
export const TABLE_ROW_BLOCK_SIZE = 40

/** A small input, the same height MUI gives a small button. */
export const CONTROL_BLOCK_SIZE_SM = 32

/** Space between the page's edge and its content — the template's `--shell-inset`. */
export const PAGE_GUTTER = 16

/** The template's surfaces as CSS variables, one set per scheme. */
const SURFACE_VARS = {
  light: {
    '--veylix-page-bg':
      'radial-gradient(at 2% 12%, #b7a48766, #0000 42%), radial-gradient(at 58% 58%, #ffe4a352, #0000 48%), radial-gradient(at 100% 22%, #f9f7f1cf, #0000 46%), linear-gradient(115deg, #dfd2bd, #f4ecdd 40%, #e8dec9 75%, #f4eee3)',
    '--veylix-glass': 'linear-gradient(135deg, #fffdf9ed, #fffef9c2)',
    '--veylix-glass-solid': '#FCFAF5',
    '--veylix-glass-border': '#fffffff2',
    '--veylix-shadow-glass': '0 5px 18px -9px #775e2d24, inset 0 1px 0 #fff',
    '--veylix-tile': 'linear-gradient(130deg, #fffaf0bd, #ffffffa3)',
    '--veylix-shadow-tile': '0 7px 17px #735b2510',
    '--veylix-chrome': 'linear-gradient(135deg, #fffefab8, #d7c4aa6b 48%, #faf4e89e)',
    '--veylix-chrome-border': '#ffffffe6',
    '--veylix-chrome-shadow': '0 8px 28px -14px #6649244d, inset 0 1px 2px #fffffff2, inset 0 -1px 1px #ad895626',
    '--veylix-chrome-scrolled': '#eee5d6f5',
    '--veylix-popover': 'linear-gradient(135deg, #fffcf7fa, #f4ead9fa)',
    '--veylix-shadow-popover': '0 18px 45px #59442629, inset 0 1px 1px #fff',
    '--veylix-dialog': '#fcfaf3f7',
    '--veylix-dialog-border': '#ffffff',
    '--veylix-shadow-dialog': '0 25px 100px #58462235',
    '--veylix-backdrop': '#40371f33',
    '--veylix-hairline-soft': '#cabc9c36',
    '--veylix-control': '#ffffff',
    '--veylix-input': '#fffdf6bf',
    '--veylix-search': '#f3efe55c',
    '--veylix-search-border': '#e7decca6',
    '--veylix-nav-active': 'linear-gradient(115deg, rgb(var(--mui-palette-primary-lightChannel) / 0.94), rgb(var(--mui-palette-primary-lightChannel) / 0.42))',
    '--veylix-nav-active-border': '#fffde9',
    '--veylix-nav-active-text': 'color-mix(in srgb, var(--mui-palette-primary-main) 30%, #25251f)',
    '--veylix-nav-active-shadow': '0 3px 9px rgb(var(--mui-palette-primary-mainChannel) / 0.19), inset 0 1px 4px #fff9',
    '--veylix-nav-bar': 'var(--mui-palette-primary-main)',
    '--veylix-nav-hover': '#fff7',
    '--veylix-nav-text': '#524e44',
    '--veylix-accent-text': 'color-mix(in srgb, var(--mui-palette-primary-main) 50%, #25251f)',
    '--veylix-accent-wash': 'rgb(var(--mui-palette-primary-lightChannel) / 0.6)',
    '--veylix-title-dot': 'var(--mui-palette-primary-main)',
    '--veylix-avatar': 'linear-gradient(120deg, var(--mui-palette-primary-light), var(--mui-palette-primary-main))',
    '--veylix-avatar-text': 'var(--mui-palette-primary-contrastText)',
    '--veylix-toast': '#fffdf6',
    '--veylix-toast-border': '#eee0bc',
    '--veylix-shadow-toast': '0 10px 40px #62532933',
    '--veylix-empty-icon': '#c7a654',
    '--veylix-empty-title': '#474235',
    '--veylix-form-note': '#f0eadc',
    '--veylix-form-note-text': '#74664b',
    '--veylix-row-1': '#e2f4e9a6',
    '--veylix-row-2': '#e6eff8a6',
    '--veylix-row-3': '#f1e9f5a6',
    '--veylix-row-4': '#fbede0b3',
    '--veylix-row-5': '#f6f1dcb8',
    '--veylix-row-hover': 'rgb(var(--mui-palette-primary-lightChannel) / 0.3)',
    '--veylix-tile-amber': 'linear-gradient(130deg, #fff0b8, #ffdc72)',
    '--veylix-tile-amber-text': '#95610d',
    '--veylix-scrollbar': '#a8906780'
  },
  dark: {
    '--veylix-page-bg':
      'radial-gradient(at 2% 12%, #5a462c66, #0000 42%), radial-gradient(at 58% 58%, #6b501c33, #0000 48%), linear-gradient(115deg, #17140f, #221c15 40%, #1a1611 75%, #211b14)',
    '--veylix-glass': 'linear-gradient(135deg, #2a241ced, #231e17c2)',
    '--veylix-glass-solid': '#221D16',
    '--veylix-glass-border': '#ffffff14',
    '--veylix-shadow-glass': '0 5px 18px -9px #00000080, inset 0 1px 0 #ffffff0f',
    '--veylix-tile': 'linear-gradient(130deg, #2c261dbd, #241f18a3)',
    '--veylix-shadow-tile': '0 7px 17px #00000040',
    '--veylix-chrome': 'linear-gradient(135deg, #2c251cb8, #3a2f216b 48%, #241e17b8)',
    '--veylix-chrome-border': '#ffffff1a',
    '--veylix-chrome-shadow': '0 8px 28px -14px #000000b3, inset 0 1px 2px #ffffff14, inset 0 -1px 1px #00000040',
    '--veylix-chrome-scrolled': '#211c15f5',
    '--veylix-popover': 'linear-gradient(135deg, #2a241cfa, #201b14fa)',
    '--veylix-shadow-popover': '0 18px 45px #00000080, inset 0 1px 1px #ffffff14',
    '--veylix-dialog': '#221d16f7',
    '--veylix-dialog-border': '#ffffff1f',
    '--veylix-shadow-dialog': '0 25px 100px #00000099',
    '--veylix-backdrop': '#0000008c',
    '--veylix-hairline-soft': '#ffffff14',
    '--veylix-control': '#2a241c',
    '--veylix-input': '#1f1a14bf',
    '--veylix-search': '#ffffff0a',
    '--veylix-search-border': '#ffffff1a',
    '--veylix-nav-active': 'linear-gradient(115deg, rgb(var(--mui-palette-primary-mainChannel) / 0.36), rgb(var(--mui-palette-primary-mainChannel) / 0.2))',
    '--veylix-nav-active-border': '#ffe3871f',
    '--veylix-nav-active-text': 'color-mix(in srgb, var(--mui-palette-primary-main) 45%, #ffffff)',
    '--veylix-nav-active-shadow': '0 3px 9px #00000059, inset 0 1px 4px #ffffff14',
    '--veylix-nav-bar': 'var(--mui-palette-primary-main)',
    '--veylix-nav-hover': '#ffffff0f',
    '--veylix-nav-text': '#d8cfbf',
    '--veylix-accent-text': 'color-mix(in srgb, var(--mui-palette-primary-main) 70%, #ffffff)',
    '--veylix-accent-wash': 'rgb(var(--mui-palette-primary-mainChannel) / 0.28)',
    '--veylix-title-dot': 'var(--mui-palette-primary-main)',
    '--veylix-avatar': 'linear-gradient(120deg, var(--mui-palette-primary-light), var(--mui-palette-primary-main))',
    '--veylix-avatar-text': 'var(--mui-palette-primary-contrastText)',
    '--veylix-toast': '#2a241c',
    '--veylix-toast-border': '#4a4032',
    '--veylix-shadow-toast': '0 10px 40px #00000080',
    '--veylix-empty-icon': '#c7a654',
    '--veylix-empty-title': '#f3ecdf',
    '--veylix-form-note': '#2e271e',
    '--veylix-form-note-text': '#d9c9a8',
    '--veylix-row-1': '#1f3a2b80',
    '--veylix-row-2': '#1f2e3d80',
    '--veylix-row-3': '#33263a80',
    '--veylix-row-4': '#3d2b1c80',
    '--veylix-row-5': '#37301c80',
    '--veylix-row-hover': 'rgb(var(--mui-palette-primary-mainChannel) / 0.2)',
    '--veylix-tile-amber': 'linear-gradient(130deg, #5a4515, #6b5218)',
    '--veylix-tile-amber-text': '#ffe7a3',
    '--veylix-scrollbar': '#ffffff33'
  }
} as const

/**
 * MUI's 25-step elevation ramp, in the template's shadows: a glass card's at
 * the low end, a popover's in the middle and a dialog's at the top. A full
 * ramp, because MUI indexes it directly.
 */
const rampFor = (mode: SystemMode): string[] => {
  const glass = mode === 'dark' ? '0 5px 18px -9px #00000080' : '0 5px 18px -9px #775e2d24'
  const tile = mode === 'dark' ? '0 7px 17px #00000040' : '0 7px 17px #735b2510'
  const pop = mode === 'dark' ? '0 18px 45px #00000080' : '0 18px 45px #59442629'
  const dialog = mode === 'dark' ? '0 25px 100px #00000099' : '0 25px 100px #58462235'

  return ['none', ...Array.from({ length: 24 }, (_, i) => (i < 4 ? glass : i < 8 ? tile : i < 16 ? pop : dialog))]
}

/** The ported theme's own shadow key — the shell and Tailwind's `shadow-*` read it. */
const customShadowsFor = (mode: SystemMode) => {
  const ramp = rampFor(mode)
  const tone = {
    sm: 'none',
    md: 'none',
    lg: 'none'
  }

  return {
    xs: ramp[1] as string,
    sm: ramp[1] as string,
    md: ramp[5] as string,
    lg: ramp[9] as string,
    xl: ramp[17] as string,
    // The primary button's own lift — `.primary-button`.
    primary: {
      sm: '0 3px 6px #c28c1721',
      md: '0 3px 6px #c28c1721',
      lg: '0 3px 6px #c28c1721'
    },
    secondary: tone,
    error: tone,
    warning: tone,
    info: tone,
    success: tone
  }
}

/** One row of a dropdown — `.header-popover [role=menuitem]`, compacted to the table's 13px. */
const DROPDOWN_ROW = {
  minHeight: 34,
  paddingBlock: 7,
  paddingInline: 10,
  gap: 10,
  borderRadius: 10,
  fontSize: '0.8125rem',
  lineHeight: 1.4,
  color: 'var(--mui-palette-text-primary)'
} as const

/** Tabler's `check`, as a mask (same path as `.tabler-check` in styles/icons.css). */
const CHECK_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='m5 12l5 5L20 7'/%3E%3C/svg%3E\")"

/** Chip colours that mean something and stay tinted (`.badge-*`). */
const TINTED_TONES = ['primary', 'info', 'success', 'warning', 'error'] as const

type TintedTone = (typeof TINTED_TONES)[number]

/** Glass, as one declaration block — `.glass-card`. */
const GLASS = {
  backgroundColor: 'var(--veylix-glass-solid)',
  backgroundImage: 'var(--veylix-glass)',
  border: '1px solid var(--veylix-glass-border)',
  boxShadow: 'var(--veylix-shadow-glass)',
  WebkitBackdropFilter: 'blur(16px)',
  backdropFilter: 'blur(16px)'
} as const

/** One scheme's palette overrides. */
const paletteFor = (mode: 'light' | 'dark', skin: Skin) => {
  const c = VEYLIX[mode]

  return {
    palette: {
      ...statusFor(mode),
      secondary: {
        main: c.textSecondary,
        light: c.textTertiary,
        dark: mode === 'light' ? '#50534A' : '#D8CFBF',
        contrastText: mode === 'light' ? '#FFFFFF' : '#1B1712'
      },
      text: {
        primary: c.text,
        secondary: c.textSecondary,
        disabled: c.textTertiary
      },
      divider: c.border,
      background: {
        // `bordered` drops the gradient page for the solid glass colour.
        default: skin === 'bordered' ? c.paper : c.page,
        paper: c.paper
      },
      action: {
        hover: c.hover,
        selected: c.selected,
        focus: mode === 'light' ? '#C7BCA440' : '#FFF3DC24'
      },
      customColors: {
        bodyBg: skin === 'bordered' ? c.paper : c.page,
        chatBg: c.paper,
        greyLightBg: c.paper,
        inputBorder: c.inputBorder,
        // The card's own solid colour: the template's header row sits on the
        // card, and a sticky header has to be opaque or rows show through it.
        tableHeaderBg: c.paper,
        tooltipText: mode === 'light' ? '#FFFDF6' : '#25251F',
        trackBg: mode === 'light' ? '#DADCD24D' : '#FFFFFF1A'
      },
      Avatar: { defaultBg: mode === 'light' ? '#EAEAE4' : '#3A3226' },
      Chip: { defaultBorder: c.controlBorder },
      FilledInput: {
        bg: mode === 'light' ? '#FFFDF6BF' : '#1F1A14BF',
        hoverBg: mode === 'light' ? '#FFFDF6' : '#2A241C',
        disabledBg: c.paper
      },
      SnackbarContent: {
        bg: mode === 'light' ? '#FFFDF6' : '#2A241C',
        color: c.text
      },
      Tooltip: { bg: mode === 'light' ? '#302D24' : '#F3ECDF' }
    }
  }
}

/** A selector that only matches while the dark scheme is live. */
const DARK = '[data-dark]'

/**
 * The layer itself.
 *
 * @param skin  The operator's skin — `bordered` drops the gradient page.
 * @param mode  Which scheme is live, for the shadow ramps (not a colour-scheme
 *              value in MUI, so they cannot vary by scheme on their own).
 */
const veylixTheme = (skin: Skin, mode: SystemMode) => ({
  colorSchemes: {
    light: paletteFor('light', skin),
    dark: paletteFor('dark', skin)
  },

  mainColorChannels: MAIN_COLOR_CHANNELS,

  shape: {
    borderRadius: RADIUS.md,
    customBorderRadius: RADIUS
  },

  shadows: rampFor(mode),

  customShadows: customShadowsFor(mode),

  /*
   * ONE TYPE SCALE, on Tailwind's steps (the 233 `text-sm`/`text-xs` usages
   * stay right): 12 / 13 / 14 / 16 / 17 / 20 / 28 / 32 / 40.
   *
   * Veylix's sizes: 14px body, 17px card heading (`--font-heading`), 28px page
   * title (`.commerce-heading h1`, weight 750, −0.8px), up to 40px for the
   * dashboard title (weight 800, −1.6px). Dense table text stays at 13px —
   * the CMS shows 25 claims a page, the template shows 8 products.
   */
  typography: {
    fontWeightMedium: 600,
    fontWeightBold: 750,
    h1: { fontSize: '2.5rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.04em' },
    h2: { fontSize: '2rem', fontWeight: 800, lineHeight: 1.2, letterSpacing: '-0.035em' },
    h3: { fontSize: '1.75rem', fontWeight: 750, lineHeight: 1.25, letterSpacing: '-0.0286em' },
    h4: { fontSize: '1.25rem', fontWeight: 750, lineHeight: 1.35, letterSpacing: '-0.02em' },
    h5: { fontSize: '1.0625rem', fontWeight: 750, lineHeight: 1.4, letterSpacing: '-0.015em' },
    h6: { fontSize: '1rem', fontWeight: 750, lineHeight: 1.45, letterSpacing: '-0.01em' },
    subtitle1: { fontSize: '0.875rem', fontWeight: 650, lineHeight: 1.5, letterSpacing: '0' },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 650, lineHeight: 1.5, letterSpacing: '0' },
    body1: { fontSize: '0.875rem', lineHeight: 1.6, letterSpacing: '0' },
    body2: { fontSize: '0.8125rem', lineHeight: 1.55, letterSpacing: '0' },
    button: {
      fontSize: '0.875rem',
      fontWeight: 800,
      lineHeight: 1.5,
      letterSpacing: '0',
      textTransform: 'none' as const
    },
    caption: { fontSize: '0.75rem', lineHeight: 1.5, letterSpacing: '0' },
    overline: {
      fontSize: '0.75rem',
      fontWeight: 650,
      lineHeight: 1.5,
      letterSpacing: '0.02em',
      textTransform: 'none' as const
    }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          ...SURFACE_VARS.light,
          // A toast is rendered outside MUI; it reads its lift from here.
          '--trackvid-overlay-shadow': 'var(--veylix-shadow-toast)'
        },
        [`:root${DARK}`]: SURFACE_VARS.dark,

        body: {
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
          // `document.css body`: the warm gradient, fixed so it does not scroll.
          ...(skin !== 'bordered' && {
            backgroundImage: 'var(--veylix-page-bg)',
            backgroundAttachment: 'fixed'
          })
        },

        '::selection': { backgroundColor: 'var(--mui-palette-primary-lightOpacity)' },

        /*
         * KEYBOARD FOCUS IS ALWAYS VISIBLE. The ported menu and MUI's ButtonBase
         * both set `outline: 0`, so tabbing through the rail or a toolbar moved
         * focus with nothing on screen to show where it was. One ring, in the
         * operator's primary, for keyboard focus only (`:focus-visible` /
         * `.Mui-focusVisible`) — a mouse click shows nothing. Inputs keep their
         * own focused edge (MuiOutlinedInput).
         */
        'a:focus-visible, button:focus-visible, [role="button"]:focus-visible, [role="tab"]:focus-visible, [role="menuitem"]:focus-visible, .Mui-focusVisible:not(.MuiInputBase-root):not(.MuiInputBase-input)':
          {
            outline: '2px solid rgb(var(--mui-palette-primary-mainChannel) / 0.85) !important',
            outlineOffset: '2px'
          },

        /*
         * A plain <button> with no fill of its own: no browser "ButtonFace".
         * Tailwind's preflight is not loaded here, so a hand-written tab or
         * icon button fell back to the platform's grey — invisible on cream,
         * a cold slab on the warm dark scheme. Utilities are layered with
         * `important`, so any button that sets a background still wins.
         */
        'button:not(.MuiButtonBase-root)': {
          backgroundColor: 'transparent',
          color: 'inherit'
        },

        // `input[type=checkbox] { accent-color }` — for the few native ones.
        'input[type="checkbox"], input[type="radio"]': {
          accentColor: 'var(--mui-palette-primary-dark)'
        },

        // `.table-scroll` / `.navigation` scrollbars: thin and warm.
        '*': { scrollbarColor: 'var(--veylix-scrollbar) transparent' },

        [`.${verticalLayoutClasses.headerAttached}.scrolled, .${verticalLayoutClasses.headerDetached}.scrolled .${verticalLayoutClasses.navbar}`]:
          {
            borderBlockEnd: '1px solid var(--mui-palette-divider)'
          },

        /*
         * A FOCUSED FIELD IS 1px, NOT 2px — the vendored TextField sets 2px from
         * a styled() wrapper, which only `!important` reaches. Focus is carried
         * by the gold edge instead.
         */
        '.MuiInputBase-root.Mui-focused': {
          borderWidth: '1px !important'
        },

        /* A medium input is main text (14px), not the vendored 17px. */
        '.MuiInputBase-root:not(.MuiInputBase-sizeSmall)': {
          fontSize: '0.875rem !important'
        },

        /* A small field is the same box as a small button. */
        '.MuiInputBase-root.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline)': {
          fontSize: '0.8125rem !important',
          blockSize: `${CONTROL_BLOCK_SIZE_SM}px`
        },
        '.MuiInputBase-root.MuiInputBase-sizeSmall:not(.MuiInputBase-multiline) .MuiInputBase-input': {
          paddingBlock: '0 !important'
        },

        /* The page gutter — the template's 16px shell inset. */
        [`.${verticalLayoutClasses.content}`]: {
          padding: `${PAGE_GUTTER}px !important`
        },

        /*
         * TABLES — `foundation.css table/th/td`.
         *
         * The template's rows are tinted bands with rounded ends, separated by
         * a gap, in a five-step pastel cycle. Kept, with two density changes
         * the CMS needs: 40px rows (the template's are ~49px) and a 4px gap
         * (the template's is 10px). `separate` is what lets a cell carry a
         * radius; the pinned columns in styles/table-chrome.css are sticky
         * cells and work the same in either mode.
         *
         * Scoped to tables with a head, so a layout table is never caught.
         */
        'table:has(> thead)': {
          borderCollapse: 'separate !important',
          borderSpacing: '0 4px !important'
        },
        'table:has(> thead) > tbody > tr > td, table:has(> thead) > tbody > tr > th': {
          borderBlock: 'none !important',
          backgroundColor: 'var(--veylix-row, transparent)'
        },
        'table:has(> thead) > tbody > tr:nth-of-type(5n + 1)': { '--veylix-row': 'var(--veylix-row-1)' },
        'table:has(> thead) > tbody > tr:nth-of-type(5n + 2)': { '--veylix-row': 'var(--veylix-row-2)' },
        'table:has(> thead) > tbody > tr:nth-of-type(5n + 3)': { '--veylix-row': 'var(--veylix-row-3)' },
        'table:has(> thead) > tbody > tr:nth-of-type(5n + 4)': { '--veylix-row': 'var(--veylix-row-4)' },
        'table:has(> thead) > tbody > tr:nth-of-type(5n + 5)': { '--veylix-row': 'var(--veylix-row-5)' },
        'table:has(> thead) > tbody > tr:hover': { '--veylix-row': 'var(--veylix-row-hover)' },
        // A selected row (`.c-selection`'s gold band). Rows mark it as
        // data-selected, aria-selected or the old bg-primaryLighter class; the
        // cell paints the band, so it has to be told through the variable.
        "table:has(> thead) > tbody > tr:is([data-selected='true'], [aria-selected='true'], .bg-primaryLighter)": {
          '--veylix-row': 'var(--mui-palette-primary-lightOpacity)'
        },
        'table:has(> thead) > tbody > tr > td:first-of-type, table:has(> thead) > tbody > tr > th:first-of-type': {
          borderStartStartRadius: 12,
          borderEndStartRadius: 12
        },
        'table:has(> thead) > tbody > tr > td:last-of-type, table:has(> thead) > tbody > tr > th:last-of-type': {
          borderStartEndRadius: 12,
          borderEndEndRadius: 12
        },
        'table:has(> thead) > thead > tr > th': {
          borderBlock: 'none !important'
        },

        'table tbody th, table tbody td': {
          fontSize: '0.8125rem !important',
          blockSize: `${TABLE_ROW_BLOCK_SIZE}px !important`,
          paddingBlock: '0 !important'
        },

        /* The header: a quiet label row, `th` in the template — secondary, 600, sentence case. */
        'table thead th': {
          blockSize: `${TABLE_ROW_BLOCK_SIZE}px !important`,
          paddingBlock: '0 !important',
          fontSize: '0.8125rem !important',
          fontWeight: '600 !important',
          lineHeight: '1.5 !important',
          letterSpacing: 'normal !important',
          textTransform: 'none',
          color: 'var(--mui-palette-text-secondary) !important',
          backgroundColor: 'var(--mui-palette-customColors-tableHeaderBg) !important'
        },
        'table thead': { textTransform: 'none !important', borderBlockStart: 'none !important' },

        /* `kbd` — the template draws shortcut keys as soft keycaps. */
        kbd: {
          whiteSpace: 'nowrap',
          background: '#dedad438',
          border: '1px solid #e0dcd666',
          borderRadius: 6,
          padding: '3px 6px',
          fontSize: '0.75rem'
        }
      }
    },

    // Paper is the solid glass colour; cards add the gradient and the blur.
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        outlined: { borderColor: 'var(--mui-palette-divider)' }
      }
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          ...GLASS,
          borderRadius: RADIUS.xl
        }
      }
    },

    MuiCardHeader: {
      styleOverrides: {
        // `.card-heading h2`: 17px (`--font-heading`), heavy.
        title: { fontSize: '1.0625rem', fontWeight: 750, letterSpacing: '-0.015em' },
        subheader: { fontSize: '0.8125rem', color: 'var(--mui-palette-text-secondary)' }
      }
    },

    MuiCardContent: {
      styleOverrides: {
        // `--card-padding: 20px`.
        root: { padding: 20, '&:last-child': { paddingBottom: 20 } }
      }
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        /*
         * `.primary-button` / `.secondary-button`. A function, because the look
         * depends on the variant; `!important` because the ported tonal and
         * contained fills are `variants` entries, which MUI applies after root.
         */
        root: ({ ownerState }: { ownerState?: { variant?: string; color?: string } }) => ({
          borderRadius: RADIUS.md,
          textTransform: 'none',
          fontWeight: 800,
          gap: 2,
          // `.primary-button` never breaks its label; a crowded row wraps
          // whole buttons instead (MuiDialogActions below).
          whiteSpace: 'nowrap',
          flexShrink: 0,
          transition: 'transform .2s, background .2s, border-color .2s',
          '&:active': { transform: 'scale(.98)' },

          ...(ownerState?.variant === 'contained' &&
            (ownerState?.color ?? 'primary') === 'primary' && {
              // The gold gradient, built from the operator's primary so a
              // picked colour still reaches it.
              backgroundImage:
                'linear-gradient(120deg, var(--mui-palette-primary-light), var(--mui-palette-primary-main)) !important',
              border: '1px solid var(--mui-palette-primary-main)',
              color: 'var(--mui-palette-primary-contrastText) !important',
              boxShadow: 'inset 0 1px 1px #fff7, 0 3px 6px #c28c1721',
              '&:hover': {
                backgroundImage: 'none !important',
                backgroundColor: 'var(--mui-palette-primary-light) !important',
                boxShadow: 'inset 0 1px 1px #fff7, 0 3px 6px #c28c1721'
              },
              '&.Mui-disabled': {
                backgroundImage: 'none !important',
                backgroundColor: 'var(--mui-palette-action-disabledBackground) !important',
                color: 'var(--mui-palette-text-disabled) !important',
                borderColor: 'transparent',
                boxShadow: 'none'
              }
            }),

          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color === 'secondary' && {
              backgroundColor: 'var(--veylix-control) !important',
              color: 'var(--mui-palette-text-primary) !important',
              border: '1px solid var(--mui-palette-Chip-defaultBorder)',
              '&:hover': {
                backgroundColor: 'var(--mui-palette-action-hover) !important',
                borderColor: 'var(--mui-palette-customColors-inputBorder)'
              },
              '&.Mui-disabled': {
                color: 'var(--mui-palette-text-disabled) !important',
                borderColor: 'var(--mui-palette-divider)'
              }
            })
        }),
        contained: {
          '&:hover': { boxShadow: 'none' }
        },
        outlined: {
          backgroundColor: 'var(--veylix-control)',
          borderColor: 'var(--mui-palette-Chip-defaultBorder)',
          '&:hover': {
            borderColor: 'var(--mui-palette-customColors-inputBorder)',
            backgroundColor: 'var(--mui-palette-action-hover)'
          }
        },
        // Text buttons read in the accent's TEXT colour: gold on cream is too faint.
        text: ({ ownerState }: { ownerState?: { color?: string } }) => ({
          ...((ownerState?.color ?? 'primary') === 'primary' && {
            color: 'var(--veylix-accent-text)'
          })
        }),
        sizeLarge: { fontSize: '1rem', minBlockSize: 41 },
        sizeSmall: {
          fontSize: '0.8125rem',
          lineHeight: 1.38462,
          borderRadius: 'var(--mui-shape-customBorderRadius-md)',
          minBlockSize: `${CONTROL_BLOCK_SIZE_SM}px`,
          boxSizing: 'border-box'
        }
      }
    },

    // `.icon-button`: 10px corner, warm wash on hover, a press.
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS.md,
          transition: 'background .15s, transform .15s',
          '&:active': { transform: 'scale(.95)' }
        }
      }
    },

    // A count on an icon's corner — `.nav-link .badge`: ringed so it lifts off the glyph.
    MuiBadge: {
      styleOverrides: {
        standard: {
          height: 18,
          minWidth: 18,
          padding: '0 5px',
          borderRadius: 7,
          fontSize: '0.6875rem',
          fontWeight: 750,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          boxShadow: '0 0 0 2px var(--mui-palette-background-paper)'
        }
      }
    },

    MuiToggleButton: {
      styleOverrides: {
        root: { borderRadius: RADIUS.md, textTransform: 'none', fontWeight: 650 }
      }
    },

    // `.c-field input`: cream fill, warm edge, 11px corner, gold on focus.
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 11,
          backgroundColor: 'var(--veylix-input)',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--mui-palette-customColors-inputBorder)'
          },
          '&:hover:not(.Mui-disabled):not(.Mui-error) .MuiOutlinedInput-notchedOutline': {
            borderColor: 'var(--mui-palette-text-disabled)'
          },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderWidth: 1,
            borderColor: 'var(--mui-palette-primary-main)',
            boxShadow: '0 0 0 3px var(--mui-palette-primary-lightOpacity)'
          }
        },
        input: {
          '&::placeholder': { color: 'var(--mui-palette-text-disabled)', opacity: 1 }
        }
      }
    },

    MuiFilledInput: {
      styleOverrides: {
        root: {
          borderRadius: 11,
          border: '1px solid var(--mui-palette-customColors-inputBorder)',
          '&:before, &:after': { display: 'none' }
        }
      }
    },

    MuiInputLabel: {
      // `.c-field` label: 650 weight.
      styleOverrides: { root: { fontWeight: 650 } }
    },

    /*
     * CHIPS — filters and status pills.
     *
     * Status (tonal + a tone): `.badge-*` — the template's pastel fill with its
     * darker text; the fills are each tone's `lightOpacity`, set above.
     * Unselected filter (tonal secondary): a white pill on the control edge.
     * Selected filter (filled primary): the template's selected state — the
     * gold wash with dark-brown text (`.header-popover [aria-checked=true]`),
     * never a solid slab: Manage Claims has twenty-one of these on screen.
     */
    MuiChip: {
      styleOverrides: {
        sizeSmall: { fontSize: '0.8125rem !important' },
        labelSmall: { fontSize: 'inherit' },
        root: ({ ownerState }: { ownerState?: { variant?: string; color?: string } }) => ({
          borderRadius: RADIUS.sm,
          fontWeight: 650,

          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color === 'secondary' && {
              backgroundColor: 'var(--veylix-control) !important',
              color: 'var(--mui-palette-text-secondary) !important',
              border: '1px solid var(--mui-palette-Chip-defaultBorder)',
              '&:hover': {
                backgroundColor: 'var(--mui-palette-action-hover) !important',
                borderColor: 'var(--mui-palette-customColors-inputBorder)'
              }
            }),

          ...(ownerState?.variant === 'filled' &&
            ownerState?.color === 'primary' && {
              backgroundColor: 'var(--veylix-accent-wash) !important',
              color: 'var(--veylix-nav-active-text) !important',
              border: '1px solid var(--mui-palette-primary-main)',
              fontWeight: 750,
              '&:hover': {
                backgroundColor: 'var(--veylix-accent-wash) !important'
              }
            }),

          ...(ownerState?.variant === 'tonal' &&
            ownerState?.color !== undefined &&
            TINTED_TONES.includes(ownerState.color as TintedTone) && {
              backgroundColor: `var(--mui-palette-${ownerState.color}-lightOpacity) !important`,
              color:
                ownerState.color === 'primary'
                  ? 'var(--veylix-accent-text) !important'
                  : `var(--mui-palette-${ownerState.color}-dark) !important`,
              border: 'none',
              fontWeight: 650,
              [`${DARK} &`]: {
                color:
                  ownerState.color === 'primary'
                    ? 'var(--veylix-accent-text) !important'
                    : `var(--mui-palette-${ownerState.color}-light) !important`
              }
            })
        }),
        outlined: { borderColor: 'var(--mui-palette-Chip-defaultBorder)' }
      }
    },

    // `.header-popover`: a cream glass panel, 20px corner, 9px inset.
    MuiMenu: {
      styleOverrides: {
        list: { padding: 6 },
        paper: {
          borderRadius: POPOVER_RADIUS,
          border: '1px solid var(--veylix-dialog-border)',
          backgroundImage: 'var(--veylix-popover)',
          boxShadow: 'var(--veylix-shadow-popover)',
          WebkitBackdropFilter: 'blur(28px)',
          backdropFilter: 'blur(28px)'
        }
      }
    },

    MuiPopover: {
      styleOverrides: {
        paper: {
          borderRadius: POPOVER_RADIUS,
          border: '1px solid var(--veylix-dialog-border)',
          backgroundImage: 'var(--veylix-popover)',
          boxShadow: 'var(--veylix-shadow-popover)',
          WebkitBackdropFilter: 'blur(28px)',
          backdropFilter: 'blur(28px)'
        }
      }
    },

    // `.header-popover [role=menuitem]`: rounded rows, white wash on hover, gold when chosen.
    MuiMenuItem: {
      styleOverrides: {
        root: ({ theme }: { theme: Theme }) => ({
          ...DROPDOWN_ROW,
          [theme.breakpoints.up('sm')]: { minHeight: DROPDOWN_ROW.minHeight },
          '&:hover, &.Mui-focusVisible': { backgroundColor: 'var(--veylix-nav-hover)' },
          '&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible': {
            backgroundColor: 'var(--veylix-accent-wash)',
            color: 'var(--veylix-nav-active-text)',
            fontWeight: 650
          },
          '&.Mui-disabled': { opacity: 0.45 },
          '& .MuiListItemIcon-root': { minInlineSize: 0 }
        })
      }
    },

    MuiAutocomplete: {
      styleOverrides: {
        paper: {
          marginBlockStart: 4,
          borderRadius: 16,
          border: '1px solid var(--veylix-dialog-border)',
          backgroundImage: 'var(--veylix-popover)',
          boxShadow: 'var(--veylix-shadow-popover)'
        },
        listbox: {
          padding: 6,
          maxHeight: 320,
          '& .MuiAutocomplete-option': {
            ...DROPDOWN_ROW,
            margin: 0,
            '&.Mui-focused, &.Mui-focusVisible': {
              backgroundColor: 'var(--veylix-nav-hover)'
            },
            '&[aria-selected="true"]': {
              backgroundColor: 'var(--veylix-accent-wash)',
              color: 'var(--veylix-nav-active-text)',
              fontWeight: 650,
              '&::after': {
                content: '""',
                flexShrink: 0,
                marginInlineStart: 'auto',
                inlineSize: 16,
                blockSize: 16,
                backgroundColor: 'currentColor',
                WebkitMaskImage: CHECK_MASK,
                maskImage: CHECK_MASK,
                WebkitMaskSize: '100% 100%',
                maskSize: '100% 100%'
              }
            },
            '&[aria-selected="true"].Mui-focused': {
              backgroundColor: 'var(--veylix-accent-wash)'
            },
            '&[aria-disabled="true"]': { opacity: 0.45 }
          }
        },
        noOptions: { fontSize: '0.8125rem', color: 'var(--mui-palette-text-secondary)', padding: '8px 12px' },
        loading: { fontSize: '0.8125rem', color: 'var(--mui-palette-text-secondary)', padding: '8px 12px' },
        groupLabel: {
          fontSize: '0.75rem',
          fontWeight: 650,
          lineHeight: '28px',
          color: 'var(--mui-palette-text-secondary)',
          backgroundColor: 'transparent'
        },
        input: {
          '&::selection': { backgroundColor: 'var(--mui-palette-primary-lightOpacity)' }
        }
      }
    },

    // `.app-dialog`: a cream glass sheet, 23px corner, 1.5px white edge, a deep soft shadow.
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: DIALOG_RADIUS,
          border: '1.5px solid var(--veylix-dialog-border)',
          backgroundColor: 'var(--veylix-dialog)',
          backgroundImage: 'none',
          boxShadow: 'var(--veylix-shadow-dialog)',
          WebkitBackdropFilter: 'blur(30px)',
          backdropFilter: 'blur(30px)'
        }
      }
    },

    // `.app-dialog::backdrop`: a warm veil with a light blur.
    MuiBackdrop: {
      styleOverrides: {
        root: ({ ownerState }: { ownerState?: { invisible?: boolean } }) => ({
          ...(!ownerState?.invisible && {
            backgroundColor: 'var(--veylix-backdrop)',
            WebkitBackdropFilter: 'blur(6px)',
            backdropFilter: 'blur(6px)'
          })
        })
      }
    },

    // `.dialog-heading` / `.dialog-body`.
    MuiDialogTitle: {
      styleOverrides: {
        root: {
          fontSize: '1.125rem',
          fontWeight: 750,
          letterSpacing: '-0.5px',
          padding: '19px 23px',
          borderBlockEnd: '1px solid var(--veylix-hairline-soft)'
        }
      }
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: '22px 24px 26px',
          '.MuiDialogTitle-root + &': { paddingTop: '22px !important' }
        }
      }
    },

    MuiDialogActions: {
      styleOverrides: {
        root: { padding: '14px 24px 22px', gap: 8, flexWrap: 'wrap', rowGap: 8 }
      }
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 9,
          fontSize: '0.75rem',
          fontWeight: 650,
          padding: '6px 10px',
          color: 'var(--mui-palette-customColors-tooltipText)'
        }
      }
    },

    MuiTableCell: {
      styleOverrides: {
        root: { borderBottom: 'none' },
        head: {
          fontSize: '0.8125rem',
          fontWeight: 600,
          textTransform: 'none',
          letterSpacing: '0',
          color: 'var(--mui-palette-text-secondary)',
          backgroundColor: 'var(--mui-palette-customColors-tableHeaderBg)'
        }
      }
    },

    // Tabs: the selected one in the nav's gold wash rather than an underline.
    MuiTabs: {
      styleOverrides: {
        indicator: { backgroundColor: 'var(--veylix-nav-bar)', height: 3, borderRadius: 3 }
      }
    },

    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 650,
          minHeight: 40,
          color: 'var(--mui-palette-text-secondary)',
          '&.Mui-selected': { color: 'var(--mui-palette-text-primary)' }
        }
      }
    },

    // Alerts read as the template's form note / tinted badge: soft fill, no hard edge.
    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: 'none',
          fontSize: '0.8125rem'
        }
      }
    },

    MuiDivider: {
      styleOverrides: { root: { borderColor: 'var(--mui-palette-divider)' } }
    },

    // `.progress-track` / `.progress-fill`: 6px, 8px corner.
    MuiLinearProgress: {
      styleOverrides: {
        root: { borderRadius: 8, height: 6, backgroundColor: 'var(--mui-palette-customColors-trackBg)' },
        bar: { borderRadius: 8 }
      }
    },

    // `.avatar`: a gold disc with a white ring.
    MuiAvatar: {
      styleOverrides: {
        root: { fontSize: '0.8125rem', fontWeight: 750 },
        colorDefault: {
          backgroundImage: 'var(--veylix-avatar)',
          // !important: the ported `skin='light'` paints the letter in the
          // primary colour, which vanishes on the gold disc.
          color: 'var(--veylix-avatar-text) !important',
          boxShadow: '0 3px 8px #d6a64236'
        }
      }
    },

    MuiListItemButton: {
      styleOverrides: { root: { borderRadius: RADIUS.lg } }
    },

    MuiSwitch: {
      styleOverrides: {
        // The thumb lifts off the gold track like the template's glass controls.
        thumb: { boxShadow: '0 1px 3px #6649244d' }
      }
    }
  }
})

export default veylixTheme
