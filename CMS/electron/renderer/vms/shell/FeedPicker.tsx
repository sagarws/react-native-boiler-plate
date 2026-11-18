import { useState } from 'react'

import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'

import CustomTextField from '@core/components/mui/TextField'
import { ConfirmDialog } from '@renderer/components/ui/ConfirmDialog'
import { useToast } from '@renderer/hooks/useToast'

import { useAppSelector } from '../store/store'
import { useVmsSession } from '../VmsSessionContext'

/**
 * Which feed this desk records as — the header's picker, replacing Argos
 * Watch's feed login.
 *
 * Choosing a feed takes its session (main asks the backend for a feed token).
 * A feed already signed in on another desk is NOT taken silently: the operator
 * is asked first, exactly as Argos' login warned before a takeover, and only a
 * confirmed takeover sends `force`.
 *
 * Disabled feeds are listed so the operator sees they exist, but cannot be
 * chosen. The picker is locked while a recording runs: switching feed resets
 * the recorder.
 */
interface Takeover {
  feedId: string
  feedName: string
}

export const FeedPicker = () => {
  const toast = useToast()
  const { feeds, feedsLoading, feedsError, session, selecting, selectFeed, release, refreshFeeds } = useVmsSession()
  const recording = useAppSelector((state) => state.video.videoRecording)
  const [takeover, setTakeover] = useState<Takeover | null>(null)

  const heldId = session.authenticated ? (session.user?.feedId ?? '') : ''
  // A held feed missing from the list (renamed, or the list failed) still
  // shows by name rather than as an empty box.
  const options =
    heldId && !feeds.some((feed) => feed.id === heldId)
      ? [{ id: heldId, name: session.user?.feed?.feedName ?? heldId, disabled: false }, ...feeds]
      : feeds

  const choose = async (feedId: string, force = false): Promise<void> => {
    const response = await selectFeed(feedId, force)
    if (!response.success) {
      toast.error(response.error.message)
      return
    }
    if (response.data.alreadyLoggedIn) {
      setTakeover({ feedId, feedName: response.data.feedName })
      return
    }
    setTakeover(null)
    toast.success(`Recording as ${response.data.session.user?.feed?.feedName ?? 'the chosen feed'}`)
  }

  const disabled = selecting || recording || feedsLoading

  return (
    <div className='flex items-center gap-1 min-is-0'>
      <Tooltip title={recording ? 'Stop the recording to change feed' : feedsError ?? ''}>
        <span className='min-is-0'>
          <CustomTextField
            select
            size='small'
            value={heldId}
            disabled={disabled}
            error={Boolean(feedsError)}
            onChange={(event) => {
              const feedId = event.target.value
              if (feedId && feedId !== heldId) void choose(feedId)
            }}
            sx={{ inlineSize: 240, maxInlineSize: '100%' }}
            slotProps={{
              select: {
                displayEmpty: true,
                // Re-read on open: a feed added in TrackVid since the VMS opened
                // should be choosable without leaving the screen.
                onOpen: () => void refreshFeeds(),
                SelectDisplayProps: { 'aria-label': 'Feed' },
                renderValue: (selected) => {
                  const value = typeof selected === 'string' ? selected : ''
                  return value ? (
                    <span className='flex items-center gap-2 min-is-0'>
                      <i className='tabler-device-cctv text-base shrink-0' aria-hidden='true' />
                      <span className='truncate'>{options.find((feed) => feed.id === value)?.name ?? value}</span>
                    </span>
                  ) : (
                    <Typography component='span' variant='body2' color='text.disabled'>
                      {feedsLoading ? 'Loading feeds…' : feedsError ? 'Feeds unavailable' : 'Choose a feed'}
                    </Typography>
                  )
                }
              },
              input: selecting
                ? {
                    endAdornment: (
                      <InputAdornment position='end' sx={{ marginInlineEnd: 4 }}>
                        <CircularProgress size={14} />
                      </InputAdornment>
                    )
                  }
                : {}
            }}
          >
            {options.length === 0 && (
              <MenuItem value='' disabled>
                {feedsError ?? 'No feeds in this company'}
              </MenuItem>
            )}
            {options.map((feed) => (
              <MenuItem key={feed.id} value={feed.id} disabled={feed.disabled} className='gap-2'>
                <i className='tabler-device-cctv text-base' aria-hidden='true' />
                <span className='flex-1 truncate'>{feed.name}</span>
                {feed.disabled && (
                  <Typography component='span' variant='caption' color='text.disabled'>
                    Disabled
                  </Typography>
                )}
              </MenuItem>
            ))}
          </CustomTextField>
        </span>
      </Tooltip>

      {heldId && (
        <Tooltip title={recording ? 'Stop the recording first' : 'Give this feed back'}>
          <span>
            <IconButton
              size='small'
              aria-label='Release feed'
              disabled={recording || selecting}
              onClick={() => void release()}
              className='text-textSecondary'
            >
              <i className='tabler-plug-connected-x text-xl' />
            </IconButton>
          </span>
        </Tooltip>
      )}

      <ConfirmDialog
        open={takeover !== null}
        title='Take over this feed?'
        message={`${takeover?.feedName ?? 'This feed'} is signed in on another desk — take it over? That desk stops recording as this feed.`}
        confirmLabel='Take over'
        busy={selecting}
        onConfirm={() => {
          if (takeover) void choose(takeover.feedId, true)
        }}
        onCancel={() => setTakeover(null)}
      />
    </div>
  )
}
