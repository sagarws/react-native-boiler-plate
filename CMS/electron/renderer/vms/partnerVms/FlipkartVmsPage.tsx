import { useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { sanitiseRect, type MirrorState } from '@shared/vms/partnerVms'
import { LoadingState } from '@renderer/components/data/StateBlocks'

import { vmsClient } from '../services/vmsClient'
import { useVmsSession } from '../VmsSessionContext'
import { MirrorStatusPill } from './MirrorStatusChip'
import { isBlockingOverlayOpen } from '@shared/vms/partnerVmsOverlay'
import { setVmsPage } from './pageStore'
import { partnerVmsClient } from './partnerVmsClient'
import { mirrorPresentation } from '@shared/vms/partnerVmsPresentation'
import { usePartnerVms, usePartnerVmsEnabled } from './usePartnerVms'

/**
 * Host for Flipkart's VMS page — TrackVid-App's FlipkartVmsPage.
 *
 * This component draws almost nothing. The real page is a WebContentsView owned
 * by the main process, positioned over the host box below — so it survives
 * every screen change, and the seller's login and connected feed are never lost
 * by navigating away. All this does is report where to draw it, and ask main to
 * reveal it while mounted. The copy underneath is only ever visible while the
 * view is starting, failed to come up, or is stepped aside for a dialog.
 */
const FlipkartVmsHost = () => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // The seller has opened the page and is looking at it: bring it up now
  // rather than waiting on the packing camera.
  const { enabled, status, show, hide } = usePartnerVms({ waitForCamera: false })
  const [hiddenForOverlay, setHiddenForOverlay] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined

    let lastSent = ''
    const publishBounds = (force = false): void => {
      const el = hostRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const rect = sanitiseRect({ x: r.left, y: r.top, width: r.width, height: r.height })
      if (!rect) return
      const key = `${rect.x},${rect.y},${rect.width},${rect.height}`
      if (!force && key === lastSent) return
      lastSent = key
      void partnerVmsClient.setBounds(rect)
    }
    const onResize = (): void => publishBounds()

    publishBounds()

    /**
     * Step out of the way whenever a dialog, menu or popover opens. Their page
     * paints ON TOP of everything the renderer draws, so a dialog opened while
     * it shows (sign out, the feed picker, failed uploads) would be hidden
     * behind it and the app would look frozen. One DOM watch catches every one
     * of them, including dialogs added later. Hidden, never destroyed.
     */
    let blocked = isBlockingOverlayOpen(document)
    // The DOM is the external system here; this mirrors its state once on entry.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHiddenForOverlay(blocked)
    if (blocked) hide()
    else show()

    const syncVisibility = (): void => {
      const now = isBlockingOverlayOpen(document)
      if (now === blocked) return
      blocked = now
      setHiddenForOverlay(now)
      if (now) {
        hide()
      } else {
        publishBounds(true)
        show()
      }
    }

    const overlayWatcher = new MutationObserver(syncVisibility)
    overlayWatcher.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })

    window.addEventListener('resize', onResize)
    const resize = new ResizeObserver(onResize)
    if (hostRef.current) resize.observe(hostRef.current)
    // The rail collapsing / expanding moves the host without resizing it.
    const settle = window.setInterval(onResize, 1000)

    return () => {
      window.removeEventListener('resize', onResize)
      window.clearInterval(settle)
      resize.disconnect()
      overlayWatcher.disconnect()
      // Hidden, never destroyed — the session stays logged in and connected.
      hide()
    }
  }, [enabled, show, hide])

  const state: MirrorState = status.state
  const failed = state === 'DISABLED' && Boolean(status.lastError)

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center gap-3'>
        <Typography variant='body2' color='text.secondary' sx={{ flex: 1, minInlineSize: 240 }}>
          Log in and connect your desk feed here once. TrackVid keeps it connected in the background after that, and
          records every Flipkart and Myntra order in Flipkart VMS as well.
        </Typography>
        <MirrorStatusPill state={state} variant='inline' />
      </div>

      <Box
        className='veylix-glass'
        sx={{
          position: 'relative',
          overflow: 'hidden',
          blockSize: 'calc(100dvh - 232px)',
          minBlockSize: 420
        }}
      >
        <Box
          ref={hostRef}
          data-partner-vms-host=''
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 3
          }}
        >
          <div className='flex max-w-md flex-col items-center gap-2 text-center'>
            {failed ? (
              <i className='tabler-plug-connected-x text-4xl' aria-hidden='true' style={{ color: 'var(--mui-palette-error-main)' }} />
            ) : hiddenForOverlay ? (
              <i className='tabler-layers-subtract text-4xl' aria-hidden='true' style={{ color: 'var(--mui-palette-text-disabled)' }} />
            ) : (
              <CircularProgress size={28} />
            )}
            <Typography sx={{ fontSize: 16, fontWeight: 700, color: 'text.primary' }}>
              {failed
                ? 'Flipkart VMS could not be opened'
                : hiddenForOverlay
                  ? 'Flipkart VMS is behind this dialog'
                  : 'Opening Flipkart VMS…'}
            </Typography>
            <Typography variant='body2' color='text.secondary'>
              {failed
                ? 'Check this computer’s internet connection, then open this page again. Recording in TrackVid is not affected.'
                : hiddenForOverlay
                  ? 'It comes back as soon as the dialog closes.'
                  : mirrorPresentation(state).nudge ?? 'Their page appears here in a moment.'}
            </Typography>
            {status.lastError && (
              <Typography variant='caption' color='text.disabled' className='font-mono' sx={{ mt: 1, wordBreak: 'break-word' }}>
                {status.lastError}
              </Typography>
            )}
          </div>
        </Box>
      </Box>
    </div>
  )
}

/**
 * Keeps the Flipkart VMS page shut for feeds without the mirror — gated on the
 * page itself, not only its rail entry (TrackVid-App 00a8d5b).
 *
 * It WAITS for the session before turning anyone away, and that wait is the
 * point: the flag rides in on the feed session, which starts signed-out and
 * fills in after main answers. Reading the flag alone at that moment says "not
 * enabled" for an entitled desk and throws the seller off a page they were
 * halfway through logging into. So with no session yet it asks main once and
 * decides on that answer.
 */
export const FlipkartVmsPage = () => {
  const { session } = useVmsSession()
  const enabled = usePartnerVmsEnabled()
  const known = session.authenticated && session.user !== null
  const [answer, setAnswer] = useState<'pending' | 'entitled' | 'not-entitled'>('pending')

  useEffect(() => {
    if (known) return undefined
    let cancelled = false
    void vmsClient.feedSession().then((response) => {
      if (cancelled) return
      const user = response.success && response.data.authenticated ? response.data.user : null
      setAnswer(user?.partnerVmsEnabled === true ? 'entitled' : 'not-entitled')
    })
    return () => {
      cancelled = true
    }
  }, [known])

  const turnAway = known ? !enabled : answer === 'not-entitled'

  useEffect(() => {
    if (turnAway) setVmsPage('recorder')
  }, [turnAway])

  if (turnAway) return null
  // Entitled per main but the shell's copy of the session has not landed yet.
  if (!known) return <LoadingState label='Waiting for the feed session…' />
  return <FlipkartVmsHost />
}
