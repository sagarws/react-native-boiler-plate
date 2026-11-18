import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'

import useVerticalNav from '@menu/hooks/useVerticalNav'

import { useAppMode, type AppMode } from './AppModeContext'
import { useAppSelector } from './store/store'

/**
 * CMS | VMS — which half of the app is on screen. The last thing in the rail,
 * in both modes, at the same place, so the way back is where the way in was.
 *
 * The Veylix look: a glass track (the template's control surface and edge)
 * holding two segments, the chosen one in the nav's own gold pill, so "where
 * am I" reads the same here as on the active menu row above it.
 *
 * LOCKED WHILE RECORDING. Leaving the VMS unmounts the recorder, which would
 * end a recording mid-parcel; the switch says so instead. Leaving with a feed
 * held is fine — the feed is not released (uploads may still be running).
 *
 * On a collapsed rail it shrinks to one button that switches to the other half.
 */
const SEGMENTS: readonly { mode: AppMode; label: string; icon: string; hint: string }[] = [
  { mode: 'cms', label: 'CMS', icon: 'tabler-layout-dashboard', hint: 'Claims, logins and automations' },
  { mode: 'vms', label: 'VMS', icon: 'tabler-video', hint: 'Record packing video' }
]

const LOCKED_HINT = 'Stop the recording first'

export const ModeToggle = () => {
  const { mode, setMode } = useAppMode()
  const recording = useAppSelector((state) => state.video.videoRecording)
  const { isCollapsed, isHovered } = useVerticalNav()

  if (isCollapsed && !isHovered) {
    const other = SEGMENTS.find((segment) => segment.mode !== mode) ?? SEGMENTS[0]!
    const label = recording ? LOCKED_HINT : `Switch to ${other.label}`

    return (
      <div className='flex justify-center pbe-3'>
        <Tooltip title={label} placement='right'>
          <span>
            <IconButton
              aria-label={label}
              disabled={recording}
              onClick={() => setMode(other.mode)}
              sx={{
                inlineSize: 40,
                blockSize: 40,
                borderRadius: '13px',
                background: 'var(--veylix-control)',
                border: '1px solid var(--veylix-glass-border)',
                color: 'text.secondary'
              }}
            >
              <i className='tabler-switch-horizontal text-xl' />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    )
  }

  return (
    <div className='pli-3 pbe-3'>
      <Box
        role='radiogroup'
        aria-label='App mode'
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '4px',
          padding: '4px',
          borderRadius: '16px',
          backgroundImage: 'var(--veylix-glass)',
          backgroundColor: 'var(--veylix-glass-solid)',
          border: '1px solid var(--veylix-glass-border)',
          boxShadow: 'var(--veylix-shadow-tile)'
        }}
      >
        {SEGMENTS.map((segment) => {
          const active = segment.mode === mode
          const locked = !active && recording

          return (
            <Tooltip key={segment.mode} title={locked ? LOCKED_HINT : segment.hint} placement='top'>
              <span className='flex'>
                <ButtonBase
                  role='radio'
                  aria-checked={active}
                  disabled={locked}
                  onClick={() => setMode(segment.mode)}
                  sx={{
                    flex: 1,
                    gap: '7px',
                    blockSize: 36,
                    borderRadius: '12px',
                    fontSize: '0.8125rem',
                    fontWeight: active ? 700 : 600,
                    letterSpacing: '0.02em',
                    border: '1px solid',
                    transition: 'background .15s, box-shadow .15s, color .15s',
                    ...(active
                      ? {
                          background: 'var(--veylix-nav-active)',
                          borderColor: 'var(--veylix-nav-active-border)',
                          color: 'var(--veylix-nav-active-text)',
                          boxShadow: 'var(--veylix-nav-active-shadow)'
                        }
                      : {
                          background: 'transparent',
                          borderColor: 'transparent',
                          color: 'var(--veylix-nav-text)',
                          '&:hover': { background: 'var(--veylix-nav-hover)', color: 'text.primary' }
                        }),
                    '&.Mui-disabled': { opacity: 0.45 }
                  }}
                >
                  <i className={`${segment.icon} text-base`} aria-hidden='true' />
                  {segment.label}
                </ButtonBase>
              </span>
            </Tooltip>
          )
        })}
      </Box>
    </div>
  )
}
