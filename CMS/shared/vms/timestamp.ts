/**
 * Layout and formatting for the burned-in evidence timestamp.
 *
 * Pure, and in shared/ so it can be tested: the actual canvas calls live in
 * electron/renderer/utils/timestampOverlay.ts, which only turns this layout
 * into fillRect and fillText. Text width is injected rather than measured here,
 * so nothing in this file needs a DOM.
 */

export interface StampFields {
  /** Wall-clock time of the frame. */
  at: Date
  /** The AWB being recorded, when one has been scanned. */
  awb?: string | undefined
  /** Feed or station name, so a frame identifies where it was taken. */
  feed?: string | undefined
}

/**
 * Formatted as YYYY-MM-DD HH:MM:SS in local time.
 *
 * Deliberately not toLocaleString: 09/08 is the 9th of August to half the world
 * and the 8th of September to the other half, which is exactly the ambiguity a
 * disputed shipping date cannot afford.
 */
export const formatStamp = (date: Date): string => {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

export interface StampLayout {
  primary: string
  detail: string | null
  primaryFontPx: number
  detailFontPx: number
  box: { x: number; y: number; width: number; height: number }
  primaryAt: { x: number; y: number }
  detailAt: { x: number; y: number }
}

/**
 * Places the stamp in the bottom-left of a frame `height` tall.
 *
 * Type size is a fraction of frame height so it stays legible whether the
 * source is a 640x480 webcam or a 4K camera, with a floor because 2.8% of a
 * small frame is unreadable.
 */
export const computeStampLayout = (
  height: number,
  fields: StampFields,
  measure: (text: string, fontPx: number) => number
): StampLayout => {
  const primaryFontPx = Math.max(12, Math.round(height * 0.028))
  const detailFontPx = Math.round(primaryFontPx * 0.78)
  const pad = Math.round(primaryFontPx * 0.55)
  const gap = Math.round(primaryFontPx * 0.45)

  const primary = formatStamp(fields.at)
  const detailText = [fields.awb ? `AWB ${fields.awb}` : null, fields.feed ?? null]
    .filter(Boolean)
    .join('   ')
  const detail = detailText.length > 0 ? detailText : null

  const primaryWidth = measure(primary, primaryFontPx)
  const detailWidth = detail ? measure(detail, detailFontPx) : 0

  const lineHeight = primaryFontPx * 1.18
  const detailHeight = detail ? detailFontPx * 1.25 + gap : 0
  const width = Math.max(primaryWidth, detailWidth) + pad * 2
  const boxHeight = lineHeight + detailHeight + pad * 2
  const x = pad
  // Clamped so a tall stamp on a short frame is never pushed off the top.
  const y = Math.max(0, height - boxHeight - pad)

  return {
    primary,
    detail,
    primaryFontPx,
    detailFontPx,
    box: { x, y, width, height: boxHeight },
    primaryAt: { x: x + pad, y: y + pad },
    detailAt: { x: x + pad, y: y + pad + lineHeight + gap }
  }
}

/**
 * Height of the strip masked over an IP camera's own on-screen display, as a
 * fraction of frame height.
 *
 * 0.09 is 65px on 720p and 97px on 1080p. A camera OSD row sits a small margin
 * below the top edge and is typically 30-40px tall at 720p, so this covers it
 * with room to spare. Every pixel added here is a pixel of packing bench that
 * the evidence no longer shows, so it is kept as tight as it can be.
 *
 * Lives here, next to computeStampLayout, because the two share one invariant:
 * the mask is at the top, our stamp is at the bottom, and they must never meet.
 */
export const OSD_BAND_FRACTION = 0.09

/** Pixel height of the masked strip for a given frame height. */
export const computeOsdMaskBand = (height: number): number =>
  Math.round(height * OSD_BAND_FRACTION)
