/**
 * Why the last RTSP stream attempt failed.
 *
 * Crosses IPC so the renderer can show the operator something specific enough
 * to act on - or to screenshot and send to support - instead of a generic
 * "preview lost". Every field is safe to display: the URL arrives with its
 * credentials stripped.
 */
export interface StreamDiagnostics {
  /** Credential-stripped RTSP URL, safe to display and to screenshot. */
  rtspUrl: string | null
  /** One sentence naming the most likely cause. */
  reason: string
  /** Raw ffmpeg output or spawn error, for when the summary is not enough. */
  detail: string | null
  ffmpegPath: string
  ffmpegSource: string
  ffmpegUsable: boolean
  exitCode: number | null
  signal: string | null
  bytesReceived: number
  /** ISO timestamp, so a screenshot can be lined up against the log file. */
  at: string
}
