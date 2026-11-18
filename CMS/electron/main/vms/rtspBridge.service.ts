import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { WebSocket } from 'ws'
import { APP_NAME } from '@shared/constants/app'
import type { StreamDiagnostics } from '@shared/vms/stream'
import { summariseStreamFailure } from '@shared/vms/streamFailure'
import { logger } from '../services/logger'
import { resolveFfmpeg } from './ffmpegPath'

// stdio: ['ignore', 'pipe', 'pipe'] → ChildProcess with no stdin, and both
// stdout + stderr as Readable streams. Aliased so the BridgeInstance type
// below reads clearly at the call sites.
type FfmpegChild = ChildProcessByStdio<null, Readable, Readable>

/**
 * RTSP → fragmented MP4 bridge for the recorder's camera preview — ported from
 * Argos Watch's rtspBridge.service unchanged in behaviour.
 *
 * ONE FFMPEG PER CLIENT. A socket connects, ffmpeg starts for it; the socket
 * closes, that ffmpeg dies. Nothing is shared and nothing outlives its viewer
 * (a client joining a running ffmpeg mid-GOP decodes garbage until the next
 * keyframe — the reason Argos stopped sharing).
 *
 * The camera's H.264 is repackaged (`-c:v copy`), never re-encoded, into fMP4
 * that Media Source Extensions append to a <video>. The ffmpeg binary comes
 * from ./ffmpegPath (the CMS's bundled ffmpeg-static, unpacked from the asar).
 */

interface BridgeInstance {
  rtspUrl: string
  ffmpeg: FfmpegChild
  /** The single socket this ffmpeg feeds. */
  client: WebSocket
  /** Cumulative bytes fanned out — logged periodically for diagnostics. */
  bytesOut: number
  startedAt: number
  /**
   * When a chunk last arrived from ffmpeg. The health check below compares
   * against this to catch a stream that connected, worked, and then went
   * quiet - which keeps the WebSocket open and leaves the renderer painting
   * its last frame forever.
   */
  lastDataAt: number
  /**
   * Set when we kill ffmpeg ourselves for a known reason, so the exit handler
   * reports that instead of guessing from stderr the camera never wrote.
   */
  explicitFailure: string | null
  /**
   * Last few ffmpeg stderr lines. ffmpeg says exactly why a connection failed
   * ("401 Unauthorized", "Connection refused", "404 Not Found") and then exits;
   * without keeping them, all the operator ever sees is that it stopped.
   * Bounded so a chatty stream cannot grow this without limit.
   */
  stderrTail: string[]
}

/** Live sessions, one per connected socket. */
const sessions = new Set<BridgeInstance>()

/** How many ffmpeg stderr lines to keep for the failure report. */
const STDERR_TAIL_LINES = 12

/**
 * The most recent failure, in one slot rather than a per-URL map: the desktop
 * shows one feed at a time, and "the last thing that went wrong" is the
 * question the operator is asking. Shape lives in @shared/types/stream so the
 * renderer can render it.
 */
let lastFailure: StreamDiagnostics | null = null

export const getStreamDiagnostics = (): StreamDiagnostics | null => lastFailure

/** Records a failure for the renderer to collect. Overwrites the previous one. */
const recordFailure = (
  rtspUrl: string,
  partial: Pick<StreamDiagnostics, 'reason' | 'detail' | 'exitCode' | 'signal' | 'bytesReceived'>
): void => {
  const binary = resolveFfmpeg()
  lastFailure = {
    rtspUrl: redact(rtspUrl),
    ffmpegPath: binary.path,
    ffmpegSource: binary.source,
    ffmpegUsable: binary.usable,
    at: new Date().toISOString(),
    ...partial
  }
  logger.error('RTSP stream failed', lastFailure)
}

/**
 * ffmpeg argv for RTSP -> fragmented MP4.
 *
 * The camera's H.264 is REPACKAGED, never re-encoded. `-c:v copy` moves the
 * exact bitstream the camera produced into an fMP4 container that Media Source
 * Extensions can append to a <video> element, where Chromium decodes it in
 * hardware.
 *
 * This replaced an MPEG-1 re-encode feeding a JavaScript decoder (JSMpeg).
 * Measured against the same H.264 source:
 *
 *   re-encode to MPEG-1   PSNR 27.7 dB   (visibly soft, blocky on motion)
 *   -c:v copy to fMP4     PSNR inf       (bit-identical to the camera)
 *
 * MPEG-1 is a 1993 codec that needs several times the bitrate of H.264 for the
 * same picture, and decoding it in JS on the renderer's main thread could not
 * keep up at 720p - which is where both the softness and the multi-second lag
 * came from. Copying costs almost no CPU and cannot lose quality, because
 * there is no encoder in the path at all.
 *
 * movflags, in order:
 *   frag_keyframe      start a new fragment at each keyframe
 *   empty_moov         emit a moov with no samples up front, so MSE gets its
 *                      initialisation segment immediately instead of at EOF
 *   default_base_moof  required for MSE to resolve sample offsets
 *   +dash+delay_moov   keeps fragments self-contained and defers the moov only
 *                      until the stream parameters are known
 * -frag_duration bounds how long a fragment is held before being written, which
 * is the single biggest latency knob in this path.
 */
const buildFfmpegArgs = (rtspUrl: string): string[] => [
  '-hide_banner',
  '-loglevel',
  'warning',
  // RTSP socket I/O timeout, in MICROSECONDS. Without it ffmpeg waits forever
  // on an unresponsive camera. NOT -stimeout (removed in ffmpeg 6.0) and NOT
  // -rw_timeout (rejected outright by the win32 build).
  '-timeout',
  '10000000',
  // TCP, not the UDP default: UDP loses packets on office wifi and lost
  // packets in an inter-frame codec are exactly the smeared blocks this
  // pipeline is meant to stop producing.
  '-rtsp_transport',
  'tcp',
  // NOT -fflags nobuffer. It stops the demuxer buffering while it reads, so
  // packets needing reorder arrive incomplete. Measured on an H.264 source
  // with B-frames: PSNR fell from 51 dB to 20 dB and half the frames were
  // dropped. The picture it produced is the reason this file was rewritten.
  '-i',
  rtspUrl,
  // No audio: the preview is muted, and the recorder captures from the video
  // element. Dropping it saves bandwidth and removes a whole failure mode
  // around cameras that advertise an audio track they never send.
  '-an',
  // The whole point: no encoder in the path.
  '-c:v',
  'copy',
  '-f',
  'mp4',
  '-movflags',
  '+frag_keyframe+empty_moov+default_base_moof+dash+delay_moov',
  // 200 ms fragments. Shorter means lower latency and more container overhead;
  // this is small enough to feel live without fragmenting into noise.
  '-frag_duration',
  '200000',
  '-'
]

const spawnFfmpeg = (rtspUrl: string): FfmpegChild => {
  const args = buildFfmpegArgs(rtspUrl)
  logger.info('RTSP bridge spawning ffmpeg', { rtspUrl: redact(rtspUrl) })
  const child = spawn(resolveFfmpeg().path, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  return child
}

/**
 * Strip inline creds so a full URL never lands in a log line — an IP
 * camera's `admin:admin@` gets crawled off support laptops otherwise.
 * The URL itself is still used verbatim by ffmpeg; this only touches
 * the log payload.
 */
const redact = (url: string): string => url.replace(/(rtsp:\/\/)([^@\s]+)@/i, '$1***@')

/** Buffered write with backpressure awareness. Slow clients get dropped. */
const sendChunk = (ws: WebSocket, chunk: Buffer): void => {
  if (ws.readyState !== 1 /* OPEN */) return
  // 2 MB bufferedAmount ceiling. A client that cannot keep up (renderer
  // paused by devtools, machine load) gets closed; a re-open on the next
  // useEffect tick reconnects cleanly.
  if (ws.bufferedAmount > 2 * 1024 * 1024) {
    logger.warn('RTSP bridge dropping slow client', { bufferedAmount: ws.bufferedAmount })
    try {
      ws.close(1013, 'client too slow')
    } catch {
      // ignore
    }
    return
  }
  try {
    ws.send(chunk, { binary: true })
  } catch (error) {
    logger.warn('RTSP bridge send failed', {
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/**
 * Spawns a dedicated ffmpeg for one socket. Never reuses a running process:
 * see the note at the top of this file for why sharing produced a corrupt
 * picture on any client that did not start the stream itself.
 */
const startSession = (rtspUrl: string, client: WebSocket): BridgeInstance => {
  const ffmpeg = spawnFfmpeg(rtspUrl)
  const instance: BridgeInstance = {
    rtspUrl,
    ffmpeg,
    client,
    bytesOut: 0,
    startedAt: Date.now(),
    lastDataAt: Date.now(),
    explicitFailure: null,
    stderrTail: []
  }

  // Health check. Covers two distinct failures with one timer:
  //
  //   1. Never started. ffmpeg produced zero bytes within NO_DATA_TIMEOUT_MS -
  //      it is stuck on an RTSP handshake that will not complete (wrong path,
  //      blocked port, camera not answering).
  //   2. Stalled. Bytes flowed and then stopped for STALL_TIMEOUT_MS. This is
  //      the one that looked like the app hanging: ffmpeg stays alive, the
  //      WebSocket stays open, the preview has nothing to decode, and the renderer
  //      sits on its last painted frame still reporting "streaming". ffmpeg's
  //      own -timeout only governs socket reads, so a camera that keeps the
  //      TCP session alive while sending no video never trips it.
  //
  // Either way we kill ffmpeg, which closes the sockets and lets the renderer
  // fail loudly and reconnect, instead of showing a frozen picture.
  const NO_DATA_TIMEOUT_MS = 15_000
  const STALL_TIMEOUT_MS = 12_000
  const HEALTH_INTERVAL_MS = 4_000

  const killForHealth = (reason: string): void => {
    instance.explicitFailure = reason
    logger.warn('RTSP bridge killing ffmpeg', { rtspUrl: redact(rtspUrl), reason })
    try {
      instance.ffmpeg.kill('SIGKILL')
    } catch {
      // Already gone; the exit handler will still run.
    }
  }

  const healthTimer = setInterval(() => {
    // The socket going away kills this ffmpeg directly, so a closed client
    // means this timer has nothing left to police.
    if (instance.client.readyState !== 1 /* OPEN */) return

    const now = Date.now()
    if (instance.bytesOut === 0) {
      if (now - instance.startedAt > NO_DATA_TIMEOUT_MS) {
        killForHealth('Connected to the camera but no video arrived. Check the stream path, or try the second/sub stream.')
      }
      return
    }
    if (now - instance.lastDataAt > STALL_TIMEOUT_MS) {
      killForHealth('The camera stopped sending video. It may have dropped off the network or restarted.')
    }
  }, HEALTH_INTERVAL_MS)
  // Never hold the event loop open on account of a preview.
  healthTimer.unref?.()

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    // First-bytes log lets the main-process log show whether ffmpeg ever
    // produced output. Without this line, a "connecting forever" symptom
    // was indistinguishable from "streaming but the renderer isn't
    // receiving" — one is an ffmpeg problem, the other is a WebSocket
    // problem, and they need different fixes.
    if (instance.bytesOut === 0) {
      logger.info('RTSP bridge first bytes from ffmpeg', {
        rtspUrl: redact(rtspUrl),
        firstChunkBytes: chunk.length,
        elapsedMs: Date.now() - instance.startedAt
      })
    }
    instance.lastDataAt = Date.now()
    instance.bytesOut += chunk.length
    sendChunk(instance.client, chunk)
  })

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    // ffmpeg speaks on stderr for progress + warnings + fatal errors.
    // The `-loglevel warning` above trims the info firehose so anything
    // that shows up here is worth logging - and worth keeping, because the
    // exit handler below turns these lines into the operator-facing reason.
    const line = chunk.toString('utf8').trim()
    if (!line) return
    logger.warn('RTSP bridge ffmpeg stderr', { rtspUrl: redact(rtspUrl), line })
    instance.stderrTail.push(line)
    if (instance.stderrTail.length > STDERR_TAIL_LINES) instance.stderrTail.shift()
  })

  ffmpeg.on('exit', (code, signal) => {
    clearInterval(healthTimer)
    logger.info('RTSP bridge ffmpeg exited', { rtspUrl: redact(rtspUrl), code, signal })
    // A clean exit after a working stream is a teardown, not a failure. Any
    // other exit is something the operator may need to act on.
    if (code !== 0 || instance.bytesOut === 0) {
      recordFailure(rtspUrl, {
        reason: instance.explicitFailure ?? summariseStreamFailure(instance.stderrTail, instance.bytesOut),
        detail: instance.stderrTail.join('\n') || null,
        exitCode: code,
        signal: signal ?? null,
        bytesReceived: instance.bytesOut
      })
    }
    // Close the client with a distinct code so the renderer knows it was the
    // source, not a network drop, that ended the stream.
    try {
      instance.client.close(1011, `ffmpeg exit ${code ?? signal ?? 'unknown'}`)
    } catch {
      // ignore
    }
    sessions.delete(instance)
  })

  ffmpeg.on('error', (error) => {
    clearInterval(healthTimer)
    logger.error('RTSP bridge ffmpeg spawn error', {
      rtspUrl: redact(rtspUrl),
      error: error.message
    })
    const binary = resolveFfmpeg()
    recordFailure(rtspUrl, {
      // A spawn failure is never the camera's fault - it means the video
      // engine itself could not start, so say that instead of sending the
      // operator to check network cables.
      reason:
        binary.problem ??
        `The video engine could not start on this machine. Reinstall ${APP_NAME}, or contact support.`,
      detail: error.message,
      exitCode: null,
      signal: null,
      bytesReceived: instance.bytesOut
    })
    try {
      instance.client.close(1011, 'ffmpeg spawn failed')
    } catch {
      // ignore
    }
    sessions.delete(instance)
  })

  return instance
}

/**
 * Start a dedicated ffmpeg for this socket and stream it until either side
 * goes away. The `ws` must already be open - the caller (the sidecar's WS
 * route) owns the handshake.
 */
export const attachClient = (rtspUrl: string, ws: WebSocket): void => {
  const instance = startSession(rtspUrl, ws)
  sessions.add(instance)
  logger.info('RTSP session started', {
    rtspUrl: redact(rtspUrl),
    sessions: sessions.size
  })

  const stop = (): void => {
    if (!sessions.delete(instance)) return
    logger.info('RTSP session ended', {
      rtspUrl: redact(rtspUrl),
      sessions: sessions.size,
      uptimeMs: Date.now() - instance.startedAt,
      totalBytesOut: instance.bytesOut
    })
    // The viewer is gone, so its ffmpeg has nothing left to feed. SIGKILL
    // rather than SIGTERM: ffmpeg reading an RTSP socket over TCP can sit in a
    // blocking read and ignore SIGTERM for seconds, and on Windows every
    // signal is an unconditional terminate anyway.
    try {
      instance.ffmpeg.kill('SIGKILL')
    } catch {
      // Already gone.
    }
  }

  ws.on('close', stop)
  ws.on('error', stop)
}

/** Kill every session — called from stopSidecar / before-quit. */
export const stopAllBridges = (): void => {
  for (const instance of sessions) {
    try {
      instance.ffmpeg.kill('SIGKILL')
    } catch {
      // ignore
    }
    try {
      instance.client.close(1001, 'shutdown')
    } catch {
      // ignore
    }
  }
  sessions.clear()
}

/** For diagnostics / tests. */
export const listBridges = (): Array<{ rtspUrl: string; clients: number; bytesOut: number }> =>
  Array.from(sessions).map((b) => ({
    rtspUrl: redact(b.rtspUrl),
    clients: 1,
    bytesOut: b.bytesOut
  }))
