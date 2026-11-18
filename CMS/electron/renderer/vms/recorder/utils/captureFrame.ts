import type { StampFields } from './timestampOverlay'
import { drawTimestamp } from './timestampOverlay'

/**
 * Grab a JPEG data-URL from a live <video> element, with the same burned-in
 * stamp as the recording. Ported from Argos Watch (utils/captureFrame.ts).
 */
export const captureVideoFrame = (video: HTMLVideoElement, quality = 0.85, stamp?: StampFields): string | null => {
  const width = video.videoWidth
  const height = video.videoHeight

  if (!width || !height) return null

  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')

  if (!ctx) return null

  ctx.drawImage(video, 0, 0, width, height)
  if (stamp) drawTimestamp(ctx, height, stamp)

  try {
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return null
  }
}

/** Data-URL → Blob, for the screenshot uploads. Null when it will not parse. */
export const dataUrlToBlob = (dataUrl: string): Blob | null => {
  const match = /^data:([^;]+);base64,(.*)$/.exec(dataUrl)

  if (!match || !match[1] || match[2] === undefined) return null

  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)

  return new Blob([bytes], { type: match[1] })
}
