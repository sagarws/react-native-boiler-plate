// Navigation Imports
import { idToHref, useNavigation } from './NavigationContext'

/**
 * Stands in for `next/navigation`, which the ported menu imports.
 *
 * Only `usePathname` is needed: the menu uses it to work out which item is the
 * current one. `useParams` is exported because Monitor's components sometimes
 * reach for the language segment, and returning an empty object is the honest
 * answer for an app that has no route parameters.
 */

/** `/claims` for the screen that is open. */
export const usePathname = (): string => idToHref(useNavigation().activeId)

export const useParams = (): Record<string, string> => ({})
