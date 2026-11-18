import { useCallback, useEffect, useRef, useState } from 'react'
import { useStampedStream } from './useStampedStream'
import type { StampFields } from '../utils/timestampOverlay'
import { useMediaPermissions } from '@renderer/vms/hooks/useMediaPermissions'

/**
 * getUserMedia webcam preview + MediaRecorder capture. Owns the MediaStream,
 * the MediaRecorder instance, the accumulated Blob chunks, and the timing
 * bookkeeping the upload driver needs (start_time, videoDuration).
 *
 * Kept as a plain hook rather than a component so the ManualPage can compose
 * a <video ref={hook.videoRef} /> preview with its own layout, and the
 * order-capture UX commit can wire hook.start()/hook.stop() from anywhere in
 * the tree.
 *
 * Ported from TrackVid 1.1.x WebcamRecorder.tsx with the same three-stage
 * blob assembly:
 *   1. MediaRecorder emits dataavailable chunks (200 ms slice)
 *   2. On stop, chunks concat into a webm/opus Blob
 *   3. The main process writes the real duration into the header when it
 *      remuxes the file (copy-remux), so fix-webm-duration is not carried
 *      over (VMS_PROGRESS.txt: no new renderer dependency).
 *
 * Ported from Argos Watch into the CMS's VMS recorder (vms/recorder).
 */

export interface RecordingResult {
  blob: Blob
  size: number
  /** Duration in seconds, from the wall clock (main writes it into the header). */
  length: number
  /** Recording start, epoch ms. */
  start_time: number
  mimeType: string
}

export type RecorderStatus = 'idle' | 'permission-denied' | 'preview' | 'recording' | 'stopping' | 'error'

export interface UseWebcamRecorder {
  status: RecorderStatus
  error: string | null
  /** Attach to a <video> element. Preview is muted + autoplayed. */
  videoRef: (element: HTMLVideoElement | null) => void
  /** Bytes of the in-flight recording. Updates as chunks arrive. */
  bytesRecorded: number
  /** Seconds since recording started (0 while idle). */
  elapsedSeconds: number
  /** Begin capturing. Rejects when no camera permission or MediaRecorder unavailable. */
  start: () => Promise<void>
  /** End capture. Resolves with the finalised, duration-fixed Blob. */
  stop: () => Promise<RecordingResult>
}

const pickMimeType = (): string => {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return 'video/webm'
}

export interface UseWebcamRecorderOptions {
  /** Which camera to open. Undefined = browser default. */
  deviceId?: string | undefined
  /**
   * Fields for the burned-in timestamp, read at every painted frame so the
   * clock keeps running and a mid-recording AWB scan reaches later frames.
   * Omitted, the recording is captured straight off the stream with no stamp.
   */
  getStampFields?: (() => StampFields) | undefined
  /**
   * Capture resolution preference, mirrored from
   * `session.company.desktopAppResolution`. Parsing happens inside the
   * hook so a single place decides how the wire shape maps to
   * MediaTrackConstraints.
   *
   *   asPerCamera=true   → ideal 4096x2160 hint, letting the browser pick
   *                        the highest resolution the connected camera
   *                        supports without a hard `exact` failure.
   *   asPerCamera=false  → ideal WxH parsed from `resolution` (falls back
   *                        to 1280x720 on missing / malformed input).
   *   undefined          → 1280x720 default (matches the pre-config
   *                        behaviour so tests + preview pages that don't
   *                        read auth still work).
   */
  resolution?: { asPerCamera: boolean; resolution?: string } | undefined
}

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 720
// Upper bound for "ideal" when the operator asked for the camera's max —
// higher than every USB / built-in webcam ships today; the browser will
// still fall back to whatever the camera actually supports.
const MAX_WIDTH_IDEAL = 4096
const MAX_HEIGHT_IDEAL = 2160

const parseResolutionString = (
  value: string | undefined
): { width: number; height: number } => {
  if (typeof value === 'string') {
    const match = /^(\d{3,5})x(\d{3,5})$/.exec(value.trim())
    // Regex has two required groups; when `match` is non-null the
    // captures are guaranteed strings — TS just can't see that.
    if (match) return { width: parseInt(match[1]!, 10), height: parseInt(match[2]!, 10) }
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT }
}

const resolveVideoConstraints = (
  pref: UseWebcamRecorderOptions['resolution']
): { width: { ideal: number }; height: { ideal: number } } => {
  if (pref?.asPerCamera === true) {
    return {
      width: { ideal: MAX_WIDTH_IDEAL },
      height: { ideal: MAX_HEIGHT_IDEAL }
    }
  }
  const { width, height } = parseResolutionString(pref?.resolution)
  return { width: { ideal: width }, height: { ideal: height } }
}

export const useWebcamRecorder = (options: UseWebcamRecorderOptions = {}): UseWebcamRecorder => {
  const { deviceId, resolution, getStampFields } = options
  // OS consent, owned by MediaPermissionsProvider. `grantSeq` only moves when
  // access is newly granted, which is the one moment a refused stream is worth
  // reopening; `openDialog` turns a refusal into something the operator can
  // act on instead of a red box.
  const { grantSeq, openDialog } = useMediaPermissions()
  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [bytesRecorded, setBytesRecorded] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const stamped = useStampedStream()

  // The latest stamp getter, read on every painted frame. Argos Watch passed
  // the getter captured when start() was created, so an AWB typed after the
  // preview opened never reached the stamp; this keeps the documented intent
  // (the clock runs, a mid-recording scan reaches later frames).
  const stampFieldsRef = useRef(getStampFields)

  useEffect(() => {
    stampFieldsRef.current = getStampFields
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)

  const attachStreamToVideo = useCallback((): void => {
    if (videoElRef.current && streamRef.current) {
      videoElRef.current.srcObject = streamRef.current
      // Autoplay is only allowed on muted elements; the preview never plays
      // audio anyway.
      videoElRef.current.muted = true
      void videoElRef.current.play().catch(() => undefined)
    }
  }, [])

  const videoRef = useCallback(
    (element: HTMLVideoElement | null) => {
      videoElRef.current = element
      attachStreamToVideo()
    },
    [attachStreamToVideo]
  )

  const openStream = useCallback(async (): Promise<MediaStream> => {
    if (streamRef.current) return streamRef.current
    const { width, height } = resolveVideoConstraints(resolution)
    const videoConstraints: MediaTrackConstraints = {
      width,
      height,
      frameRate: { ideal: 30 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : {})
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: videoConstraints,
      audio: true
    })
    streamRef.current = stream
    attachStreamToVideo()
    return stream
  }, [attachStreamToVideo, deviceId, resolution])

  useEffect(() => {
    // Open the preview stream on mount so the operator can see themselves
    // before hitting Record. Re-runs on grantSeq so a stream refused by the OS
    // reopens the moment the operator grants access, with no page reload.
    let cancelled = false
    void openStream()
      .then(() => {
        if (!cancelled) setStatus((current) => (current === 'idle' ? 'preview' : current))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('permission-denied')
        setError(err instanceof Error ? err.message : String(err))
        // The OS refused. The modal is the only thing that can fix that, so
        // raise it rather than leaving the operator looking at the error.
        openDialog()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openStream, grantSeq])

  useEffect(
    () => () => {
      // Tear down the stream on unmount so the camera indicator goes off.
      recorderRef.current?.stop()
      stamped.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    },
    // `stamped` is memoised and stable, so this still runs on unmount only.
    [stamped]
  )

  // Reopen the stream when the operator picks a different camera. Safe only
  // while the recorder is idle - swapping mid-recording would break the WebM
  // container and the queue-side upload path.
  useEffect(() => {
    if (status === 'recording' || status === 'stopping') return
    const active = streamRef.current
    if (!active) return
    // A running stream that is not on the requested device? Drop it so the
    // next openStream builds a new one against the new constraint.
    const currentDeviceId = active.getVideoTracks()[0]?.getSettings().deviceId
    if (deviceId && currentDeviceId && currentDeviceId !== deviceId) {
      active.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      setStatus('idle')
      void openStream()
        .then(() => setStatus('preview'))
        .catch((err: unknown) => {
          setStatus('permission-denied')
          setError(err instanceof Error ? err.message : String(err))
          openDialog()
        })
    }
  }, [deviceId, openDialog, openStream, stamped, status])

  const start = useCallback(async (): Promise<void> => {
    if (status === 'recording') return
    setError(null)
    const stream = await openStream()

    // Recorded through a stamping canvas so the file carries a visible date and
    // time. The preview element already has the stream attached, so it is the
    // frame source; the microphone track is carried across explicitly because
    // canvas.captureStream() is video-only and a silent recording would be a
    // regression nobody notices until a claim needs the audio.
    const video = videoElRef.current
    const recordStream =
      video && stampFieldsRef.current
        ? (stamped.start(video, () => stampFieldsRef.current?.() ?? { at: new Date() }, { fps: 30, audioFrom: stream }) ?? stream)
        : stream

    chunksRef.current = []
    setBytesRecorded(0)
    setElapsedSeconds(0)

    const mimeType = pickMimeType()
    // No bitrate cap: the main-side upload driver applies libx264 CRF
    // compression per company.compressPercentage. Similar keeps the native
    // camera bitrate; Medium/Low get squeezed at re-encode time.
    const recorder = new MediaRecorder(recordStream, { mimeType })
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
        setBytesRecorded((current) => current + event.data.size)
      }
    }
    recorder.onerror = (event) => {
      const err = (event as unknown as { error?: Error }).error
      setStatus('error')
      setError(err?.message ?? 'MediaRecorder error')
    }

    recorderRef.current = recorder
    startTimeRef.current = Date.now()
    // 200 ms slice keeps chunk sizes manageable and gives the byte counter
    // a smooth update cadence in the UI.
    recorder.start(200)
    setStatus('recording')

    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 250)
  }, [openStream, status, stamped])

  const stop = useCallback(async (): Promise<RecordingResult> => {
    const recorder = recorderRef.current
    if (!recorder) throw new Error('stop called before start')
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    setStatus('stopping')

    // Wait for the final dataavailable + stop events. MediaRecorder fires
    // dataavailable BEFORE stop, so chunksRef is populated by the time stop
    // resolves. Guard with a 2 s timeout so a driver bug cannot hang the UI.
    const stopped = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('MediaRecorder did not fire stop within 2s')), 2000)
      recorder.addEventListener(
        'stop',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true }
      )
    })
    recorder.stop()
    await stopped

    // Release the stamping canvas. Without this every recording left its paint
    // loop running, and a scanner chaining order after order stacked one more
    // loop per parcel. Only the canvas video track is stopped - the microphone
    // belongs to the live preview stream.
    stamped.stop()

    const mimeType = recorder.mimeType || 'video/webm'
    const chunks = chunksRef.current
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0)
    // eslint-disable-next-line no-console -- diagnostic log for stop pipeline
    console.info('[useWebcamRecorder] stop event fired', {
      chunkCount: chunks.length,
      totalBytes,
      mimeType
    })

    if (chunks.length === 0 || totalBytes === 0) {
      chunksRef.current = []
      setStatus('preview')
      throw new Error(
        'No video chunks were captured. Recording may have been too short or the camera dropped mid-record.'
      )
    }

    const rawBlob = new Blob(chunks, { type: mimeType })
    const durationMs = Date.now() - startTimeRef.current

    // MediaRecorder writes the WebM header with duration=Infinity. Argos Watch
    // rewrote it here with fix-webm-duration; in the CMS the main process's
    // copy-remux writes the real duration, so the blob leaves as recorded.
    const finalBlob: Blob = rawBlob

    setStatus('preview')
    chunksRef.current = []
    return {
      blob: finalBlob,
      size: finalBlob.size,
      length: Math.max(1, Math.round(durationMs / 1000)),
      start_time: startTimeRef.current,
      mimeType
    }
  }, [stamped])

  return { status, error, videoRef, bytesRecorded, elapsedSeconds, start, stop }
}
