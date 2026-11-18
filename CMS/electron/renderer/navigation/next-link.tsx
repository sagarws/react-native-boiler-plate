// React Imports
import { forwardRef, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

// Navigation Imports
import { hrefToId, useNavigation } from './NavigationContext'

/**
 * Stands in for `next/link`, which the ported menu imports.
 *
 * Aliased in electron.vite.config.ts and tsconfig, so the ported components
 * keep their original imports and stay comparable with Monitor's copies. See
 * NavigationContext for why the shim exists at all.
 *
 * It renders an anchor — the menu styles, the keyboard behaviour and the
 * accessibility tree all assume one — but it never navigates the window.
 * A renderer that followed a link would replace the app with a blank page and
 * there is no way back from that in a packaged build, which is why
 * `preventDefault` here is load-bearing rather than tidy.
 */

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children?: ReactNode
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
  const { href, onClick, children, ...rest } = props
  const { navigate } = useNavigation()

  const handleClick = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault()
    onClick?.(event)
    navigate(hrefToId(href))
  }

  return (
    <a ref={ref} href={href} onClick={handleClick} {...rest}>
      {children}
    </a>
  )
})

export default Link
