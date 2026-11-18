import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * RTSP preview via the main-process ffmpeg → sidecar WebSocket → Media Source
 * Extensions pipeline. Owns one MediaSource per <video> element.
 *
 * Wire-up (what happens when this hook connects):
 *   1. Renderer opens ws://127.0.0.1:<sidecarPort>/rtsp?url=<encoded rtsp>
 *   2. Sidecar hands the socket to rtspBridge.attachClient(rtsp, ws), which
 *      spawns an ffmpeg dedicated to that socket
 *   3. ffmpeg reads RTSP over TCP and REPACKAGES the camera's H.264 into
 *      fragmented MP4 - `-c:v copy`, no re-encode
 *   4. Each chunk is appended to a SourceBuffer, and Chromium decodes the
 *      H.264 in HARDWARE
 *
 * This replaced JSMpeg, which required ffmpeg to re-encode the camera to
 * MPEG-1 so a JavaScript decoder could read it. That cost a measured 27.7 dB
 * PSNR against a bit-identical copy, and the JS decode could not keep up at
 * 720p, which is where the multi-second lag came from. Hardware decode of the
 * original bitstream has neither problem.
 *
 * The hook is deliberately renderer-side only. Every ffmpeg invocation lives
 * in the main process so the renderer's CSP never has to allow outbound RTSP
 * (it cannot) and so bugs in the IP-camera SDK cannot crash the visible window.
 */

export type RtspStatus = 'idle' | 'connecting' | 'streaming' | 'error'

export interface UseRtspStream {
  status: RtspStatus
  error: string | null
  /** Attach to the <video> element the preview should play in. */
  videoRef: (element: HTMLVideoElement | null) => void
  /** Manually reconnect (e.g. after a camera reboot). */
  reload: () => void
}

export interface UseRtspStreamOptions {
  rtspUrl: string | undefined
  /** The local server's port, from the VMS session; null until it is up. */
  sidecarPort: number | null
  /** false to tear the player down without unmounting the caller. */
  active?: boolean
}

const buildWsUrl = (sidecarPort: number, rtspUrl: string): string =>
  `ws://127.0.0.1:${sidecarPort}/rtsp?url=${encodeURIComponent(rtspUrl)}`

/**
 * Reads the H.264 profile and level out of an fMP4 initialisation segment and
 * builds the codec string MSE needs ("avc1.PPCCLL").
 *
 * The three bytes live in the `avcC` box, immediately after its four-character
 * tag: profile_idc, profile_compatibility, level_idc. Reading them beats
 * hard-coding a guess like avc1.640029 - Chromium checks the declared codec
 * against the stream, and a camera running Baseline when we claimed High is a
 * silent "SourceBuffer append failed" with nothing on screen.
 */
const codecFromInitSegment = (buffer: Uint8Array<ArrayBuffer>): string | null => {
  for (let i = 0; i + 8 < buffer.length; i += 1) {
    if (
      buffer[i] === 0x61 && // a
      buffer[i + 1] === 0x76 && // v
      buffer[i + 2] === 0x63 && // c
      buffer[i + 3] === 0x43 // C
    ) {
      const profile = buffer[i + 5]
      const compat = buffer[i + 6]
      const level = buffer[i + 7]
      if (profile === undefined || compat === undefined || level === undefined) return null
      const hex = (n: number): string => n.toString(16).padStart(2, '0')
      return `video/mp4; codecs="avc1.${hex(profile)}${hex(compat)}${hex(level)}"`
    }
  }
  return null
}

export const useRtspStream = ({
  rtspUrl,
  sidecarPort,
  active = true
}: UseRtspStreamOptions): UseRtspStream => {
  const [status, setStatus] = useState<RtspStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  const videoElRef = useRef<HTMLVideoElement | null>(null)

  /**
   * Consecutive automatic reconnects since the last healthy stream. A camera
   * that reboots, or a bridge that killed a stalled ffmpeg, should recover on
   * its own rather than making an operator notice a frozen picture.
   */
  const retriesRef = useRef(0)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // The port comes from the VMS session (useVmsSession), which resolves it
  // once; Argos Watch fetched it here with system:sidecar-port.

  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    videoElRef.current = element
  }, [])

  const reload = useCallback(() => {
    // A manual retry is the operator overriding whatever we concluded, so it
    // also clears the automatic-retry budget.
    retriesRef.current = 0
    setReloadTick((n) => n + 1)
  }, [])

  /** Give up after this many back-to-back failures and let the operator decide. */
  const MAX_AUTO_RETRIES = 5
  /** Long enough for a camera to finish rebooting, short enough to feel live. */
  const RETRY_DELAY_MS = 3_000

  useEffect(() => {
    const video = videoElRef.current
    if (!video || !rtspUrl || sidecarPort === null || !active) {
      setStatus('idle')
      return
    }

    setStatus('connecting')
    setError(null)

    let disposed = false
    let sawData = false
    const socket = new WebSocket(buildWsUrl(sidecarPort, rtspUrl))
    socket.binaryType = 'arraybuffer'

    const mediaSource = new MediaSource()
    let sourceBuffer: SourceBuffer | null = null
    // Chunks that arrived while the SourceBuffer was busy. append() throws if
    // called during an update, so everything queues through here.
    const queue: Uint8Array<ArrayBuffer>[] = []
    // Bytes received before the SourceBuffer exists. Held so the init segment
    // can be assembled across messages and then replayed in order.
    const pending: Uint8Array<ArrayBuffer>[] = []
    let pendingBytes = 0

    video.src = URL.createObjectURL(mediaSource)
    video.muted = true

    const pump = (): void => {
      if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return
      const chunk = queue.shift()
      if (!chunk) return
      try {
        sourceBuffer.appendBuffer(chunk)
      } catch {
        // QuotaExceeded is the common one: the buffer is full of decoded video
        // the operator has already watched. Dropping the backlog and trimming
        // below recovers without tearing the stream down.
        queue.length = 0
      }
    }

    /**
     * Keeps the buffered range short and the playhead near its leading edge.
     *
     * Without this the preview drifts: MSE happily buffers minutes of video,
     * and <video> plays from wherever it is, so the picture falls further
     * behind the camera the longer the shift runs. Trimming bounds memory, and
     * the seek bounds latency.
     */
    const trimAndCatchUp = (): void => {
      if (!sourceBuffer || sourceBuffer.updating) return
      try {
        const buffered = sourceBuffer.buffered
        if (buffered.length === 0) return
        const end = buffered.end(buffered.length - 1)
        const start = buffered.start(0)

        // Drop anything more than 10 s behind the leading edge.
        if (end - start > 10) sourceBuffer.remove(start, end - 10)

        // More than 1.5 s behind live: jump forward rather than playing catch-up
        // at 1x forever.
        if (end - video.currentTime > 1.5) video.currentTime = end - 0.3
      } catch {
        // remove() throws while the buffer updates; the next tick retries.
      }
    }

    const fail = (message: string): void => {
      if (disposed) return
      if (sawData && retriesRef.current < MAX_AUTO_RETRIES) {
        retriesRef.current += 1
        setStatus('connecting')
        setError(null)
        retryTimerRef.current = setTimeout(() => {
          retryTimerRef.current = null
          setReloadTick((n) => n + 1)
        }, RETRY_DELAY_MS)
        return
      }
      setStatus('error')
      setError((current) => current ?? message)
    }

    mediaSource.addEventListener('sourceopen', () => {
      // Nothing to do until the first chunk tells us which codec to declare.
    })

    socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (disposed) return
      const chunk = new Uint8Array(event.data)

      if (!sourceBuffer) {
        // The initialisation segment (ftyp + moov) usually lands whole in the
        // first message, but ffmpeg's write size is its own business - accumulate
        // until avcC is actually present rather than assuming one message holds
        // it. Everything gathered here is appended once the buffer exists, so no
        // bytes are dropped on the way.
        pending.push(chunk)
        pendingBytes += chunk.length
        const joined = new Uint8Array(pendingBytes)
        let at = 0
        for (const part of pending) {
          joined.set(part, at)
          at += part.length
        }

        const mime = codecFromInitSegment(joined)
        if (!mime) {
          // Give it a bounded amount of data before concluding the format is
          // unreadable; a moov this app cannot parse will not appear after
          // 256 KB of video.
          if (pendingBytes < 256 * 1024) return
          // Not H.264. H.265 cameras land here - Chromium's MSE does not decode
          // HEVC, so say so plainly rather than showing a black rectangle.
          fail(
            'This camera’s video format is not supported for live preview. It may be streaming H.265 (HEVC); switch the camera to H.264.'
          )
          try {
            socket.close()
          } catch {
            // ignore
          }
          return
        }
        if (!MediaSource.isTypeSupported(mime)) {
          fail(`This camera’s video format (${mime}) cannot be played here.`)
          return
        }
        if (mediaSource.readyState !== 'open') return
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mime)
          // 'sequence' would rewrite timestamps; the fMP4 already carries a
          // coherent timeline and we want to honour it so trimming works.
          sourceBuffer.mode = 'segments'
          sourceBuffer.addEventListener('updateend', () => {
            pump()
            trimAndCatchUp()
          })
        } catch (bufferError) {
          fail(
            bufferError instanceof Error
              ? bufferError.message
              : 'Could not start the video decoder.'
          )
          return
        }
      }

      if (!sawData) {
        sawData = true
        retriesRef.current = 0
        setStatus('streaming')
        void video.play().catch(() => {
          // Autoplay of a muted element is allowed; a rejection here is a
          // torn-down element, which the cleanup below already handles.
        })
      }

      if (pending.length > 0) {
        // Replay everything gathered while the codec was still unknown, in
        // arrival order - the init segment has to reach the buffer first.
        for (const part of pending) queue.push(part)
        pending.length = 0
        pendingBytes = 0
      } else {
        queue.push(chunk)
      }
      pump()
    }

    socket.onerror = () => {
      fail('Lost the connection to the local video service.')
    }

    socket.onclose = () => {
      if (disposed) return
      fail(
        sawData
          ? 'The camera stream ended. Check the camera is reachable and the URL is correct.'
          : 'Could not connect to the camera. Check the RTSP URL, credentials, and that the camera is on the same network.'
      )
    }

    // Hard cap on "connecting". If no fragment has arrived by now the camera is
    // not answering, or ffmpeg is producing nothing.
    const connectTimer = setTimeout(() => {
      if (disposed || sawData) return
      fail(
        'Timed out waiting for the camera. The RTSP URL may be wrong, or the network path is blocked.'
      )
      try {
        socket.close()
      } catch {
        // ignore
      }
    }, 25_000)

    return () => {
      disposed = true
      clearTimeout(connectTimer)
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      try {
        socket.close()
      } catch {
        // ignore
      }
      try {
        if (mediaSource.readyState === 'open') mediaSource.endOfStream()
      } catch {
        // endOfStream throws if a buffer is mid-update; nothing to recover.
      }
      try {
        URL.revokeObjectURL(video.src)
        video.removeAttribute('src')
        video.load()
      } catch {
        // ignore
      }
      setStatus('idle')
    }
  }, [rtspUrl, sidecarPort, active, reloadTick])

  return { status, error, videoRef, reload }
}
