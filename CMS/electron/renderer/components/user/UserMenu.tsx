import { useState } from 'react'
import Avatar from '@mui/material/Avatar'
import ButtonBase from '@mui/material/ButtonBase'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import type { AuthUser } from '@shared/types/auth'
import { classNames } from '@renderer/utils/format'

/** First letters of the first and last name; falls back to the email initial. */
const initials = (user: AuthUser): string => {
  const letters = [user.firstName, user.lastName]
    .map((part) => part.trim().charAt(0))
    .filter(Boolean)
    .join('')
  return (letters || user.email.charAt(0) || '?').toUpperCase()
}

export interface UserMenuProps {
  user: AuthUser
  /** The company this account belongs to, when its document has arrived. */
  companyName: string | null
  onViewProfile: () => void
  onSignOut: () => void
  /** Called each time the menu opens. */
  onOpen?: () => void
}

/**
 * Signed-in identity in the top-right corner: avatar, the company's name, and
 * a menu that names the person and their sign-in address.
 *
 * The outside-click and Escape listeners are attached only while the menu is
 * open and removed in the effect's cleanup - a listener left on `document` is
 * the classic long-lived-window leak.
 */
export const UserMenu = ({ user, companyName, onViewProfile, onSignOut, onOpen }: UserMenuProps) => {
  // The button the menu hangs from; null while it is closed. Click-away,
  // Escape and arrow-key movement between items are the Menu's own.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = Boolean(anchor)

  const select = (action: () => void): void => {
    setAnchor(null)
    action()
  }

  return (
    <>
      <ButtonBase
        aria-haspopup='menu'
        aria-expanded={open}
        onClick={event => {
          if (!open) onOpen?.()
          setAnchor(open ? null : event.currentTarget)
        }}
        className={classNames(
          'flex items-center gap-2 rounded-md plb-1 pis-1 pie-2 transition-colors',
          open ? 'bg-actionSelected' : 'hover:bg-actionHover'
        )}
      >
        {/* Inverted ink, so it is the darkest thing in the bar on light and
            the lightest on dark — the theme's default Avatar is a pale tint
            that the initials disappeared into. */}
        <Avatar
          aria-hidden='true'
          sx={{
            width: 28,
            height: 28,
            fontSize: '0.6875rem',
            fontWeight: 600,
            bgcolor: 'text.primary',
            color: 'background.paper'
          }}
        >
          {initials(user)}
        </Avatar>
        {/* THE COMPANY, IN FULL — the thing that says which company this window
            files claims for, so it is the one shown without opening anything.
            Not truncated: "The Indian Garage Co" cut to "The Indian Ga…" is
            the half that does not identify it. The person's own name is in
            the menu. Falls back to it while the company document arrives.
            body2, the breadcrumb's size — the two ends of the bar match. */}
        <Typography variant='body2' component='span' className='hidden whitespace-nowrap font-medium sm:block'>
          {companyName || user.fullName || user.email}
        </Typography>
        <i
          className={classNames(
            'tabler-chevron-down text-base text-textSecondary transition-transform',
            open && 'rotate-180'
          )}
        />
      </ButtonBase>

      <Menu
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { className: 'mbs-1 min-w-60' } }}
      >
        {/* WHO IS SIGNED IN — the company is already on the button. */}
        <div className='flex flex-col pli-4 plb-2'>
          <Typography variant='body2' className='truncate font-medium'>
            {user.fullName || user.email}
          </Typography>
          <Typography variant='caption' color='text.secondary' className='truncate'>
            {user.email}
          </Typography>
        </div>
        <Divider />
        <MenuItem onClick={() => select(onViewProfile)}>
          <ListItemIcon>
            <i className='tabler-user text-lg' />
          </ListItemIcon>
          <Typography variant='body2'>View profile</Typography>
        </MenuItem>
        <MenuItem onClick={() => select(onSignOut)} sx={{ color: 'error.main' }}>
          <ListItemIcon sx={{ color: 'inherit' }}>
            <i className='tabler-logout text-lg' />
          </ListItemIcon>
          <Typography variant='body2'>Sign out</Typography>
        </MenuItem>
      </Menu>
    </>
  )
}
