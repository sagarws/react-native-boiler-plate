import { useCallback, useEffect, useState } from 'react'
import MenuItem from '@mui/material/MenuItem'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import CustomTextField from '@core/components/mui/TextField'
import { Button } from '@renderer/components/ui/Button'
import { useAppSelector } from '@renderer/vms/store/store'
import { CaptureShell, type CaptureSource } from './CaptureShell'
import { useVideoDevices } from './hooks/useVideoDevices'
import { useWebcamRecorder } from './hooks/useWebcamRecorder'
import { useMediaPermissions } from '@renderer/vms/hooks/useMediaPermissions'
import { useRecorderSession } from './RecorderContext'
import { markCameraGone, markCameraLive } from '@renderer/vms/partnerVms/cameraLive'
import { captureVideoFrame } from './utils/captureFrame'

/**
 * Webcam order capture — CaptureShell with a getUserMedia preview,
 * useWebcamRecorder as the source, a Device select and a video-element
 * screenshot. Ported from Argos Watch's OrderCapture.
 */
export const OrderCapture = () => {
  const { user } = useRecorderSession()
  const [deviceId, setDeviceId] = useState<string>('')
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null)

  const devices = useVideoDevices()
  const { openDialog: openPermissionsDialog } = useMediaPermissions()

  // Read at paint time, so the burned-in clock keeps running and an AWB
  // scanned mid-recording reaches the frames after it.
  const trackingId = useAppSelector(state => state.video.trackingId)
  const feedName = user?.feed?.feedName

  const getStampFields = useCallback(
    () => ({
      at: new Date(),
      ...(trackingId ? { awb: trackingId } : {}),
      ...(feedName ? { feed: feedName } : {})
    }),
    [trackingId, feedName]
  )

  const capture = useWebcamRecorder({
    deviceId: deviceId || undefined,
    resolution: user?.company?.desktopAppResolution,
    getStampFields
  })

  const captureVideoRef = capture.videoRef

  // Hand the <video> to the hook's ref AND keep a local handle for screenshots.
  const attachVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      captureVideoRef(node)
      setVideoEl(node)
    },
    [captureVideoRef]
  )

  useEffect(() => {
    if (deviceId || devices.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- first device becomes the default, as in Argos Watch
    setDeviceId(devices[0]!.deviceId)
  }, [devices, deviceId])

  /*
   * Tell the Flipkart VMS mirror which camera is open, and at what format, the
   * moment the preview stream is live (TrackVid-App 53b8751 / 9085246): it
   * waits for this before starting, so this recorder opens the device first
   * and their page joins the same camera at the same format. Read off the live
   * track, which is the camera genuinely open — the device list can lag.
   */
  useEffect(() => {
    if (capture.status !== 'preview' && capture.status !== 'recording') return
    const stream = videoEl?.srcObject

    if (!(stream instanceof MediaStream)) return
    const track = stream.getVideoTracks()[0]

    if (!track) return
    const got = track.getSettings()

    markCameraLive(track.label || null, got.width && got.height ? { width: got.width, height: got.height, ...(got.frameRate ? { frameRate: Math.round(got.frameRate) } : {}) } : null)
  }, [capture.status, videoEl, deviceId])

  // Leaving the recorder releases the camera; the mirror must stop assuming it is open.
  useEffect(() => markCameraGone, [])

  const source: CaptureSource = {
    status: capture.status,
    error: capture.error,
    elapsedSeconds: capture.elapsedSeconds,
    start: capture.start,
    stop: capture.stop
  }

  const getScreenshot = useCallback(
    (): string | null => (videoEl ? captureVideoFrame(videoEl, 0.85, getStampFields()) : null),
    [videoEl, getStampFields]
  )

  const showPreview = capture.status === 'preview' || capture.status === 'recording' || capture.status === 'stopping'

  const preview = showPreview ? (
    <video ref={attachVideoRef} playsInline muted className='block h-full w-full object-cover' />
  ) : capture.status === 'permission-denied' ? (
    <div className='flex max-w-md flex-col items-center gap-2 px-6 text-center'>
      <i className='tabler-video-off text-4xl' aria-hidden='true' style={{ color: 'var(--mui-palette-error-main)' }} />
      <Typography sx={{ fontWeight: 700, color: 'inherit' }}>Camera permission denied</Typography>
      <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.7 }}>
        Your system is blocking camera or microphone access for this app.
      </Typography>
      {/* The fix is an OS setting: give the operator the dialog that reaches it. */}
      <div className='mbs-2'>
        <Button size='sm' onClick={openPermissionsDialog} icon={<i className='tabler-settings' />}>
          Fix permissions
        </Button>
      </div>
    </div>
  ) : capture.status === 'error' ? (
    <div className='flex max-w-md flex-col items-center gap-2 px-6 text-center'>
      <i className='tabler-alert-circle text-4xl' aria-hidden='true' style={{ color: 'var(--mui-palette-error-main)' }} />
      <Typography sx={{ fontWeight: 700, color: 'inherit' }}>Recording error</Typography>
      <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.7 }}>
        {capture.error ?? 'Unknown error'}
      </Typography>
    </div>
  ) : (
    <div className='flex flex-col items-center gap-3' role='status'>
      <CircularProgress size={28} color='inherit' />
      <Typography variant='body2' sx={{ color: 'inherit', opacity: 0.7 }}>
        Requesting camera…
      </Typography>
    </div>
  )

  const deviceSelect = (
    <CustomTextField
      select
      label='Device'
      value={deviceId}
      onChange={event => setDeviceId(event.target.value)}
      disabled={capture.status === 'recording'}
      sx={{ minInlineSize: 150, maxInlineSize: 220 }}
    >
      {devices.length === 0 && (
        <MenuItem value='' disabled>
          No cameras
        </MenuItem>
      )}
      {devices.map(device => (
        <MenuItem key={device.deviceId} value={device.deviceId}>
          {device.label}
        </MenuItem>
      ))}
    </CustomTextField>
  )

  return (
    <CaptureShell
      capture={source}
      preview={preview}
      getScreenshot={getScreenshot}
      extraToolbarItems={deviceSelect}
    />
  )
}
