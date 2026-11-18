// React Imports
import type { ReactNode } from 'react'

// MUI Imports
import Box from '@mui/material/Box'
import MuiCard from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CardHeader from '@mui/material/CardHeader'
import Divider from '@mui/material/Divider'

// Third-party Imports
import classnames from 'classnames'

/**
 * The one card shape, rebuilt on Monitor's.
 *
 * REBUILT RATHER THAN MIGRATED SCREEN BY SCREEN, like Button and Badge before
 * it: a dozen settings panels render this, and while they waited their turn
 * each one drew a card with its own ring and its own padding next to MUI cards
 * that did not match.
 *
 * The props are unchanged — header, body, optional footer — so no caller moved.
 * What they mean is unchanged too: the header carries a title, one line of
 * description and whatever belongs on the right of it; the body is the card's
 * own business; the footer is where actions go when they belong to the whole
 * card rather than to a row in it.
 *
 * `dense` still exists for a card whose body is a list of rows that bring their
 * own padding, where the body's own would double it.
 */
export interface CardProps {
  title: ReactNode
  /** One line. Anything longer belongs in the body. */
  description?: ReactNode
  /** The right-hand side of the header — a chip, a count, a small button. */
  headerAction?: ReactNode
  /** Actions for the whole card, on a divided strip under the body. */
  footer?: ReactNode
  /** Drop the body's padding for a body that is a list of padded rows. */
  dense?: boolean
  /** An icon before the title. One set, one size. */
  icon?: ReactNode
  className?: string
  children: ReactNode
}

export const Card = ({
  title,
  description,
  headerAction,
  footer,
  dense = false,
  icon,
  className,
  children
}: CardProps) => (
  <MuiCard className={className}>
    {/*
      THE ICON SITS IN THE TITLE, not in MUI's `avatar` slot.
      `avatar` is a column of its own, centred against the whole header — with a
      two-line description beside it the icon floats in the middle of the card
      instead of reading as part of the heading.

      `variant: 'h5'` because the theme styles the SUBHEADER as `subtitle1`: left
      to its defaults the description came out larger than the thing it
      describes.
    */}
    <CardHeader
      title={
        icon ? (
          <span className='flex items-center gap-2'>
            <span className='flex text-textSecondary'>{icon}</span>
            {title}
          </span>
        ) : (
          title
        )
      }
      titleTypographyProps={{ variant: 'h5' }}
      subheader={
        description && (
          /* Capped: a wide CARD is right, a wide LINE OF TEXT is not. */
          <Box component='span' className='block' sx={{ maxInlineSize: '80ch' }}>
            {description}
          </Box>
        )
      }
      action={headerAction && <div className='flex items-center gap-2'>{headerAction}</div>}
    />

    {/* One rhythm for every card body — the panels this replaced each set their
        own gap, which is why spacing was consistent WITHIN a card and arbitrary
        between them. */}
    <CardContent className={classnames(!dense && 'flex flex-col gap-4', dense && 'p-0')}>
      {children}
    </CardContent>

    {footer && (
      <>
        <Divider />
        <CardContent className='flex flex-wrap items-center gap-2'>{footer}</CardContent>
      </>
    )}
  </MuiCard>
)
