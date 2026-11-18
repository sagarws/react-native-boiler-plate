package com.rnboilerplate.photowidget

import kotlin.math.max
import kotlin.math.min

/**
 * Where a photo is drawn inside a widget (pure; unit tested — mirrored in
 * JS `photoLayout` for the in-app preview).
 *
 * 1. The frame: the whole widget, or — when the user chose a shape
 *    (frameW × frameH cells) — the largest rectangle of that shape that
 *    fits, centred.
 * 2. The photo inside the frame:
 *    - fit:  whole photo visible, letterboxed.
 *    - fill: covers the frame, centred (edges cropped).
 *    - crop: covers the frame at [zoom] (1–4×), centred on the user's focus
 *      point (focusX / focusY, 0–1 of the photo), kept inside the photo.
 */
object PhotoMath {
  data class Box(val left: Float, val top: Float, val width: Float, val height: Float)

  data class Layout(
    val frame: Box,
    /** Part of the photo to draw, in photo pixels. */
    val src: Box,
    /** Where to draw it, in widget pixels (inside [frame]). */
    val dst: Box,
  )

  fun frame(boxW: Float, boxH: Float, frameW: Int, frameH: Int): Box {
    if (frameW <= 0 || frameH <= 0) return Box(0f, 0f, boxW, boxH)
    val aspect = frameW.toFloat() / frameH
    val w = min(boxW, boxH * aspect)
    val h = w / aspect
    return Box((boxW - w) / 2f, (boxH - h) / 2f, w, h)
  }

  fun layout(
    imgW: Int,
    imgH: Int,
    boxW: Float,
    boxH: Float,
    mode: String,
    frameW: Int = 0,
    frameH: Int = 0,
    focusX: Float = 0.5f,
    focusY: Float = 0.5f,
    zoom: Float = 1f,
  ): Layout {
    val f = frame(boxW, boxH, frameW, frameH)
    val iw = max(1, imgW).toFloat()
    val ih = max(1, imgH).toFloat()
    if (mode == "fit") {
      val s = min(f.width / iw, f.height / ih)
      val w = iw * s
      val h = ih * s
      return Layout(f, Box(0f, 0f, iw, ih), Box(f.left + (f.width - w) / 2f, f.top + (f.height - h) / 2f, w, h))
    }
    val z = if (mode == "crop") zoom.coerceIn(1f, 4f) else 1f
    val s = max(f.width / iw, f.height / ih) * z
    val sw = min(iw, f.width / s)
    val sh = min(ih, f.height / s)
    val fx = if (mode == "crop") focusX.coerceIn(0f, 1f) else 0.5f
    val fy = if (mode == "crop") focusY.coerceIn(0f, 1f) else 0.5f
    val cx = (fx * iw).coerceIn(sw / 2f, iw - sw / 2f)
    val cy = (fy * ih).coerceIn(sh / 2f, ih - sh / 2f)
    return Layout(f, Box(cx - sw / 2f, cy - sh / 2f, sw, sh), f)
  }

  /** Largest power-of-two sample size that still decodes at least [needW] × [needH]. */
  fun sampleSize(srcW: Float, srcH: Float, needW: Float, needH: Float): Int {
    var s = 1
    while (srcW / (s * 2) >= needW && srcH / (s * 2) >= needH && s < 64) s *= 2
    return s
  }
}
