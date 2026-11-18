// React Imports
import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * Where the operator is, for a shell that was written against a router.
 *
 * THE PROBLEM. Monitor's menu is a Next.js menu: every item is a `<Link href>`,
 * and each one decides whether it is the current page by comparing its `href`
 * with `usePathname()`. This app has no router and no URLs — it has an
 * `activeId` string and an `onNavigate` callback, and that is deliberate: a
 * desktop window has one screen at a time and no address bar, and adding a
 * router to satisfy a menu would be the tail wagging the dog.
 *
 * THE FIX, AND WHY IT IS SHAPED LIKE THIS. Rather than edit the ported menu
 * components — which would have to be re-edited every time we re-sync with
 * Monitor — the two Next modules they import are ALIASED to shims that read
 * from here. `next/link` becomes an anchor that calls `onNavigate`, and
 * `next/navigation`'s `usePathname` returns `/<activeId>`. The ported files
 * stay byte-identical to Monitor's and still work.
 *
 * So a nav item's `href` is `/claims`, the active id is `claims`, and the
 * comparison the menu already does gives the right answer.
 */

export interface NavigationApi {
  /** The current screen's id — the same value App has always used. */
  activeId: string
  /** What the app does when an item is chosen. */
  navigate: (id: string) => void
}

const NavigationContext = createContext<NavigationApi | null>(null)

/** `/claims` from `claims`. The one place the two spellings are converted. */
export const idToHref = (id: string): string => `/${id}`

/** `claims` from `/claims`, ignoring anything after it. */
export const hrefToId = (href: string): string => href.replace(/^\/+/, '').split(/[/?#]/)[0] ?? ''

export const NavigationProvider = ({
  activeId,
  navigate,
  children
}: NavigationApi & { children: ReactNode }) => {
  const value = useMemo<NavigationApi>(() => ({ activeId, navigate }), [activeId, navigate])

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

/**
 * Returns the navigation, or a dead one.
 *
 * NOT A THROW. The ported menu is also rendered in places that have no
 * navigation around it yet — the preview being the obvious one — and a menu
 * that crashes the screen because nothing is listening to it is worse than a
 * menu whose items do nothing. The app's own provider is always present in the
 * real shell.
 */
export const useNavigation = (): NavigationApi =>
  useContext(NavigationContext) ?? { activeId: '', navigate: () => {} }
