/**
 * Video-compression knobs. Ported from TrackVid-App src/server/index.js
 * (getCrfFromLevel + cpuPreset + threadCount).
 *
 * The recorder writes an uncapped WebM to disk; the upload driver runs a
 * client-side libx264 re-encode into MP4 right before POSTing to the backend.
 * "similar" is a fast-path: the driver ships the original file untouched so
 * the operator keeps native camera/stream resolution and quality.
 *
 * Change any value here and both the recorder-side upload driver and the
 * form-field sent to the backend follow — nothing else hard-codes CRF or
 * preset choice.
 */

export type CompressionLevel = 'similar' | 'medium' | 'low'

/** libx264 CRF per level. Lower = higher quality + larger file. */
export const COMPRESSION_CRF: Record<CompressionLevel, number> = {
  similar: 28,
  medium: 32,
  low: 36
}

/** x264 preset picked by CPU count. veryfast on beefier boxes, ultrafast on lean ones. */
export const FFMPEG_PRESET_LOW_CPU = 'ultrafast'
export const FFMPEG_PRESET_HIGH_CPU = 'veryfast'
export const FFMPEG_CPU_THRESHOLD = 4

/** Percentage of logical CPUs ffmpeg is allowed to consume. */
export const FFMPEG_THREAD_PERCENT = 40

/** Container + codec + audio treatment applied to Medium / Low re-encodes. */
export const COMPRESSED_CONTAINER_EXTENSION = '.mp4'
export const COMPRESSED_VIDEO_CODEC = 'libx264'
export const COMPRESSED_AUDIO_HANDLING = 'copy'
export const COMPRESSED_CONTENT_TYPE = 'video/mp4'

/**
 * Accept the wire value (string enum from the company settings UI, or a
 * legacy number from older sessions) and return the internal level. Anything
 * unrecognised — undefined, unexpected string, a number — resolves to
 * `'similar'`, which is the no-op fast path.
 */
export const normalizeCompressionLevel = (raw: unknown): CompressionLevel => {
  if (typeof raw !== 'string') return 'similar'
  const lowered = raw.trim().toLowerCase()
  if (lowered === 'medium') return 'medium'
  if (lowered === 'low') return 'low'
  return 'similar'
}
