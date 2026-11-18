// React Imports
import { isValidElement } from 'react'
import type { ReactElement, ReactNode } from 'react'

// Third-party Imports
import type { CSSObject } from '@emotion/styled'

// Type Imports
import type { ChildrenType, RenderExpandedMenuItemIcon } from '../types'

// Util Imports
import { menuClasses } from './menuClasses'

// Styled Component Imports
import StyledMenuIcon from '../styles/StyledMenuIcon'

type RenderMenuIconParams = {
  level?: number
  active?: boolean
  disabled?: boolean
  styles?: CSSObject
  icon?: ReactElement
  renderExpandedMenuItemIcon?: RenderExpandedMenuItemIcon
  isBreakpointReached?: boolean
}

// Type guard for ReactElement with specific props
type MenuItemElementProps = {
  component?: string | ReactElement<{ href?: string; [key: string]: unknown }>
  href?: string
  exactMatch?: boolean
  activeUrl?: string
  children?: ReactNode
  [key: string]: unknown
}

export const confirmUrlInChildren = (children: ChildrenType['children'], url: string): boolean => {
  if (!children) {
    return false
  }

  if (Array.isArray(children)) {
    return children.some((child: ReactNode) => confirmUrlInChildren(child, url))
  }

  if (isValidElement<MenuItemElementProps>(children)) {
    const { component, href, exactMatch, activeUrl, children: subChildren } = children.props

    if (component && typeof component !== 'string' && component.props.href) {
      return exactMatch === true || exactMatch === undefined
        ? component.props.href === url
        : activeUrl !== undefined && url.includes(activeUrl)
    }

    if (href) {
      return exactMatch === true || exactMatch === undefined
        ? href === url
        : activeUrl !== undefined && url.includes(activeUrl)
    }

    if (subChildren) {
      return confirmUrlInChildren(subChildren, url)
    }
  }

  return false
}

/*
 * DELETED WITH THE HORIZONTAL LAYOUT.
 *
 * Monitor keeps `mapHorizontalToVerticalMenu` here, which rewrites a horizontal
 * menu into a vertical one when the window gets narrow — a web template has to
 * cope with a phone. This app ships one shell, vertical, so the mapping had
 * nothing to map and its imports were the only thing pulling the horizontal
 * menu package into the build.
 *
 * If a horizontal layout is ever wanted, take this function, `../horizontal-menu`
 * and `@components/GenerateMenu` back from Monitor together — they are one unit.
 */

/*
 * Render all the icons for Menu Item and SubMenu components for all the levels more than 0
 */
export const renderMenuIcon = (params: RenderMenuIconParams) => {
  const { icon, level, active, disabled, styles, renderExpandedMenuItemIcon, isBreakpointReached } = params

  if (icon && (level === 0 || (!isBreakpointReached && level && level > 0))) {
    return (
      <StyledMenuIcon className={menuClasses.icon} rootStyles={styles}>
        {icon}
      </StyledMenuIcon>
    )
  }

  if (
    level &&
    level !== 0 &&
    renderExpandedMenuItemIcon &&
    renderExpandedMenuItemIcon.icon !== null &&
    (!renderExpandedMenuItemIcon.level || renderExpandedMenuItemIcon.level >= level)
  ) {
    const iconToRender =
      typeof renderExpandedMenuItemIcon.icon === 'function'
        ? renderExpandedMenuItemIcon.icon({ level, active, disabled })
        : renderExpandedMenuItemIcon.icon

    if (iconToRender) {
      return (
        <StyledMenuIcon className={menuClasses.icon} rootStyles={styles}>
          {iconToRender}
        </StyledMenuIcon>
      )
    }
  }

  return null
}
