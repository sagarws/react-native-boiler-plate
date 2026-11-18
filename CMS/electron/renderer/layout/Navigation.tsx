// React Imports
import { useEffect, useRef } from 'react'

// MUI Imports
import { styled, useTheme } from '@mui/material/styles'

// Component Imports
import VerticalNav, { NavHeader, NavCollapseIcons } from '@menu/vertical-menu'
import { VerticalMenuContent, type ShellNavItem } from './VerticalMenuContent'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'
import { useSettings } from '@core/hooks/useSettings'

// Style Imports
import navigationCustomStyles from '@core/styles/vertical/navigationCustomStyles'
import { menuClasses, verticalNavClasses } from '@menu/utils/menuClasses'

/**
 * PORTED FROM TrackVid-Monitor (src/components/layout/vertical/Navigation.tsx).
 *
 * WHAT WAS OURS HERE IS NOW THE OS's. The macOS window used to have no title
 * bar, so this header doubled as the strip you grab to move the window and as
 * the thing that had to duck under the traffic lights — which cost a 34px shim,
 * a drag region, and an opt-out on every control inside it. The window has a
 * real title bar again, so all of that is gone and this is just a header.
 *
 * The rail's lock/unlock went with it, to the navbar; see NavToggle in
 * AppShell for why a control cannot live on the surface it collapses.
 *
 * Monitor's semiDark branch is gone with the setting.
 */

/**
 * How wide the rail runs.
 *
 * MONITOR'S DEFAULT IS 260px and it is right for Monitor, which has forty
 * entries and some long ones. This app has six, the longest of which is
 * "Background Process", and at 260 every row ended a long way short of the
 * edge — a column of labels with a band of nothing after each one.
 *
 * 215 is measured, not picked: 12px of rail padding each side, 10px of button
 * padding each side, a 16px icon and its 10px gap leaves ~145px for the label,
 * against roughly 113px for "Background Process" set in 13px Geist. Enough
 * headroom for a longer entry without leaving a dead band after a short one.
 *
 * IF A LONGER ENTRY IS EVER ADDED, this is the number to revisit — the menu
 * truncates rather than wraps, so it will fail quietly by clipping a word.
 */
/*
 * THE FLOATING GLASS RAIL (Veylix `.sidebar`): 248px wide, inset 16px from the
 * window on three sides, a 30px corner, the chrome gradient, a white edge and a
 * soft lift. The rail's ROOT is the inset plus the card, so the page starts one
 * grid gap (the content's own 16px gutter) after the card's edge.
 */
const SHELL_INSET = 16
const RAIL_WIDTH = 248
const RAIL_COLLAPSED = 72
const NAV_WIDTH = RAIL_WIDTH + SHELL_INSET

const StyledBoxForShadow = styled('div')(({ theme }) => ({
  top: 60,
  left: -8,
  zIndex: 2,
  opacity: 0,
  position: 'absolute',
  pointerEvents: 'none',
  width: 'calc(100% + 15px)',
  height: theme.mixins.toolbar.minHeight,
  transition: 'opacity .15s ease-in-out',
  // A faint warm fade under the header as the list scrolls (the rail is glass now,
  // so a paper-coloured fade would read as a band).
  background: 'linear-gradient(var(--veylix-hairline-soft), transparent)',
  '&.scrolled': {
    opacity: 1
  }
}))

interface Props {
  items: readonly ShellNavItem[]
  /** The product mark, drawn by the app. */
  brand: React.ReactNode
  /**
   * The build line at the foot of the rail.
   *
   * Not Monitor's — its rail ends at the menu. This app has always shown which
   * version and platform the machine is running, and it is the first thing
   * asked for when an operator reports something, so it keeps its place.
   */
  footer?: React.ReactNode
  /**
   * A warning pinned to the very bottom of the rail — e.g. a missing Chrome.
   * Not inside `footer`, which truncates to one line per row.
   */
  alert?: React.ReactNode
}

export const Navigation = ({ items, brand, footer, alert }: Props) => {
  const verticalNavOptions = useVerticalNav()
  const { settings } = useSettings()
  const theme = useTheme()
  const shadowRef = useRef<HTMLDivElement | null>(null)

  const { isCollapsed, isHovered, collapseVerticalNav, isBreakpointReached } = verticalNavOptions

  const scrollMenu = (container: unknown, isPerfectScrollbar: boolean): void => {
    const target =
      isBreakpointReached || !isPerfectScrollbar
        ? (container as { target: HTMLElement }).target
        : (container as HTMLElement)

    if (!shadowRef.current) return

    if (target.scrollTop > 0) shadowRef.current.classList.add('scrolled')
    else shadowRef.current.classList.remove('scrolled')
  }

  // The rail's collapsed state lives in the settings, so it survives a restart
  // once those are persisted. Monitor does the same.
  useEffect(() => {
    collapseVerticalNav(settings.layout === 'collapsed')
  }, [collapseVerticalNav, settings.layout])

  return (
    <VerticalNav
      customStyles={{
        ...navigationCustomStyles(verticalNavOptions, theme),

        /*
         * Two corrections to the ported rail, both about the space AFTER a
         * label rather than the label itself.
         *
         * The menu's own 24px inline padding is Monitor's, and on a 215px rail
         * it is a quarter of the width spent on margin. 12px keeps the rows
         * clear of the edge without the band of nothing that made the rail
         * look half-empty.
         *
         * The header's is `spacing(5.5, 4)` — 44px leading, 32px trailing.
         * That asymmetry is invisible behind a left-aligned mark and very
         * visible behind a centred one, which is what it now holds: the mark
         * would sit 6px right of centre and look like a mistake.
         */
        [`& .${menuClasses.root}`]: {
          paddingBlock: theme.spacing(1),
          paddingInline: theme.spacing(1.5)
        },
        [`& .${verticalNavClasses.container}`]: {
          inlineSize: `calc(100% - ${SHELL_INSET}px) !important`,
          blockSize: `calc(100vh - ${2 * SHELL_INSET}px) !important`,
          marginBlock: `${SHELL_INSET}px`,
          marginInlineStart: `${SHELL_INSET}px`,
          borderRadius: 30,
          backgroundColor: 'transparent !important',
          backgroundImage: 'var(--veylix-chrome)',
          border: '1px solid var(--veylix-chrome-border)',
          boxShadow: 'var(--veylix-chrome-shadow)',
          WebkitBackdropFilter: 'blur(24px) saturate(135%)',
          backdropFilter: 'blur(24px) saturate(135%)',
          overflow: 'hidden'
        },
        [`& .${verticalNavClasses.header}`]: {
          ...(navigationCustomStyles(verticalNavOptions, theme) as Record<
            string,
            Record<string, unknown>
          >)[`& .${verticalNavClasses.header}`],
          paddingInline: theme.spacing(2),
          ...(isCollapsed && !isHovered ? {} : { paddingBlock: theme.spacing(4) })
        }
      }}
      width={NAV_WIDTH}
      collapsedWidth={RAIL_COLLAPSED + SHELL_INSET}
      backgroundColor='transparent'
    >
      <NavHeader>
        {/* `is-full justify-center` rather than the ported left alignment:
            the mark is the only thing in this header on a desktop window, and
            a wordmark hard against the leading edge of a 215px rail reads as
            unplaced rather than as deliberate. */}
        <div className='flex items-center justify-center is-full min-is-0'>{brand}</div>
        {/* ONLY THE CLOSE BUTTON IS LEFT HERE.
            Lock and unlock moved to the navbar, because a control that shrinks
            the surface it is standing on walks out from under the cursor that
            just pressed it — see NavToggle in AppShell. Close stays: at this
            width the rail is a drawer over the page, and dismissing it from
            inside is the one gesture that belongs to the drawer itself. */}
        {isBreakpointReached && (
          <div className='flex items-center'>
            <NavCollapseIcons closeIcon={<i className='tabler-x text-xl' />} />
          </div>
        )}
      </NavHeader>
      <StyledBoxForShadow ref={shadowRef} />
      <VerticalMenuContent items={items} scrollMenu={scrollMenu} />
      {footer && !(isCollapsed && !isHovered) && (
        <div className='plb-3 pli-5 text-xs text-textDisabled truncate'>{footer}</div>
      )}
      {/* `mbs-auto` pushes it to the foot: the rail's container is a flex column. */}
      {alert && !(isCollapsed && !isHovered) && <div className='mbs-auto pli-3 pbe-3'>{alert}</div>}
    </VerticalNav>
  )
}
