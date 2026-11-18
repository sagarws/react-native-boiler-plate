import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import MenuItem from '@mui/material/MenuItem'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import CustomTextField from '@core/components/mui/TextField'
import { Badge, type BadgeTone } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { useToast } from '@renderer/hooks/useToast'
import {
  resetOrderCheck,
  setSameOrderCheck,
  setTrackingId,
  setVideoUploadError,
  setVideoUploadLoading,
  setVideoUploadSuccess,
  setVmsECommercePlatform
} from '@renderer/vms/store/order/order.slice'
import { ECOMMERCE_PLATFORMS, type ECommercePlatform, type OrderType } from '@renderer/vms/store/order/order.types'
import {
  addScreenshot,
  clearScreenshots,
  MAX_SCREENSHOTS,
  type Screenshot
} from '@renderer/vms/store/screenshots/screenshots.slice'
import { useAppDispatch, useAppSelector } from '@renderer/vms/store/store'
import { MirrorStatusChip } from '@renderer/vms/partnerVms/MirrorStatusChip'
import {
  minimumRemainingMs,
  remainingSeconds,
  scanRefusedLogLine,
  scanRefusedMessage,
  stopHoldHint
} from '@shared/vms/partnerVmsMinClip'
import { maybeStartMirror, parkMirror } from '@renderer/vms/partnerVms/partnerVmsMirror'
import { usePartnerVmsEnabled } from '@renderer/vms/partnerVms/usePartnerVms'
import type { RecorderStatus, RecordingResult } from './hooks/useWebcamRecorder'
import { ProductConditionModal, type ProductCondition } from './ProductConditionModal'
import { ProductDetailsPanel } from './ProductDetailsPanel'
import { useRecorderSession } from './RecorderContext'
import { recorderClient } from './recorderClient'
import { ScreenshotsPanel } from './ScreenshotsPanel'
import { dataUrlToBlob } from './utils/captureFrame'
import { uploadOrder, UploadStepError, type UploadFile } from './utils/upload'

/**
 * Order-capture shell: AWB input + record button + Screenshot + Platform +
 * timer + upload flow + the screenshots and product-details panels + the
 * Return condition prompt. Ported from Argos Watch's CaptureShell; the
 * behaviour is Argos Watch's line for line, the look is Veylix's.
 *
 * Source-agnostic — accepts any capture that satisfies `CaptureSource`
 * (useWebcamRecorder, useRtspRecorder). The preview and any source-specific
 * toolbar items are slots the caller fills in.
 */

const AWB_DEBOUNCE_MS = 250
/** Same floor as TrackVid-App: anything of 5 characters or fewer is not an AWB. */
const MIN_AWB_LENGTH = 6
/** A scanner types a whole barcode well inside this; a longer gap is stray keys. */
const SCAN_IDLE_RESET_MS = 1000

/**
 * Everything an upload needs, frozen at the moment the recording stops. A
 * scanned next AWB replaces the field and the screenshots straight away, so
 * the upload of the previous order cannot read them from live state.
 */
interface OrderSnapshot {
  awb: string
  orderType: OrderType
  platform: ECommercePlatform | ''
  screenshots: Screenshot[]
  /** True when the next order was already started by a scan. */
  chained: boolean
}

/** Wall clock, read in handlers only (kept out of render for the purity lint). */
const nowMs = (): number => Date.now()

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

/** Argos Watch's order-type chip — green, red, amber — as the theme's tones. */
const ORDER_TYPE_TONE: Record<OrderType, BadgeTone> = {
  Forward: 'success',
  Return: 'danger',
  RTO: 'warning'
}

/** Minimal contract every capture source (webcam, RTSP, …) must satisfy. */
export interface CaptureSource {
  status: RecorderStatus
  error: string | null
  elapsedSeconds: number
  start: () => Promise<void>
  stop: () => Promise<RecordingResult>
}

export interface CaptureShellProps {
  capture: CaptureSource
  /** The preview node — the caller owns the element and its status overlays. */
  preview: ReactNode
  /** A JPEG data-URL from the current preview frame; null on failure. */
  getScreenshot: () => string | null
  /** Extra items after the Platform select (e.g. the webcam Device select). */
  extraToolbarItems?: ReactNode
  /** Copy for the SPACE-bar hint under the toolbar. */
  screenshotHint?: ReactNode
}

export const CaptureShell = ({
  capture,
  preview,
  getScreenshot,
  extraToolbarItems,
  screenshotHint
}: CaptureShellProps) => {
  const { user, sidecarPort } = useRecorderSession()
  const toast = useToast()
  const dispatch = useAppDispatch()
  const orderType = useAppSelector(state => state.video.orderType)
  const videoUploadLoading = useAppSelector(state => state.video.videoUploadLoading)
  const VmsECommercePlatform = useAppSelector(state => state.video.VmsECommercePlatform)
  const checkOrder = useAppSelector(state => state.video.checkOrder)
  const videoUploadError = useAppSelector(state => state.video.videoUploadError)

  const [awb, setAwb] = useState('')
  const [conditionOpen, setConditionOpen] = useState(false)
  const pendingResultRef = useRef<{ result: RecordingResult; snapshot: OrderSnapshot } | null>(null)
  const awbInputRef = useRef<HTMLInputElement | null>(null)

  // Scan-to-record. A scan either starts the first order or stops the current
  // one and starts the next. The start is deferred to an effect that runs once
  // the recorder is back in 'preview': calling start() straight after stop()
  // would use a closure that still sees 'recording' and silently do nothing.
  const autoStartRef = useRef(false)
  const [autoStartSeq, setAutoStartSeq] = useState(0)
  const scanBufferRef = useRef('')
  const lastScanKeyAtRef = useRef(0)
  const scanHandlerRef = useRef<(code: string) => void>(() => undefined)
  const screenshots = useAppSelector(state => state.screenshots.items)
  const screenshotsCount = screenshots.length

  /*
   * Flipkart VMS mirror (TrackVid-App PR #182). On a feed with the mirror, a
   * Flipkart / Myntra order is mirrored when recording starts and their side is
   * parked on every stop — fire-and-forget, never awaited, so this recorder is
   * never blocked by it. Every order on such a feed also runs for at least
   * MIN_CLIP_MS (their page cannot cut a shorter clip): an early scan is
   * refused with a countdown and Stop waits. Fails open without a start time.
   */
  const mirrorEnabled = usePartnerVmsEnabled()
  const startedAtRef = useRef<number | null>(null)
  const [holdLeft, setHoldLeft] = useState(0)
  const holdRemainingMs = (): number => minimumRemainingMs(mirrorEnabled, startedAtRef.current, nowMs())

  /** The recorder has started: stamp it and ask the mirror for the same order. */
  const onRecordingStarted = (startedAwb: string): void => {
    startedAtRef.current = nowMs()
    maybeStartMirror({ awb: startedAwb, orderType, platform }, message => toast.error(message))
  }

  useEffect(() => {
    awbInputRef.current?.focus()
  }, [])

  // Duplicate check: was this AWB recorded before, and in the last two hours?
  useEffect(() => {
    if (!awb.trim() || !orderType) {
      dispatch(resetOrderCheck())

      return
    }

    const timer = setTimeout(() => {
      void recorderClient.checkExists(awb.trim(), orderType).then(response => {
        if (!response.success) return
        dispatch(
          setSameOrderCheck({
            trackingId: awb.trim(),
            orderType,
            exists: response.data.exists,
            existsInLastTwoHour: response.data.existsInLastTwoHour,
            loading: false,
            success: true,
            error: ''
          })
        )
      })
    }, AWB_DEBOUNCE_MS)

    return () => clearTimeout(timer)
  }, [awb, orderType, dispatch])

  const handleAwbChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const next = event.target.value

    setAwb(next)
    dispatch(setTrackingId(next))
  }

  const handleAwbKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    void handleAction()
  }

  const platform: ECommercePlatform | '' =
    VmsECommercePlatform || (user?.company?.ecommercePlatform?.[0]?.name as ECommercePlatform | undefined) || ''

  const awbValid = awb.trim().length >= MIN_AWB_LENGTH

  const canRecord =
    awbValid &&
    Boolean(orderType) &&
    Boolean(user) &&
    !videoUploadLoading &&
    sidecarPort !== null &&
    capture.status === 'preview'

  const resetCaptureSurface = (): void => {
    setAwb('')
    dispatch(setTrackingId(''))
    dispatch(resetOrderCheck())
    dispatch(clearScreenshots())
    awbInputRef.current?.focus()
  }

  const takeSnapshot = (chained: boolean): OrderSnapshot | null =>
    orderType ? { awb: awb.trim(), orderType, platform, screenshots: [...screenshots], chained } : null

  const dispatchUpload = async (
    result: RecordingResult,
    condition: ProductCondition | 0,
    snapshot: OrderSnapshot
  ): Promise<void> => {
    const { awb: orderAwb, orderType: orderOrderType, platform: orderPlatform } = snapshot
    const orderScreenshots = snapshot.screenshots

    if (!user) {
      toast.error('Signed out - please sign in again before uploading.')

      return
    }

    if (sidecarPort === null) {
      toast.error('Local upload service is not ready. Retry in a moment.')
      dispatch(setVideoUploadError('Sidecar port not resolved'))

      return
    }

    dispatch(setVideoUploadLoading(true))

    // Multi-step recording: one AWB is captured across several feeds, each
    // uploading under `{AWB}_S{step}`; the backend merges them once all
    // `totalFeed` steps have arrived.
    const multiStep = user.company?.multiStepRecording
    const multiStepStep = multiStep?.mode ? multiStep.feedIds.find(f => f.feedId === user.feedId)?.step : undefined
    const trackingIdForUpload = typeof multiStepStep === 'number' ? `${orderAwb}_S${multiStepStep}` : orderAwb

    // A feed active on the company but absent from feedIds uploads a bare AWB
    // that sits outside every merge group — indistinguishable from "lost" on
    // the admin panel, so it is called out.
    if (multiStep?.mode && typeof multiStepStep !== 'number') {
      console.warn('[CaptureShell] multi-step is ON but this feed has no step', {
        feedId: user.feedId,
        knownFeedIds: multiStep.feedIds.map(f => `${f.feedId}=S${f.step}`),
        uploadingAs: trackingIdForUpload,
        consequence: 'Uploaded without a step suffix; the backend will not merge it.'
      })
      toast.error(
        'This feed is not set up for multi-step recording, so this video will not be merged. Ask an admin to add it to the multi-step feed list.'
      )
    }

    // Exactly the text fields Argos Watch appended to its FormData, as strings.
    const fields = {
      trackingId: trackingIdForUpload,
      orderType: orderOrderType,
      size: String(result.size),
      videoDuration: String(result.length),
      start_time: String(result.start_time),
      keepOld: 'false',
      needRefund: condition === 2 ? 'true' : 'false',
      orderCondition: condition === 0 ? '' : String(condition),
      eCommercePlatform: orderPlatform
    }

    const video: UploadFile = { blob: result.blob, name: `recording-${result.start_time}.webm` }

    // A screenshot whose data URL will not parse is counted and reported, not
    // dropped in silence.
    const shots: UploadFile[] = []

    orderScreenshots.forEach((shot, index) => {
      const blob = dataUrlToBlob(shot.dataUrl)

      if (!blob) {
        console.error('[CaptureShell] screenshot could not be converted - DROPPED', {
          index: index + 1,
          capturedAt: shot.capturedAt,
          dataUrlPrefix: shot.dataUrl.slice(0, 40)
        })

        return
      }

      shots.push({ blob, name: `screenshot-${index + 1}.jpg` })
    })

    if (shots.length !== orderScreenshots.length) {
      toast.error(`Only ${shots.length} of ${orderScreenshots.length} screenshots could be attached.`)
    }

    // eslint-disable-next-line no-console -- diagnostic log for upload pipeline
    console.info('[CaptureShell] upload', `http://127.0.0.1:${sidecarPort}/upload`, {
      trackingId: trackingIdForUpload,
      awb: orderAwb,
      multiStep: multiStep?.mode ? { step: multiStepStep ?? null, totalFeed: multiStep.totalFeed } : 'off',
      orderType: orderOrderType,
      size: result.size,
      length: result.length,
      screenshotsTaken: orderScreenshots.length,
      screenshotsAttached: shots.length
    })

    try {
      const response = await uploadOrder(sidecarPort, video, shots, fields)

      // eslint-disable-next-line no-console -- diagnostic log for upload pipeline
      console.info('[CaptureShell] sidecar response', {
        status: response.status,
        ok: response.ok,
        bytes: response.rawText.length,
        preview: response.rawText.slice(0, 200)
      })

      let body: { success?: boolean; data?: { uuid: string }; error?: { message?: string } }

      try {
        body = JSON.parse(response.rawText) as typeof body
      } catch {
        const message = `Sidecar returned non-JSON (HTTP ${response.status}): ${response.rawText.slice(0, 120)}`

        dispatch(setVideoUploadError(message))
        toast.error(message)

        return
      }

      if (!response.ok || !body.success || !body.data) {
        const message = body.error?.message ?? `Sidecar rejected upload (HTTP ${response.status})`

        console.warn('[CaptureShell] sidecar rejected', { status: response.status, body })
        dispatch(setVideoUploadError(message))
        toast.error(message)

        return
      }

      dispatch(
        setVideoUploadSuccess({
          fileId: body.data.uuid,
          orderType: orderOrderType,
          trackingId: orderAwb,
          feedId: user.feedId,
          companyId: user.companyId,
          userId: user.id
        })
      )
      toast.success(`Queued: ${orderAwb} (${result.length}s)`)

      // A chained order already owns the field and the screenshots panel.
      if (!snapshot.chained) resetCaptureSurface()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      if (err instanceof UploadStepError) {
        console.warn('[CaptureShell] sidecar rejected a file', message)
        dispatch(setVideoUploadError(message))
        toast.error(message)

        return
      }

      console.error('[CaptureShell] sidecar POST threw', err)
      dispatch(setVideoUploadError(message))
      toast.error(`Sidecar unreachable: ${message}`)
    } finally {
      dispatch(setVideoUploadLoading(false))
    }
  }

  const returnConditionEnabled = user?.company?.returnConditionPopup?.isShow === true

  const handleSaved = (result: RecordingResult, snapshot: OrderSnapshot): void => {
    if (snapshot.orderType === 'Return' && returnConditionEnabled && !snapshot.chained) {
      pendingResultRef.current = { result, snapshot }
      setConditionOpen(true)

      return
    }

    void dispatchUpload(result, 0, snapshot)
  }

  /** Stops the running recording. Null when nothing usable was recorded. */
  const stopCurrent = async (): Promise<RecordingResult | null> => {
    let result: RecordingResult

    try {
      const stopping = capture.stop()

      // Park the mirror on EVERY stop (their recorder runs until told), and
      // never wait on it.
      startedAtRef.current = null
      parkMirror()
      result = await stopping
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      console.error('[CaptureShell] capture.stop() failed', err)
      toast.error(`Recording did not save: ${message}`)

      return null
    }

    // eslint-disable-next-line no-console -- diagnostic log for upload pipeline
    console.info('[CaptureShell] stop -> RecordingResult', {
      size: result.size,
      length: result.length,
      mimeType: result.mimeType,
      start_time: result.start_time
    })

    if (result.size === 0) {
      toast.error('Recording is empty (0 bytes). Nothing to upload.')

      return null
    }

    return result
  }

  /** Arms the deferred start; the effect below fires it once the recorder is ready. */
  const requestAutoStart = (nextAwb: string): void => {
    setAwb(nextAwb)
    dispatch(setTrackingId(nextAwb))
    autoStartRef.current = true
    setAutoStartSeq(n => n + 1)
  }

  /**
   * TrackVid-App's scanner flow: scanning the next parcel ends the current
   * order and starts recording the new one in the same motion.
   */
  const stopAndChain = async (nextAwb: string): Promise<void> => {
    const snapshot = takeSnapshot(true)
    const result = await stopCurrent()

    dispatch(resetOrderCheck())
    dispatch(clearScreenshots())
    requestAutoStart(nextAwb)
    if (result && snapshot) handleSaved(result, snapshot)
  }

  const handleScan = (code: string): void => {
    if (conditionOpen) return

    // Refuse a scan that lands before this order may end — here, before the
    // AWB field, the screenshots or the recorder are touched.
    if (capture.status === 'recording') {
      const leftMs = holdRemainingMs()

      if (leftMs > 0) {
        const secs = remainingSeconds(leftMs)

        // eslint-disable-next-line no-console -- order diagnostics: a refused scan leaves a trace
        console.info(scanRefusedLogLine(code, awb.trim(), secs))
        toast.error(scanRefusedMessage(secs))

        return
      }
    }

    if (!orderType) {
      toast.error('Pick Forward VMS or Return VMS from the sidebar first.')

      return
    }

    if (code.length < MIN_AWB_LENGTH) {
      toast.error('Please enter valid AWB Number')

      return
    }

    if (capture.status === 'recording') {
      // A Return that asks for the product condition only stops on a scan;
      // the next parcel is scanned again once the prompt is answered.
      if (orderType === 'Return' && returnConditionEnabled) {
        void handleAction()

        return
      }

      void stopAndChain(code)

      return
    }

    if (capture.status === 'stopping') {
      toast.error('Still saving the previous recording - scan again in a moment.')

      return
    }

    requestAutoStart(code)
  }

  const handleAction = async (): Promise<void> => {
    if (!orderType) {
      toast.error('Pick Forward VMS or Return VMS from the sidebar first.')

      return
    }

    if (capture.status === 'recording') {
      const leftMs = holdRemainingMs()

      if (leftMs > 0) {
        toast.error(stopHoldHint(remainingSeconds(leftMs)))

        return
      }

      const snapshot = takeSnapshot(false)
      const result = await stopCurrent()

      if (result && snapshot) handleSaved(result, snapshot)

      return
    }

    if (!canRecord) {
      const reason = !awbValid
        ? 'Please enter valid AWB Number'
        : sidecarPort === null
          ? 'Local upload service is still starting. Retry in a moment.'
          : videoUploadLoading
            ? 'Previous upload still in flight.'
            : capture.status !== 'preview'
              ? 'Preview is not ready yet.'
              : 'Cannot start recording right now.'

      toast.error(reason)

      return
    }

    try {
      await capture.start()
      onRecordingStarted(awb.trim())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)

      console.error('[CaptureShell] capture.start() failed', err)
      toast.error(`Recorder failed to start: ${message}`)
    }
  }

  const handleConditionSelect = (condition: ProductCondition): void => {
    setConditionOpen(false)
    const pending = pendingResultRef.current

    pendingResultRef.current = null
    if (pending) void dispatchUpload(pending.result, condition, pending.snapshot)
  }

  const handleConditionCancel = (): void => {
    setConditionOpen(false)
    pendingResultRef.current = null
    toast.info('Recording discarded.')
  }

  const handleScreenshot = useCallback((): void => {
    if (screenshotsCount >= MAX_SCREENSHOTS) {
      toast.error(`Screenshot cap reached (${MAX_SCREENSHOTS}). Clear or upload before capturing more.`)

      return
    }

    const dataUrl = getScreenshot()

    if (!dataUrl) {
      toast.error('Could not capture the current frame.')

      return
    }

    dispatch(addScreenshot({ id: crypto.randomUUID(), dataUrl, capturedAt: Date.now() }))
  }, [dispatch, getScreenshot, screenshotsCount, toast])

  // SPACE-bar screenshot shortcut. An AWB never contains a space, and every
  // other control in the toolbar is a select, so it fires regardless of focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return
      event.preventDefault()
      handleScreenshot()
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [handleScreenshot])

  // Fires the start a scan asked for, from a fresh render that sees the
  // recorder back in 'preview' and the new AWB in place.
  useEffect(() => {
    if (!autoStartRef.current) return
    if (capture.status !== 'preview' || conditionOpen) return
    autoStartRef.current = false

    if (!awb.trim() || !user || sidecarPort === null) {
      toast.error(
        sidecarPort === null
          ? 'Local upload service is still starting. Scan again in a moment.'
          : 'Cannot start recording right now.'
      )

      return
    }

    const startedAwb = awb.trim()

    capture
      .start()
      .then(() => onRecordingStarted(startedAwb))
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)

        console.error('[CaptureShell] auto capture.start() failed', err)
        toast.error(`Recorder failed to start: ${message}`)
      })
    // onRecordingStarted reads orderType / platform from this same render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartSeq, capture, conditionOpen, awb, user, sidecarPort, toast])

  // Always hand the window listener the latest closure.
  useEffect(() => {
    scanHandlerRef.current = handleScan
  })

  // Barcode scanner outside the AWB field. The field is disabled while
  // recording, so the next parcel's scan lands on the page: buffer it and act
  // on Enter / Tab. Typing in a real input is left alone.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null

      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        const code = scanBufferRef.current

        scanBufferRef.current = ''
        if (!code) return
        event.preventDefault()
        scanHandlerRef.current(code)

        return
      }

      if (event.key.length !== 1 || !/^[a-zA-Z0-9]$/.test(event.key)) return
      const now = Date.now()

      if (now - lastScanKeyAtRef.current > SCAN_IDLE_RESET_MS) scanBufferRef.current = ''
      lastScanKeyAtRef.current = now
      scanBufferRef.current += event.key
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const isRecording = capture.status === 'recording'
  const showRecordButton = isRecording || awbValid
  const screenshotDisabled = capture.status !== 'preview' && capture.status !== 'recording'
  // Stop is blocked, not queued, while the mirror's minimum is unmet: a click
  // that is accepted and acted on later looks like the app has frozen.
  const stopHeld = isRecording && holdLeft > 0
  const recordDisabled = !orderType || (!isRecording && !canRecord) || stopHeld

  // The countdown that drives the Stop button and the pill, live while recording.
  useEffect(() => {
    if (!isRecording) {
      // Clears the countdown the moment recording ends.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHoldLeft(0)

      return undefined
    }

    const tick = (): void => setHoldLeft(remainingSeconds(minimumRemainingMs(mirrorEnabled, startedAtRef.current, nowMs())))

    tick()
    const id = window.setInterval(tick, 200)

    return () => window.clearInterval(id)
  }, [isRecording, mirrorEnabled])

  return (
    <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]'>
      <div className='flex min-is-0 flex-col gap-4'>
        {/* The camera, in a glass card: preview on a black stage, toolbar below. */}
        <Box className='veylix-glass' sx={{ overflow: 'hidden' }}>
          <Box
            sx={{
              position: 'relative',
              aspectRatio: '16 / 9',
              maxBlockSize: 'calc(100vh - 300px)',
              minBlockSize: 280,
              inlineSize: '100%',
              backgroundColor: 'var(--mui-palette-common-black)',
              color: 'var(--mui-palette-common-white)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}
          >
            {preview}

            {isRecording && (
              <Box
                sx={{
                  position: 'absolute',
                  insetBlockStart: 16,
                  insetInlineStart: 16,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 0.5,
                  borderRadius: 999,
                  backgroundColor: 'color-mix(in srgb, var(--mui-palette-common-black) 55%, transparent)',
                  color: 'var(--mui-palette-common-white)'
                }}
              >
                <i className='tabler-circle-filled text-xs' style={{ color: 'var(--mui-palette-error-main)' }} />
                <Typography variant='caption' className='font-mono' sx={{ color: 'inherit', fontWeight: 700 }}>
                  REC
                </Typography>
              </Box>
            )}
          </Box>

          <div className='flex flex-col gap-2 p-4'>
            <div className='flex flex-wrap items-center gap-3'>
              <CustomTextField
                placeholder='AWB Number'
                value={awb}
                onChange={handleAwbChange}
                onKeyDown={handleAwbKeyDown}
                inputRef={(node: HTMLInputElement | null) => {
                  awbInputRef.current = node
                }}
                autoComplete='off'
                spellCheck={false}
                disabled={capture.status === 'recording' || capture.status === 'stopping'}
                slotProps={{ htmlInput: { 'aria-label': 'AWB Number', className: 'font-mono' } }}
                // The most consequential control on the screen, so it is the
                // widest field in the row, in the mono face an operator reads
                // back digit by digit.
                sx={{
                  minInlineSize: 240,
                  flex: '1 0 240px',
                  '& .MuiInputBase-input': { fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '0.02em' }
                }}
              />

              {orderType && <Badge tone={ORDER_TYPE_TONE[orderType]}>{orderType}</Badge>}

              {/* Round play to start, square stop to stop, shown once there is
                  a valid AWB to record — as in TrackVid-App. */}
              {showRecordButton && (
                <Tooltip title={stopHeld ? stopHoldHint(holdLeft) : ''}>
                  <span>
                    <IconButton
                      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
                      onClick={() => {
                        void handleAction()
                      }}
                      disabled={recordDisabled}
                      sx={{
                        inlineSize: 44,
                        blockSize: 44,
                        backgroundColor: isRecording ? 'error.main' : 'success.main',
                        color: isRecording ? 'error.contrastText' : 'success.contrastText',
                        transition: 'background-color 200ms ease, filter 200ms ease',
                        '&:hover': {
                          backgroundColor: isRecording ? 'error.dark' : 'success.dark'
                        },
                        '&.Mui-disabled': {
                          backgroundColor: 'action.disabledBackground',
                          color: 'action.disabled'
                        }
                      }}
                    >
                      <i className={isRecording ? 'tabler-player-stop-filled text-lg' : 'tabler-player-play-filled text-2xl'} />
                    </IconButton>
                  </span>
                </Tooltip>
              )}

              <Button
                variant='secondary'
                onClick={handleScreenshot}
                icon={<i className='tabler-camera' />}
                disabled={screenshotDisabled}
              >
                Screenshot
              </Button>

              <CustomTextField
                select
                label='Platform'
                value={platform}
                onChange={event => {
                  dispatch(setVmsECommercePlatform(event.target.value as ECommercePlatform | ''))
                }}
                sx={{ minInlineSize: 150 }}
              >
                <MenuItem value=''>—</MenuItem>
                {ECOMMERCE_PLATFORMS.map(p => (
                  <MenuItem key={p} value={p}>
                    {p}
                  </MenuItem>
                ))}
              </CustomTextField>

              {extraToolbarItems}

              <div className='flex-1' />

              {stopHeld && (
                <Tooltip
                  title={`Every recording runs for at least 12 seconds. This order can be stopped in ${holdLeft} second${holdLeft === 1 ? '' : 's'}. A barcode scanned before then is refused.`}
                >
                  <Box
                    role='timer'
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      paddingInline: '10px',
                      blockSize: 30,
                      borderRadius: 999,
                      border: '1px solid',
                      borderColor: 'color-mix(in srgb, var(--mui-palette-warning-main) 45%, transparent)',
                      backgroundColor: 'color-mix(in srgb, var(--mui-palette-warning-main) 10%, transparent)',
                      color: 'warning.main',
                      fontSize: 12,
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                      fontVariantNumeric: 'tabular-nums'
                    }}
                  >
                    <i className='tabler-hourglass text-sm' aria-hidden='true' />
                    Stop in {holdLeft}s
                  </Box>
                </Tooltip>
              )}

              <MirrorStatusChip variant='inline' />

              <Typography
                className='font-mono'
                sx={{
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  color: isRecording ? 'error.main' : 'text.secondary',
                  minInlineSize: 96,
                  textAlign: 'end'
                }}
              >
                {formatDuration(isRecording ? capture.elapsedSeconds : 0)}
              </Typography>
            </div>

            <Typography variant='caption' color='text.disabled' sx={{ textAlign: 'center', letterSpacing: '0.05em' }}>
              {screenshotHint ?? (
                <>
                  Press <strong>SPACE</strong> to capture a screenshot
                </>
              )}
            </Typography>
          </div>
        </Box>

        {checkOrder.exists && checkOrder.trackingId === awb.trim() && awb.trim() && (
          <Alert severity={checkOrder.existsInLastTwoHour ? 'warning' : 'info'}>
            {checkOrder.existsInLastTwoHour
              ? 'This AWB was recorded in the last 2 hours. Recording will still upload if you continue.'
              : 'This AWB has been recorded before. Recording will still upload if you continue.'}
          </Alert>
        )}

        {videoUploadError && (
          <Alert severity='error' onClose={() => dispatch(setVideoUploadError(''))}>
            Upload failed: {videoUploadError}
          </Alert>
        )}
      </div>

      <div className='flex min-is-0 flex-col gap-5'>
        <ScreenshotsPanel />
        <ProductDetailsPanel trackingId={awb} companyId={user?.companyId ?? ''} />
      </div>

      <ProductConditionModal open={conditionOpen} onSelect={handleConditionSelect} onCancel={handleConditionCancel} />
    </div>
  )
}
