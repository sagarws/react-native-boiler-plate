// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

// Third-party Imports
import classnames from 'classnames'

// Component Imports
import LayoutWrapper from '@layouts/LayoutWrapper'
import VerticalLayout from '@layouts/VerticalLayout'
import Navbar from '@layouts/components/vertical/Navbar'
import { Navigation } from './Navigation'
import type { ShellNavItem } from './VerticalMenuContent'
import { BackgroundWork } from '../components/BackgroundWork'
import { HomeRenderedSignal } from '../components/HomeRenderedSignal'
import Box from '@mui/material/Box'
import { navbarPill, navbarStyles } from './navbarStyles'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useSettings } from '@core/hooks/useSettings'

// Type Imports
import type { SystemMode } from '@core/types'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

/**
 * The window's frame: rail, navbar, content.
 *
 * This replaces layouts/AppLayout — the same three regions, built from
 * Monitor's `@layouts` and `@menu` instead of from hand-written Tailwind. What
 * the app passes in is unchanged in shape: the nav items, which one is active,
 * what to do when one is chosen, and the slots that hang off the navbar.
 *
 * IT IS NOT A DRAG STRIP ANY MORE. It was, while the macOS window had no title
 * bar of its own and something had to be grabbable; the window has a real one
 * now, so the bar is just a bar and nothing inside it has to opt out of being
 * dragged in order to take a click.
 */

/**
 * The rail's control, in the bar rather than in the rail.
 *
 * IT USED TO LIVE IN THE RAIL, and it could not be used twice. Collapsing took
 * the rail from 260px to 71px, which moved the button roughly 160px left of the
 * cursor that had just pressed it — and because the rail was then neither
 * expanded nor hovered, the button unmounted outright. Pressing it made it
 * vanish, and getting it back meant hovering the sliver to coax it out.
 *
 * In the bar it does not move when the thing it controls does. Monitor keeps it
 * in the rail because a web page has no window chrome to put it in and a mouse
 * that leaves the rail has somewhere harmless to go; this is a window.
 *
 * Narrow windows keep the hamburger: there the rail is a drawer that is either
 * over the page or not, and "collapsed" has no meaning.
 */
const NavToggle = () => {
  const { toggleVerticalNav, isBreakpointReached } = useVerticalNav()
  const { settings, updateSettings } = useSettings()

  const collapsed = settings.layout === 'collapsed'

  const label = isBreakpointReached
    ? 'Show the navigation'
    : collapsed
      ? 'Expand the navigation'
      : 'Collapse the navigation'

  const icon = isBreakpointReached
    ? 'tabler-menu-2'
    : collapsed
      ? 'tabler-layout-sidebar-left-expand'
      : 'tabler-layout-sidebar-left-collapse'

  const toggle = (): void => {
    if (isBreakpointReached) toggleVerticalNav()
    else updateSettings({ layout: collapsed ? 'vertical' : 'collapsed' })
  }

  /* A real button now, the same size and hover as the ones on the right, so
     the two ends of the bar are drawn by the same hand. */
  return (
    <Tooltip title={label}>
      <IconButton
        size='small'
        aria-label={label}
        {...(isBreakpointReached ? {} : { 'aria-pressed': collapsed })}
        onClick={toggle}
        className='text-textSecondary'
      >
        <i className={classnames(icon, 'text-xl')} />
      </IconButton>
    </Tooltip>
  )
}

export interface AppShellProps {
  systemMode: SystemMode
  navItems: readonly ShellNavItem[]
  /** The product mark, drawn into the rail's header. */
  brand: ReactNode
  /** The build line at the foot of the rail. */
  navFooter?: ReactNode
  /** A warning pinned to the bottom of the rail. */
  navAlert?: ReactNode
  /** Where the operator is — breadcrumb and title, left of the navbar. */
  title: ReactNode
  /** Identity, notifications and anything else that belongs to the account. */
  actions?: ReactNode
  /** A full-width alert under the navbar. */
  notice?: ReactNode
  children: ReactNode
}

export const AppShell = ({
  systemMode,
  navItems,
  brand,
  navFooter,
  navAlert,
  title,
  actions,
  notice,
  children
}: AppShellProps) => (
  <>
  {/* Lets background work start once this shell has painted — see startupGate. */}
  <HomeRenderedSignal />
  <LayoutWrapper
    systemMode={systemMode}
    verticalLayout={
      <VerticalLayout
        navigation={<Navigation items={navItems} brand={brand} footer={navFooter} alert={navAlert} />}
        navbar={
          <Navbar overrideStyles={navbarStyles}>
            <div
              className={classnames(
                verticalLayoutClasses.navbarContent,
                'flex items-center justify-between gap-4 is-full'
              )}
            >
              {/* `.header-primary`: the rail toggle and where you are. Capped at
                  the template's 920px so it stays a pill on a wide window. */}
              <Box sx={{ ...navbarPill, flex: '1 1 auto', minInlineSize: 0, maxInlineSize: 920 }}>
                <NavToggle />
                <div className='min-is-0'>{title}</div>
              </Box>
              {/* `.header-tools`: everything that acts on the app, not the page. */}
              {actions && <Box sx={{ ...navbarPill, flexShrink: 0, gap: 4 }}>{actions}</Box>}
            </div>
          </Navbar>
        }
      >
        {/* Spaced from the page it sits over. StyledMain stacks its children
            with no gap, so a full-width alert butted straight into the first
            card underneath it. */}
        {notice && <div className='mbe-4 shrink-0'>{notice}</div>}
        {children}
      </VerticalLayout>
    }
  />

  {/*
    OUTSIDE THE LAYOUT, deliberately.

    It is fixed to the WINDOW, not to the page: an automation outlives the
    screen it was started from, so "is it still running?" has to be answerable
    from wherever the operator has navigated to. Putting it inside
    `VerticalLayout` would hand it that layout's scroll container and its
    stacking context, and the panel would scroll away with the page.

    THIS IS THE REGRESSION IT FIXES. The panel was mounted in
    `layouts/AppLayout`, which this shell replaced — and the replacement did
    not bring it across. Nothing errored, because the component is rendered by
    nobody: Create Ticket still ran, still broadcast every tick on
    `claim-queue:batch-progress`, and there was simply no listener mounted to
    draw them. An operator selected forty claims, pressed the button, and got
    toasts from individual claims and no progress anywhere.
  */}
  <BackgroundWork />
  </>
)
