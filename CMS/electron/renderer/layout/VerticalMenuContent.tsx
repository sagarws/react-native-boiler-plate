// MUI Imports
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'

// Third-party Imports
import PerfectScrollbar from 'react-perfect-scrollbar'

// Component Imports
import { Menu, MenuItem } from '@menu/vertical-menu'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

// Style Imports
import menuItemStyles from '@core/styles/vertical/menuItemStyles'
import { menuClasses } from '@menu/utils/menuClasses'

// Navigation Imports
import { idToHref } from '@renderer/navigation/NavigationContext'

/**
 * The CMS's navigation, in Monitor's menu.
 *
 * WHAT IS PORTED AND WHAT IS OURS. The Menu, MenuItem and their styles are
 * Monitor's, untouched — that is where the collapse, the hover-expand, the
 * active rail and the transitions come from. What this file supplies is the
 * LIST: the same six screens the app has always had, in the same order, with
 * the same ids. Nothing about what a click does has changed; `href` is read
 * back into an id by the navigation shim.
 *
 * NO SECTIONS. Monitor groups its menu under headings because it has forty
 * entries; six do not need a heading, and adding one would be decoration.
 */

/**
 * The rail, re-cut to the Veylix template's `.nav-link`.
 *
 * `@core/styles/vertical/menuItemStyles` is Monitor's and vendored, so it is
 * merged over rather than edited:
 *
 *   - A LINK is 40px, 7px padding, a 13px corner, 14px at weight 600, its icon
 *     20px and 9px before the label; hover is a white wash.
 *   - THE ACTIVE LINK is the template's gold gradient pill with a white edge, a
 *     soft gold glow and dark-brown text, plus a 3px gold bar just outside its
 *     leading edge (`.nav-link.active:before`).
 *
 * `!important` IS LOAD-BEARING on the active rule: the vendored gradient it
 * replaces is itself `!important`.
 */
const veylixMenuItemStyles = (
  base: ReturnType<typeof menuItemStyles>,
  collapsedNotHovered: boolean
): ReturnType<typeof menuItemStyles> => ({
  ...base,

  root: params => ({
    ...(typeof base.root === 'function' ? base.root(params) : base.root),

    // `.nav-group > ul { gap: 4px }`.
    marginBlockStart: params.level === 0 ? 4 : 0,

    [`&:not(.${menuClasses.subMenuRoot}) > .${menuClasses.button}.${menuClasses.active}`]: {
      background: 'var(--veylix-nav-active) !important',
      borderColor: 'var(--veylix-nav-active-border)',
      color: 'var(--veylix-nav-active-text) !important',
      fontWeight: 600,
      boxShadow: 'var(--veylix-nav-active-shadow) !important',
      [`& .${menuClasses.icon}`]: {
        color: 'var(--veylix-nav-active-text) !important'
      },
      ...(!collapsedNotHovered && {
        '&::before': {
          content: '""',
          position: 'absolute',
          insetBlock: 9,
          insetInlineStart: -9,
          inlineSize: 3,
          borderRadius: 5,
          background: 'var(--veylix-nav-bar)',
          boxShadow: '0 0 6px var(--veylix-nav-bar)'
        }
      })
    }
  }),

  button: params => ({
    ...(typeof base.button === 'function' ? base.button(params) : base.button),
    position: 'relative',
    overflow: 'visible',
    minBlockSize: 40,
    paddingBlock: 7,
    paddingInline: 9,
    fontSize: '0.875rem',
    fontWeight: 600,
    borderRadius: 13,
    border: '1px solid transparent',
    color: params.active ? 'var(--veylix-nav-active-text)' : 'var(--veylix-nav-text)',
    transition: 'background .15s, box-shadow .15s',
    '&:hover': {
      background: 'var(--veylix-nav-hover) !important',
      color: 'var(--mui-palette-text-primary)'
    }
  }),

  icon: params => ({
    ...(typeof base.icon === 'function' ? base.icon(params) : base.icon),
    ...(params.level === 0 && {
      fontSize: '1.25rem',
      // Kept at 0 when the rail is closed, or the icon drifts off its centre.
      marginInlineEnd: collapsedNotHovered ? 0 : 9
    }),
    color: 'inherit'
  })
})

export interface ShellNavItem {
  id: string
  label: string
  /** A Tabler class name — `tabler-dashboard`, and so on. */
  icon: string
  disabled?: boolean
  /**
   * A count that needs attention on this screen, shown at the end of the row.
   *
   * Currently only Login uses it, for marketplace sign-ins that have gone
   * stale — see `useStaleLogins`. It exists so that the condition stays
   * visible on every screen after the full-width banner that used to carry it
   * was moved onto the Login page itself: a number in the rail does not wear
   * out the way a permanent red band does.
   *
   * 0 or undefined renders nothing, so the rail is quiet on the normal path.
   */
  badge?: number
}

interface Props {
  items: readonly ShellNavItem[]
  /** Fades the shadow under the header in as the menu scrolls. Monitor's. */
  scrollMenu: (container: unknown, isPerfectScrollbar: boolean) => void
}

export const VerticalMenuContent = ({ items, scrollMenu }: Props) => {
  const theme = useTheme()
  const verticalNavOptions = useVerticalNav()
  const { isBreakpointReached, transitionDuration, isCollapsed, isHovered } = verticalNavOptions

  /*
   * PerfectScrollbar on a desktop window, the native scrollbar on a narrow one
   * — Monitor's rule, kept because the menu's shadow effect is wired to it.
   */
  const ScrollWrapper = isBreakpointReached ? 'div' : PerfectScrollbar

  return (
    <ScrollWrapper
      {...(isBreakpointReached
        ? {
            className: 'bs-full overflow-y-auto overflow-x-hidden',
            onScroll: container => scrollMenu(container, false)
          }
        : {
            options: { wheelPropagation: false, suppressScrollX: true },
            onScrollY: container => scrollMenu(container, true)
          })}
    >
      <Menu
        popoutMenuOffset={{ mainAxis: 23 }}
        menuItemStyles={veylixMenuItemStyles(
          menuItemStyles(verticalNavOptions, theme),
          Boolean(isCollapsed && !isHovered)
        )}
        renderExpandedMenuItemIcon={{ icon: <i className='tabler-circle text-xs' /> }}
        transitionDuration={transitionDuration}
      >
        {items.map(item => (
          <MenuItem
            key={item.id}
            href={idToHref(item.id)}
            icon={<i className={item.icon} />}
            disabled={item.disabled}
            exactMatch
            /*
             * The count rides in the row's `suffix` slot, so it collapses with
             * the label when the rail does — at 71px there is no room for it,
             * and a number floating beside an icon would read as part of the
             * icon rather than as a count.
             */
            suffix={
              item.badge ? (
                <Box
                  component='span'
                  className='tabular-nums'
                  sx={{
                    // `.nav-link .badge`: a 7px-corner pill with a white edge.
                    minInlineSize: 20,
                    blockSize: 20,
                    paddingInline: '6px',
                    borderRadius: '7px',
                    border: '1px solid var(--veylix-glass-border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 12,
                    fontWeight: 650,
                    // The danger ROLE, as a tint rather than a slab — the same
                    // vocabulary the status pills use, so the rail does not
                    // introduce a second way of saying "this is wrong".
                    backgroundColor: 'var(--mui-palette-error-lightOpacity)',
                    color: 'var(--mui-palette-error-dark)'
                  }}
                >
                  {item.badge}
                </Box>
              ) : undefined
            }
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </ScrollWrapper>
  )
}
