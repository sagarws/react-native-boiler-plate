package com.rnboilerplate.utility

import java.util.Locale
import kotlin.math.abs
import kotlin.math.sqrt

/** Measurement maths and display (pure; unit tested). World units are metres. */
object MeasureMath {
  fun distance(a: FloatArray, b: FloatArray): Double {
    val dx = (a[0] - b[0]).toDouble()
    val dy = (a[1] - b[1]).toDouble()
    val dz = (a[2] - b[2]).toDouble()
    return sqrt(dx * dx + dy * dy + dz * dz)
  }

  /** ARCore's world Y axis points up (against gravity), so height is ΔY. */
  fun vertical(a: FloatArray, b: FloatArray): Double = abs((a[1] - b[1]).toDouble())

  /** Projects a world point to screen pixels, or null when it's behind the camera. */
  fun project(viewProj: FloatArray, p: FloatArray, width: Int, height: Int): FloatArray? {
    val x = viewProj[0] * p[0] + viewProj[4] * p[1] + viewProj[8] * p[2] + viewProj[12]
    val y = viewProj[1] * p[0] + viewProj[5] * p[1] + viewProj[9] * p[2] + viewProj[13]
    val w = viewProj[3] * p[0] + viewProj[7] * p[1] + viewProj[11] * p[2] + viewProj[15]
    if (w <= 1e-4f) return null
    return floatArrayOf((x / w + 1f) / 2f * width, (1f - y / w) / 2f * height)
  }

  /** "1.23 m", "123.4 cm", "48.6 in", "4.05 ft". */
  fun format(meters: Double, unit: String): String =
    when (unit) {
      "m" -> String.format(Locale.getDefault(), "%.2f m", meters)
      "in" -> String.format(Locale.getDefault(), "%.1f in", meters / 0.0254)
      "ft" -> String.format(Locale.getDefault(), "%.2f ft", meters / 0.3048)
      else -> String.format(Locale.getDefault(), "%.1f cm", meters * 100)
    }
}
