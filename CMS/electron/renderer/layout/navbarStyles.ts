// Third-party Imports
import type { CSSObject } from '@emotion/styled'

// Config Imports
import themeConfig from '@configs/themeConfig'

// Util Imports
import { verticalLayoutClasses as c } from '@layouts/utils/layoutClasses'
import { PAGE_GUTTER } from '@renderer/theme/veylixTheme'

/**
 * The top bar's shape: one full-width strip with a hairline under it.
 *
 * WHAT IT REPLACES. Monitor's navbar is a FLOATING card: 16px off the top, a
 * rounded box capped at the content width, a blur gradient behind it, and a
 * `scrolled` class that changes its padding and background the moment the page
 * moves. Each of those is fine on its own. Together they made the bar a
 * different object on every tab — taller on a page that had not scrolled,
 * squarer on one that had, narrower or wider with the content-width setting —
 * which is the "inconsistent across tabs" it was reported as.
 *
 * Vercel's bar is none of those things. It is the top edge of the window: full
 * bleed, fixed height, a 1px line under it, and it looks the same whether the
 * page has scrolled or not.
 *
 * HOW. `@layouts/components/vertical/Navbar` is vendored and cannot be edited,
 * but it takes `overrideStyles`, which StyledHeader appends LAST inside its own
 * class. So each rule below repeats the exact compound selector of the rule it
 * undoes: same specificity, later in the sheet, and it wins without an
 * `!important`. Selectors are built from `verticalLayoutClasses` rather than
 * typed out, so a renamed class fails the type-check instead of silently
 * missing.
 *
 * WHAT IS KEPT: `position: sticky` and the compact-width cap on the bar's
 * CONTENT. The strip runs edge to edge; what is inside it lines up with the
 * page under it, whichever content width the operator has chosen — inset by
 * the same PAGE_GUTTER the page is padded by.
 */

/** One height, on every screen, scrolled or not. */
/**
 * THE TOP BAR, as the Veylix template draws it (`.topbar`, `.header-primary`,
 * `.header-tools`): no strip at all — two GLASS PILLS floating 16px below the
 * window's top edge, 64px tall with a 27px corner. The pills themselves are
 * drawn by AppShell (they wrap its two slots); this file makes the vendored
 * header around them transparent and sets the height.
 *
 * Once the page scrolls under it, the vendored header adds `.scrolled`, and a
 * cream panel appears behind both pills (`.topbar.is-scrolled:before`) so the
 * page does not show through the gap between them.
 */
export const NAVBAR_BLOCK_SIZE = 64

/** The shell's inset above the bar — `--shell-inset`. */
export const NAVBAR_INSET = 16

/** No edge: the bar is two pills, and a pill carries its own. */
export const NAVBAR_EDGE = 'none'

const NAVBAR = `.${c.navbar}`
const FLOATING = `.${c.headerFloating}`
const FIXED = `.${c.headerFixed}`
const BLUR = `.${c.headerBlur}`
const COMPACT = `.${c.headerContentCompact}`

const FLAT_INNER: CSSObject = {
  backgroundColor: 'transparent',
  backdropFilter: 'none',
  border: 0,
  borderRadius: 27,
  boxShadow: 'none',
  paddingInline: 0,
  paddingBlock: 0,
  minBlockSize: NAVBAR_BLOCK_SIZE,
  transition: 'background-color .18s, box-shadow .18s'
}

export const navbarStyles: CSSObject = {
  [`&${FLOATING}`]: {
    paddingBlockStart: NAVBAR_INSET,
    backgroundColor: 'transparent',
    borderBlockEnd: NAVBAR_EDGE,
    minBlockSize: NAVBAR_BLOCK_SIZE + NAVBAR_INSET,

    [`& ${NAVBAR}`]: {
      ...FLAT_INNER,
      inlineSize: `calc(100% - ${2 * PAGE_GUTTER}px)`
    }
  },
  [`&${COMPACT}${FLOATING} ${NAVBAR}`]: {
    maxInlineSize: `${themeConfig.compactContentWidth - 2 * PAGE_GUTTER}px`
  },

  [`&${FIXED}${BLUR}${FLOATING} ${NAVBAR}`]: FLAT_INNER,
  [`[data-skin='bordered'] &${FLOATING} ${NAVBAR}`]: FLAT_INNER,

  // `.topbar.is-scrolled:before`: a cream panel behind both pills.
  [`&${FLOATING}.scrolled ${NAVBAR}`]: {
    backgroundColor: 'var(--veylix-chrome-scrolled)',
    boxShadow: '0 6px 20px #74634512',
    WebkitBackdropFilter: 'blur(24px)',
    backdropFilter: 'blur(24px)'
  },

  [`&${FIXED}${BLUR}${FLOATING}::before`]: { display: 'none' }
}

/** One glass pill of the bar — `.header-primary` / `.header-tools`. */
export const navbarPill: CSSObject = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  blockSize: NAVBAR_BLOCK_SIZE,
  paddingInline: 10,
  borderRadius: 27,
  backgroundImage: 'var(--veylix-chrome)',
  border: '1px solid var(--veylix-chrome-border)',
  boxShadow: 'var(--veylix-chrome-shadow)',
  WebkitBackdropFilter: 'blur(24px) saturate(135%)',
  backdropFilter: 'blur(24px) saturate(135%)'
}
