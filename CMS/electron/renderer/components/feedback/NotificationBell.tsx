import { useState } from 'react'
import Badge from '@mui/material/Badge'
import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import { useNotifications } from '@renderer/hooks/useNotifications'
import { classNames } from '@renderer/utils/format'
import { relativeTime } from '@shared/utils/sessionHealth'

/**
 * The bell, its unread count, and the panel behind it.
 *
 * Everything the app has said this session, readable at leisure. A toast is
 * four seconds and one line; this is the place a stack trace can actually be
 * looked at — collapsed to its first line so a hundred of them still scan, and
 * expanded on the one that matters.
 */

/** The dot beside each entry, in the theme's status colours. */
const TONE_DOT: Record<string, string> = {
  success: 'success.main',
  error: 'error.main',
  info: 'info.main'
}

export const NotificationBell = () => {
  const { items, unread, markAllRead, clear } = useNotifications()
  // The bell the panel hangs from; null while it is closed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [expanded, setExpanded] = useState<number | null>(null)
  const open = Boolean(anchor)

  const toggle = (target: HTMLElement): void => {
    if (open) {
      setAnchor(null)

      return
    }

    setAnchor(target)
    // Opening it IS reading it. Leaving the badge lit after the operator has
    // looked would train them to ignore it.
    markAllRead()
  }

  return (
    <>
      <IconButton
        size='small'
        onClick={event => toggle(event.currentTarget)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup='dialog'
        aria-expanded={open}
        // Room on the right for the count, which hangs past the glyph. Reserved
        // always, so reading the notifications does not shift the navbar.
        className={classNames('mie-3', open && 'bg-actionSelected')}
      >
        {/*
          Past 99 the exact number stops meaning anything.

          THE COUNT HANGS OFF THE BELL'S SHOULDER, it does not sit on it. MUI
          centres a badge on the corner, so a wider count ("12", "99+") grew
          leftwards across the glyph until the bell was hidden. Pinning its LEFT
          edge 6px inside the glyph makes every width grow outwards instead,
          overlapping only the empty corner beside the bell's top.

          The transform is replaced, so the hidden state is restated: MUI hides
          a zero count with `scale(0)`, and without it an empty red pill shows.
        */}
        <Badge
          badgeContent={unread}
          max={99}
          color='error'
          overlap='rectangular'
          sx={{
            '& .MuiBadge-badge': {
              top: -8,
              right: 'auto',
              left: 'calc(100% - 6px)',
              transform: 'none',
              transformOrigin: 'left top'
            },
            '& .MuiBadge-badge.MuiBadge-invisible': { transform: 'scale(0)' }
          }}
        >
          <i className='tabler-bell text-xl' />
        </Badge>
      </IconButton>

      {/*
        A Popover: it renders above the page in a portal and owns click-away
        and Escape — a panel that traps the operator is worse than no panel,
        and this one sits over the page they were reading.
      */}
      <Popover
        open={open}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{
          paper: { role: 'dialog', 'aria-label': 'Notifications', className: 'mbs-1 w-96 overflow-hidden' }
        }}
      >
        <div className='flex items-center justify-between gap-2 pli-3 plb-2'>
          <Typography variant='subtitle2' className='font-semibold'>
            Notifications{items.length > 0 && ` (${items.length})`}
          </Typography>
          {items.length > 0 && (
            <Button size='small' variant='text' color='secondary' onClick={clear}>
              Clear
            </Button>
          )}
        </div>

        <Divider />

        {items.length === 0 ? (
          <div className='flex flex-col items-center gap-1 pli-3 plb-8'>
            <i className='tabler-bell text-2xl text-textDisabled' />
            <Typography variant='body2' color='text.secondary'>
              Nothing yet
            </Typography>
          </div>
        ) : (
          <ul className='m-0 max-h-96 list-none overflow-y-auto p-0'>
            {items.map((item, index) => {
              const isOpen = expanded === item.id
              // A message with nothing behind it must not offer to expand —
              // a row that opens to reveal what it already said is worse
              // than one that does not open at all.
              const hasDetail = Boolean(item.detail)

              return (
                <li key={item.id}>
                  {index > 0 && <Divider />}
                  <ButtonBase
                    disabled={!hasDetail}
                    aria-expanded={hasDetail ? isOpen : undefined}
                    onClick={() => setExpanded(isOpen ? null : item.id)}
                    className={classNames(
                      'flex w-full items-start justify-start gap-2.5 pli-3 plb-2 text-start',
                      hasDetail && 'hover:bg-actionHover'
                    )}
                  >
                    <Box
                      aria-hidden='true'
                      component='span'
                      className='mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full'
                      sx={{ bgcolor: TONE_DOT[item.tone] ?? TONE_DOT.info }}
                    />
                    <span className='flex min-w-0 flex-1 flex-col'>
                      {/* Collapsed: ONE line, cut to the panel's width. */}
                      <Typography variant='body2' className={isOpen ? 'break-words' : 'truncate'}>
                        {item.title}
                      </Typography>
                      <Typography variant='caption' color='text.disabled'>
                        {relativeTime(item.at)}
                        {hasDetail && !isOpen && ' · click to expand'}
                      </Typography>
                    </span>
                    {hasDetail && (
                      <i
                        className={classNames(
                          'tabler-chevron-down mt-0.5 shrink-0 text-base text-textDisabled transition-transform',
                          isOpen && 'rotate-180'
                        )}
                      />
                    )}
                  </ButtonBase>

                  {isOpen && item.detail && (
                    <Typography
                      component='pre'
                      variant='caption'
                      color='text.secondary'
                      className='mli-3 mbe-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-md bg-actionHover p-2 font-mono'
                    >
                      {item.detail}
                    </Typography>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Popover>
    </>
  )
}
