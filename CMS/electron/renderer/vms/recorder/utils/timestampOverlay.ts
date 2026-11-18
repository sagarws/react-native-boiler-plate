/**
 * Burned-in timestamp for recordings and screenshots. Ported from Argos Watch
 * (renderer/utils/timestampOverlay.ts).
 *
 * Packing evidence with no visible date and time is weak evidence: a file's
 * metadata does not survive a re-encode, a download or a screenshot, so the
 * stamp is drawn into the pixels. Drawn here rather than by ffmpeg because the
 * bundled ffmpeg has no drawtext filter and the RTSP bridge stream-copies.
 *
 * THESE ARE PIXELS IN THE EVIDENCE, NOT UI. They do not follow the theme: a
 * recording made in dark mode must look like one made in light mode. Named
 * canvas colours plus `globalAlpha` express Argos Watch's plate (a near-black at
 * 62 %) and its white text without a colour literal in a renderer file.
 */

import type { StampFields } from '@shared/vms/timestamp'
import { computeOsdMaskBand, computeStampLayout } from '@shared/vms/timestamp'

export type { StampFields }

const FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace'

/** See Argos Watch: covers the strip an IP camera burns its own OSD into. */
export const MASK_CAMERA_OSD = true

/** Exported so the recording and the screenshot cannot mask different strips. */
export const maskCameraOsd = (ctx: CanvasRenderingContext2D, width: number, height: number): void => {
  if (!MASK_CAMERA_OSD) return
  ctx.save()
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, width, computeOsdMaskBand(height))
  ctx.restore()
}

/** Draws the stamp into the bottom-left of an already-painted frame. */
export const drawTimestamp = (ctx: CanvasRenderingContext2D, height: number, fields: StampFields): void => {
  ctx.save()
  ctx.textBaseline = 'top'

  const layout = computeStampLayout(height, fields, (text, fontPx) => {
    ctx.font = `600 ${fontPx}px ${FONT}`

    return ctx.measureText(text).width
  })

  // The plate: a filled rectangle rather than a text shadow — a shadow
  // disappears over a dark parcel, a plate never does.
  ctx.globalAlpha = 0.62
  ctx.fillStyle = 'black'
  ctx.fillRect(layout.box.x, layout.box.y, layout.box.width, layout.box.height)

  ctx.globalAlpha = 1
  ctx.fillStyle = 'white'
  ctx.font = `600 ${layout.primaryFontPx}px ${FONT}`
  ctx.fillText(layout.primary, layout.primaryAt.x, layout.primaryAt.y)

  if (layout.detail) {
    ctx.globalAlpha = 0.82
    ctx.font = `500 ${layout.detailFontPx}px ${FONT}`
    ctx.fillText(layout.detail, layout.detailAt.x, layout.detailAt.y)
  }

  ctx.restore()
}

/**
 * Paints one video frame plus the stamp onto a canvas, resizing the canvas to
 * the source whenever the source resolution changes. False when the video has
 * no frame yet, so callers can skip rather than record a blank.
 */
export const paintStampedFrame = (
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  fields: StampFields,
  options?: { maskOsd?: boolean }
): boolean => {
  const width = video.videoWidth
  const height = video.videoHeight

  if (!width || !height) return false

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }

  const ctx = canvas.getContext('2d')

  if (!ctx) return false

  ctx.drawImage(video, 0, 0, width, height)
  if (options?.maskOsd) maskCameraOsd(ctx, width, height)
  drawTimestamp(ctx, height, fields)

  return true
}
