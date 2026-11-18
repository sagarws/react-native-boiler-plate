import logo from '@renderer/assets/logo.svg'
import { BackgroundWork } from '@renderer/components/BackgroundWork'
import { DevModeModal } from '@renderer/components/DevModeModal'
import { useRef, useState, type ReactNode } from 'react'
import { classNames } from '@renderer/utils/format'

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  /** Modules that are not built yet are shown but disabled. */
  disabled?: boolean
}

export interface AppLayoutProps {
  navItems: readonly NavItem[]
  activeId: string
  onNavigate: (id: string) => void
  /** Rendered at the bottom of the sidebar - build/platform information. */
  headerMeta?: ReactNode
  /** Signed-in identity, pinned to the top-right corner. */
  userSlot?: ReactNode
  /** Full-width notice above the page content, e.g. "an update is available". */
  banner?: ReactNode
  children: ReactNode
  /** Full-width alert below the header, above the page. */
  notice?: ReactNode
}

/**
 * How many clicks on the mark open the developer-mode box.
 *
 * The convention for exactly this, and hard to hit by accident — the logo is
 * not a control, so nobody clicks it once, let alone five times running.
 */
const DEV_CLICKS = 5
/** Clicks further apart than this are two separate fidgets, not a sequence. */
const DEV_WINDOW_MS = 1500

export const AppLayout = ({
  navItems,
  activeId,
  onNavigate,
  headerMeta,
  userSlot,
  banner,
  children,
  notice
}: AppLayoutProps) => {
  const [devOpen, setDevOpen] = useState(false)
  const activeLabel = navItems.find(item => item.id === activeId)?.label ?? ''
  const clicks = useRef({ count: 0, last: 0 })

  const tapLogo = (): void => {
    const now = Date.now()
    // Restarted rather than incremented when the gap is too long, so a stray
    // click today and four tomorrow is not a sequence.
    const count = now - clicks.current.last > DEV_WINDOW_MS ? 1 : clicks.current.count + 1

    clicks.current = { count, last: now }

    if (count >= DEV_CLICKS) {
      clicks.current = { count: 0, last: 0 }
      setDevOpen(true)
    }
  }

  return (
  <div className="flex h-full">
    {/* A PALE SIDEBAR NEEDS AN EDGE. While the slab was dark it separated
        itself from the page; at two steps apart it needs a rule, or the app
        reads as one undivided wash. */}
    <aside className="flex w-60 shrink-0 flex-col border-r border-subtle bg-sidebar text-sidebar-fg">
      {/* Extra top padding leaves room for the macOS traffic lights. */}
      {/* Left half of the drag strip. On macOS the traffic lights sit here, so
          the padding already clears them. */}
      <div className="app-drag flex h-14 items-center gap-2 px-5 pt-2">
        {/* The web app's own mark, so the two read as one product. Fixed height
            rather than a width so a future logo with different proportions does
            not change the header's height. */}
        {/* Five clicks open developer mode. Deliberately undiscoverable: an
            operator who has not been told about it has no reason to find it,
            and a menu item would be an invitation. `app-no-drag` because the
            strip around it drags the window, which would swallow the clicks. */}
        {/* The mark sits on the accent rather than on the slab: at this size
            a full-colour logo on a pale ground is a smudge, and the tile is
            what makes it read as a product mark. */}
        <span
          onClick={tapLogo}
          className="app-no-drag flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent"
        >
          <img src={logo} alt="" aria-hidden="true" className="h-5 w-auto" />
        </span>
        <span className="text-sm font-semibold text-sidebar-strong">TrackVid CMS</span>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-1 px-3 py-4">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            aria-current={item.id === activeId ? 'page' : undefined}
            onClick={() => onNavigate(item.id)}
            /*
             * A RAIL, not just a fill. The current item was a slightly lighter
             * slab on a dark slab, which at a glance is the same shape as the
             * hover state — so "where am I" and "what is under the pointer"
             * looked alike. The accent bar answers the first at a distance and
             * hover keeps the second, and the icon brightens with the label
             * rather than staying muted underneath it.
             */
            className={classNames(
              'relative flex h-9 w-full items-center gap-3 rounded-md pl-4 pr-3 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              'before:absolute before:left-0 before:h-5 before:w-0.5 before:rounded-full before:bg-accent before:transition-opacity',
              item.id === activeId
                ? 'bg-sidebar-active font-medium text-sidebar-active-fg before:opacity-100'
                : 'before:opacity-0 hover:bg-sidebar-hover hover:text-sidebar-strong',
              item.disabled && 'cursor-not-allowed opacity-40 hover:bg-transparent'
            )}
          >
            <span
              aria-hidden="true"
              className={item.id === activeId ? 'text-sidebar-active-fg' : 'text-sidebar-muted'}
            >
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-subtle px-5 py-4 text-2xs text-sidebar-muted">
        {headerMeta}
      </div>
    </aside>

    <main className="flex min-w-0 flex-1 flex-col bg-canvas">
      {/*
        ALWAYS RENDERED, because it now says where you are.
        The section over the page name is the same pair the breadcrumb below
        repeats, and it is the only thing on screen when the window is
        scrolled — a title that scrolls away leaves an operator with six
        identical-looking tables.
      */}
      <div className="app-drag flex h-14 shrink-0 items-center gap-4 border-b border-subtle bg-surface px-6">
        <div className="app-no-drag min-w-0">
          <p className="text-2xs font-medium uppercase tracking-wider text-muted">
            TrackVid Operations
          </p>
          <p className="truncate text-sm font-semibold text-primary">{activeLabel}</p>
        </div>

        {/* Both children opt OUT: `drag` inherits, and a banner with an
            "Update now" button or a user menu that cannot be clicked is a
            worse bug than a window that will not move. */}
        <div className="app-no-drag min-w-0 flex-1">{banner}</div>
        <div className="app-no-drag">{userSlot}</div>
      </div>
      {/* Its own row rather than the header slot: an alert that lists platforms
          and carries an action does not fit a 56px bar beside the user menu. */}
      {notice && <div className="shrink-0 px-6 pt-3">{notice}</div>}
      {children}

      {/* Fixed to the window, not the page: automations outlive the screen
          they were started from, so the answer to "is it still running?"
          has to follow the operator around. Renders nothing when idle. */}
      <BackgroundWork />
      <DevModeModal open={devOpen} onClose={() => setDevOpen(false)} />
    </main>
  </div>
)
}

export const PageHeader = ({
  title,
  description,
  actions,
  section = 'Operations'
}: {
  title: string
  description?: string
  actions?: ReactNode
  /** The first half of the breadcrumb. Every screen here is Operations. */
  section?: string
}) => (
  /*
   * THE TITLE IS THE BIGGEST THING ON THE PAGE, and it was not.
   *
   * At `text-lg` it was the same weight as a card heading, so six screens that
   * differ mostly by their table looked alike at a glance. A page title is the
   * one piece of text that answers "where am I" without reading anything else,
   * and the breadcrumb above it is what makes that answer a place rather than
   * a word.
   *
   * No bottom border and no card: it sits ON the page, which is what lets the
   * cards below read as the content.
   */
  <header className="flex items-end justify-between gap-4 px-6 pb-5 pt-6">
    <div className="min-w-0">
      <p className="text-2xs font-semibold uppercase tracking-wider text-accent">
        {section} / {title}
      </p>
      <h1 className="mt-1.5 truncate text-3xl font-bold tracking-tight text-primary">{title}</h1>
      {description && <p className="mt-1 truncate text-sm text-muted">{description}</p>}
    </div>
    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
  </header>
)

/**
 * The width every page's content sits in.
 *
 * Four pages each picked their own — Settings and User detail at `max-w-3xl`
 * (768px), Dashboard and Sessions at `max-w-6xl` — so on a 1900px window the
 * settings column used a third of the screen and left the rest empty, while
 * the dashboard beside it used two thirds. Inconsistent, and mostly margin.
 *
 * `--container-page` (1664px) uses the space a desktop tool is given without
 * letting a table stretch to an unreadable width on an ultrawide. Paragraphs
 * inside cards keep their own `max-w-prose` — a wide PAGE is right, a wide
 * line of text is not. The number itself lives in styles/theme.css.
 */
export const PAGE_WIDTH = 'mx-auto w-full max-w-[var(--container-page)]'
