import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecorderStatus, RecordingResult } from './useWebcamRecorder'
import { useStampedStream } from './useStampedStream'
import type { StampFields } from '../utils/timestampOverlay'

/**
 * RTSP-side capture. Wraps a MediaRecorder around the preview <video> element
 * so the shipping order-capture UX (record button, timer, upload path) drives
 * an IP-camera stream with zero new code paths downstream. The blob shape,
 * status enum, and start/stop contract match useWebcamRecorder so the shared
 * CaptureShell can consume either without knowing the source.
 *
 * Pipeline:
 *   1. RtspStream mounts the <video> and hands its ref to useRtspStream, which
 *      feeds it fragmented MP4 over the sidecar WebSocket.
 *   2. On record, this hook calls video.captureStream() and feeds the
 *      resulting MediaStream (video-only) into MediaRecorder.
 *   3. On stop, chunks concat into a webm blob and the caller ships it down
 *      the same local upload route the webcam flow uses (main fixes the
 *      WebM duration when it remuxes).
 *
 * Captures from the <video> rather than a canvas because the element holds the
 * camera's own decoded frames, at the camera's own resolution. The previous
 * canvas route recorded whatever JSMpeg had painted after an MPEG-1 re-encode,
 * which cost ~24 dB PSNR before the recording even started.
 *
 * Still video-only: the preview is muted and carries no audio track.
 */

const pickMimeType = (): string => {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate
  }
  return 'video/webm'
}

export interface UseRtspRecorderOptions {
  /**
   * Getter for the JSMpeg canvas. A getter (not a ref) because the canvas is
   * owned by the RtspStream wrapper and the hook only needs it at record
   * time — not on every render.
   */
  getVideo: () => HTMLVideoElement | null
  /** true while JSMpeg has an active source. Gates start() with a friendly error. */
  ready: boolean
  /**
   * Read at every painted frame so the burned-in stamp stays live. A value
   * passed once at start() would freeze the clock at the first frame.
   */
  getStampFields: () => StampFields
}

export interface UseRtspRecorder {
  status: RecorderStatus
  error: string | null
  bytesRecorded: number
  elapsedSeconds: number
  start: () => Promise<void>
  stop: () => Promise<RecordingResult>
}

/** Internal recorder-only phase; the public status is derived from this + `ready`. */
type RecordPhase = 'inactive' | 'recording' | 'stopping' | 'error'

const derivePublicStatus = (phase: RecordPhase, ready: boolean): RecorderStatus => {
  if (phase === 'recording') return 'recording'
  if (phase === 'stopping') return 'stopping'
  if (phase === 'error') return 'error'
  return ready ? 'preview' : 'idle'
}

export const useRtspRecorder = ({
  getVideo,
  ready,
  getStampFields
}: UseRtspRecorderOptions): UseRtspRecorder => {
  const stamped = useStampedStream()

  // The latest stamp getter, read on every painted frame. Argos Watch passed
  // the getter captured when start() was created, so an AWB typed after the
  // preview opened never reached the stamp; this keeps the documented intent
  // (the clock runs, a mid-recording scan reaches later frames).
  const stampFieldsRef = useRef(getStampFields)

  useEffect(() => {
    stampFieldsRef.current = getStampFields
  })
  // Track only what MediaRecorder is doing internally; the exposed status
  // combines this with `ready` so the shell sees 'preview' the moment the
  // JSMpeg stream lands, without an effect-driven setState round-trip.
  const [phase, setPhase] = useState<RecordPhase>('inactive')
  const [error, setError] = useState<string | null>(null)
  const [bytesRecorded, setBytesRecorded] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const status = derivePublicStatus(phase, ready)

  useEffect(
    () => () => {
      recorderRef.current?.stop()
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    },
    []
  )

  const start = useCallback((): Promise<void> => {
    if (phase === 'recording') return Promise.resolve()
    setError(null)

    const video = getVideo()
    if (!video) {
      setPhase('error')
      const message = 'RTSP preview is not ready.'
      setError(message)
      return Promise.reject(new Error(message))
    }

    // Recorded through a stamping canvas rather than straight off the element:
    // packing evidence has to carry a visible date and time, and the camera's
    // own OSD cannot be relied on - it is optional on the device and runs on
    // the device's clock. 30 fps is the canvas paint rate, above the 15 fps the
    // bridge delivers, so no source frame is dropped by the capture.
    // maskOsd only here: an IP camera burns its own date and channel name into
    // the top of the frame, a USB webcam does not.
    const stream = stamped.start(video, () => stampFieldsRef.current(), { fps: 30, maskOsd: true })
    if (!stream) {
      setPhase('error')
      const message = 'The preview produced no video track to record.'
      setError(message)
      return Promise.reject(new Error(message))
    }
    streamRef.current = stream

    chunksRef.current = []
    setBytesRecorded(0)
    setElapsedSeconds(0)

    const mimeType = pickMimeType()
    // No bitrate cap: matches useWebcamRecorder. The RTSP source is already
    // bounded by the ffmpeg preview scale (rtspBridge.service.ts), so this
    // just avoids double-compressing before the main-side re-encode.
    const recorder = new MediaRecorder(stream, { mimeType })
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data)
        setBytesRecorded((current) => current + event.data.size)
      }
    }
    recorder.onerror = (event) => {
      const err = (event as unknown as { error?: Error }).error
      setPhase('error')
      setError(err?.message ?? 'MediaRecorder error')
    }

    recorderRef.current = recorder
    startTimeRef.current = Date.now()
    recorder.start(200)
    setPhase('recording')

    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 250)
    return Promise.resolve()
  }, [getVideo, phase, stamped])

  const stop = useCallback(async (): Promise<RecordingResult> => {
    const recorder = recorderRef.current
    if (!recorder) throw new Error('stop called before start')
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current)
      elapsedTimerRef.current = null
    }
    setPhase('stopping')

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

    // Stop the paint loop before releasing tracks, or it keeps drawing into a
    // canvas whose stream has already gone.
    stamped.stop()
    // Release the captureStream tracks now that the recording is closed.
    // Leaving them attached would keep the browser flagging the canvas as an
    // active capture source until unmount.
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null

    const mimeType = recorder.mimeType || 'video/webm'
    const chunks = chunksRef.current
    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.size, 0)

    if (chunks.length === 0 || totalBytes === 0) {
      chunksRef.current = []
      setPhase('inactive')
      throw new Error(
        'No video chunks were captured. The RTSP stream may have dropped mid-record.'
      )
    }

    const rawBlob = new Blob(chunks, { type: mimeType })
    const durationMs = Date.now() - startTimeRef.current

    // No fix-webm-duration in the CMS: the main process's copy-remux writes
    // the real duration into the header (see useWebcamRecorder).
    const finalBlob: Blob = rawBlob

    setPhase('inactive')
    chunksRef.current = []
    return {
      blob: finalBlob,
      size: finalBlob.size,
      length: Math.max(1, Math.round(durationMs / 1000)),
      start_time: startTimeRef.current,
      mimeType
    }
  }, [stamped])

  return { status, error, bytesRecorded, elapsedSeconds, start, stop }
}
