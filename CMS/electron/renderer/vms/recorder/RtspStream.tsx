import { useCallback, useEffect, useRef, useState } from 'react'
import CircularProgress from '@mui/material/CircularProgress'
import Typography from '@mui/material/Typography'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { useAppSelector } from '@renderer/vms/store/store'
import type { StreamDiagnostics } from '@shared/vms/stream'
import { CaptureShell, type CaptureSource } from './CaptureShell'
import { useRtspRecorder } from './hooks/useRtspRecorder'
import { useRtspStream, type RtspStatus } from './hooks/useRtspStream'
import { useRecorderSession } from './RecorderContext'
import { recorderClient } from './recorderClient'
import { StreamErrorDialog } from './StreamErrorDialog'
import { drawTimestamp, maskCameraOsd } from './utils/timestampOverlay'

/**
 * IP-camera order capture. Ported from Argos Watch's RtspStream: the preview is
 * a <video> fed fragmented MP4 over `ws://127.0.0.1:<port>/rtsp?url=…` (Media
 * Source Extensions, hardware H.264 decode), and the recorder wraps a
 * MediaRecorder around a stamping canvas drawn from that element.
 */

/** Argos Watch's preview zoom (its sidebar control is switched off there). */
const ZOOM_KEY = 'trackvid.rtspZoom'

const readZoom = (): number => {
  try {
    const raw = window.localStorage.getItem(ZOOM_KEY)
    const n = raw === null ? 1 : Math.round(Number(raw))

    return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : 1
  } catch {
    return 1
  }
}

const STATUS_TONE: Record<RtspStatus, BadgeTone> = {
  streaming: 'success',
  error: 'danger',
  connecting: 'warning',
  idle: 'neutral'
}

export const RtspStream = () => {
  const { user, sidecarPort } = useRecorderSession()
  const feed = user?.feed
  const rtspUrl = feed?.rtspURL
  const [rtspZoom] = useState(readZoom)
  // The AWB lives in the order slice; read here so a scan mid-recording
  // appears in the frames after it.
  const trackingId = useAppSelector(state => state.video.trackingId)
  const feedName = feed?.feedName

  const videoRef = useRef<HTMLVideoElement | null>(null)

  const { status, error, videoRef: attachStreamVideo, reload } = useRtspStream({ rtspUrl, sidecarPort })

  // Failure detail comes from the main process, where ffmpeg runs. Fetched when
  // the status flips to error rather than polled.
  const [diagnostics, setDiagnostics] = useState<StreamDiagnostics | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  // The failure already reported, so closing the dialog does not reopen it.
  const reportedRef = useRef<string | null>(null)

  useEffect(() => {
    if (status !== 'error') {
      reportedRef.current = null

      return
    }

    let cancelled = false

    void recorderClient.streamDiagnostics().then(response => {
      if (cancelled) return
      const next = response.success ? response.data : null
      const key = next?.at ?? 'renderer-only'

      if (reportedRef.current === key) return
      reportedRef.current = key
      setDiagnostics(next)
      setDialogOpen(true)
    })

    return () => {
      cancelled = true
    }
  }, [status])

  const attachVideo = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element
      attachStreamVideo(element)
    },
    [attachStreamVideo]
  )

  const getStampFields = useCallback(
    () => ({
      at: new Date(),
      ...(trackingId ? { awb: trackingId } : {}),
      ...(feedName ? { feed: feedName } : {})
    }),
    [trackingId, feedName]
  )

  const recorder = useRtspRecorder({
    getVideo: () => videoRef.current,
    ready: status === 'streaming',
    getStampFields
  })

  const source: CaptureSource = {
    status: recorder.status,
    error: recorder.error,
    elapsedSeconds: recorder.elapsedSeconds,
    start: recorder.start,
    stop: recorder.stop
  }

  const getScreenshot = useCallback((): string | null => {
    const video = videoRef.current

    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null

    try {
      // At the camera's own resolution, so a screenshot is evidence.
      const canvas = document.createElement('canvas')

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')

      if (!context) return null
      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      // Same band and stamp as the recording.
      maskCameraOsd(context, canvas.width, canvas.height)
      drawTimestamp(context, canvas.height, getStampFields())

      return canvas.toDataURL('image/jpeg', 0.85)
    } catch {
      return null
    }
  }, [getStampFields])

  const configured = Boolean(rtspUrl)

  const preview = (
    <div className='relative flex h-full w-full items-center justify-center overflow-hidden'>
      {/* Always mounted so the ref lands before useRtspStream runs. No
          autoPlay: playback starts once the first fragment is appended. */}
      <video
        ref={attachVideo}
        muted
        playsInline
        className='h-full w-full object-contain'
        style={{
          display: configured ? 'block' : 'none',
          transform: `scale(${rtspZoom})`,
          transformOrigin: 'center center',
          transition: 'transform 120ms ease-out',
          willChange: 'transform'
        }}
      />

      {!configured && (
        <div className='flex max-w-xl flex-col items-center gap-3 px-6 text-center'>
          <i className='tabler-video text-6xl' aria-hidden='true' style={{ opacity: 0.35 }} />
          <Typography variant='h6' sx={{ color: 'inherit' }}>
            No RTSP URL configured for this feed
          </Typography>
          <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.65 }}>
            Ask an admin to set <code>rtspURL</code> on this feed, or switch the feed to{' '}
            <code>cameraType: &quot;webcam&quot;</code> to record with the USB webcam.
          </Typography>
        </div>
      )}

      {configured && status === 'connecting' && (
        <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3' role='status'>
          <CircularProgress size={36} color='inherit' />
          <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.75 }}>
            Connecting to the camera…
          </Typography>
        </div>
      )}

      {configured && status === 'error' && (
        <div className='absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center'>
          <i className='tabler-video-off text-5xl' aria-hidden='true' style={{ color: 'var(--mui-palette-error-light)' }} />
          <Typography variant='subtitle1' sx={{ fontWeight: 700, color: 'inherit' }}>
            Preview lost
          </Typography>
          <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.85, maxInlineSize: 480 }}>
            {diagnostics?.reason ??
              error ??
              'The RTSP stream ended. Check that the camera is powered, on the network, and the credentials in the RTSP URL are correct.'}
          </Typography>
          <div className='mbs-1 flex gap-2'>
            <Button size='sm' icon={<i className='tabler-refresh' />} onClick={reload}>
              Try again
            </Button>
            {/* Reopens the detail the operator dismissed — the only copy of ffmpeg's output. */}
            <Button variant='inverse' size='sm' icon={<i className='tabler-alert-circle' />} onClick={() => setDialogOpen(true)}>
              Error details
            </Button>
          </div>
        </div>
      )}

      {/* Feed name + stream health, bottom-left so it clears the REC pill. */}
      {configured && (
        <div className='pointer-events-none absolute bottom-3 left-3 flex gap-1.5'>
          <Badge>{feed?.feedName || '—'}</Badge>
          <Badge tone={STATUS_TONE[status]}>{status}</Badge>
        </div>
      )}
    </div>
  )

  return (
    <>
      <CaptureShell capture={source} preview={preview} getScreenshot={getScreenshot} />
      <StreamErrorDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onRetry={reload}
        diagnostics={diagnostics}
        fallbackMessage={error ?? 'The camera stream stopped and no further detail was recorded.'}
      />
    </>
  )
}
