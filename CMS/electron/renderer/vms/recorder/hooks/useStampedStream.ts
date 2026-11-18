import { useCallback, useMemo, useRef } from 'react'
import type { StampFields } from '../utils/timestampOverlay'
import { paintStampedFrame } from '../utils/timestampOverlay'

/**
 * Wraps a <video> in a canvas that carries a burned-in timestamp, and hands
 * back a MediaStream of that canvas for MediaRecorder.
 *
 * Both capture paths use this, so a webcam recording and an RTSP recording
 * carry the same stamp in the same place - an operator and a claims team should
 * not have to know which camera a station happens to use.
 *
 * Quality note: the canvas receives the DECODED frame at the source's own
 * resolution, so the only encode in the path is the one MediaRecorder was
 * always going to do. This is not the old JSMpeg canvas, which received frames
 * that had already been through an MPEG-1 re-encode.
 *
 * Audio note: canvas.captureStream() produces video only. Any audio track on
 * the source stream is carried across explicitly, or a webcam recording would
 * silently lose its sound the moment stamping was switched on.
 */
export interface UseStampedStream {
  /**
   * Starts painting and returns the stream to record.
   * `fields` is read through a getter so the stamp stays live for the whole
   * recording - a value captured at start() would freeze the clock.
   */
  start: (
    video: HTMLVideoElement,
    getFields: () => StampFields,
    options?: { fps?: number; audioFrom?: MediaStream | null; maskOsd?: boolean }
  ) => MediaStream | null
  /** Stops painting and releases the canvas stream's tracks. */
  stop: () => void
}

export const useStampedStream = (): UseStampedStream => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)

  const stop = useCallback((): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // Only the canvas track is ours to stop. The audio track belongs to the
    // caller's preview stream and stopping it would kill the live microphone.
    streamRef.current?.getVideoTracks().forEach((track) => track.stop())
    streamRef.current = null
    canvasRef.current = null
  }, [])

  const start = useCallback(
    (
      video: HTMLVideoElement,
      getFields: () => StampFields,
      options?: { fps?: number; audioFrom?: MediaStream | null; maskOsd?: boolean }
    ): MediaStream | null => {
      const fps = options?.fps ?? 30
      const canvas = document.createElement('canvas')
      canvasRef.current = canvas

      // Paint once before capturing so the stream starts with a real frame
      // rather than a blank one.
      const maskOsd = options?.maskOsd ?? false
      if (!paintStampedFrame(canvas, video, getFields(), { maskOsd })) {
        // No frame decoded yet. Size the canvas from the element so
        // captureStream still produces a valid track; the loop fills it in.
        canvas.width = video.videoWidth || video.clientWidth || 1280
        canvas.height = video.videoHeight || video.clientHeight || 720
      }

      const stream = canvas.captureStream(fps)
      if (stream.getVideoTracks().length === 0) {
        canvasRef.current = null
        return null
      }

      const audio = options?.audioFrom?.getAudioTracks() ?? []
      for (const track of audio) stream.addTrack(track)

      streamRef.current = stream

      const tick = (): void => {
        const current = canvasRef.current
        if (!current) return
        paintStampedFrame(current, video, getFields(), { maskOsd })
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)

      return stream
    },
    []
  )

  // Memoised so callers can list it in a dependency array without the array
  // changing identity on every render.
  return useMemo(() => ({ start, stop }), [start, stop])
}
