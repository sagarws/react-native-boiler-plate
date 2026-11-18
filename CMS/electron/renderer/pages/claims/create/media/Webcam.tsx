import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'

/**
 * The camera, as a component.
 *
 * REPLACES `react-webcam`, whose API this deliberately matches — the ported
 * capture screens hold a ref and read `.stream` (to hand to a `MediaRecorder`)
 * and `.video` (to draw a still from). Everything it does that those screens
 * use is `getUserMedia` plus a `<video>`, so the package would be a dependency
 * for about forty lines.
 *
 * TWO THINGS IT MUST GET RIGHT, both of which are how a camera leaks:
 *
 *   - the stream is stopped on unmount, and on every constraint change. A
 *     `MediaStreamTrack` that is not stopped keeps the device open and the
 *     operating system's camera light on, in an app the operator has navigated
 *     away from.
 *   - a request that resolves AFTER the component has gone is stopped
 *     immediately rather than attached. Opening and closing the recorder
 *     quickly is enough to hit that, and the symptom is a camera light that
 *     never goes out.
 */

export interface WebcamHandle {
  /** The live stream, or null before it is granted. */
  stream: MediaStream | null
  /** The element, for reading a frame off. */
  video: HTMLVideoElement | null
}

export interface WebcamProps {
  audio?: boolean
  videoConstraints?: MediaTrackConstraints
  muted?: boolean
  style?: CSSProperties
  className?: string
  /** Called with whatever the browser refused with. */
  onUserMediaError?: (error: unknown) => void
  onUserMedia?: (stream: MediaStream) => void
}

export const Webcam = forwardRef<WebcamHandle, WebcamProps>(
  ({ audio = false, videoConstraints, muted = true, style, className, onUserMediaError, onUserMedia }, ref) => {
    const videoRef = useRef<HTMLVideoElement | null>(null)
    const [stream, setStream] = useState<MediaStream | null>(null)

    // Held in refs so the effect below does not re-request the camera every
    // time the parent re-renders with a fresh callback identity — which, on a
    // recording screen with a ticking timer, is several times a second.
    const onError = useRef(onUserMediaError)
    const onReady = useRef(onUserMedia)

    onError.current = onUserMediaError
    onReady.current = onUserMedia

    // Serialised so an inline object literal — which every call site passes —
    // does not count as a new constraint on each render.
    const constraintKey = JSON.stringify(videoConstraints ?? {})

    useEffect(() => {
      let cancelled = false
      let active: MediaStream | null = null

      const open = async (): Promise<void> => {
        try {
          const granted = await navigator.mediaDevices.getUserMedia({
            audio,
            video: videoConstraints ?? true
          })

          if (cancelled) {
            granted.getTracks().forEach((track) => track.stop())

            return
          }

          active = granted
          setStream(granted)
          onReady.current?.(granted)
        } catch (error) {
          if (!cancelled) onError.current?.(error)
        }
      }

      void open()

      return () => {
        cancelled = true
        active?.getTracks().forEach((track) => track.stop())
        setStream(null)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [audio, constraintKey])

    useEffect(() => {
      const element = videoRef.current

      if (!element) return

      element.srcObject = stream

      // Autoplay is allowed for a muted element; for an unmuted one the play()
      // promise can reject, and that is not something to crash on.
      void element.play().catch(() => undefined)
    }, [stream])

    useImperativeHandle(ref, () => ({ stream, video: videoRef.current }), [stream])

    return (
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className={className}
        style={style}
      />
    )
  }
)

Webcam.displayName = 'Webcam'

export default Webcam
