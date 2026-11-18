package com.rnboilerplate.utility

import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Where the back camera points, from the phone's sensors (pure; unit tested).
 * The camera looks along the device's −Z axis.
 *
 * - Rotation matrix [r] (row-major 3×3 from SensorManager.getRotationMatrixFromVector,
 *   device → world; world X east, Y north, Z up): camera direction in world
 *   = −(r[2], r[5], r[8]).
 * - Gravity-sensor reading [g] (points up at rest): elevation = asin(−gz / |g|).
 * Angles in degrees; elevation + above the horizon.
 */
object SightMath {
  private fun deg(r: Double) = Math.toDegrees(r)

  fun elevationFromRotation(r: FloatArray): Double = deg(asin((-r[8]).toDouble().coerceIn(-1.0, 1.0)))

  /** Compass-style heading (0 = world Y, clockwise), 0–360. */
  fun azimuthFromRotation(r: FloatArray): Double {
    val a = deg(atan2((-r[2]).toDouble(), (-r[5]).toDouble()))
    return (a + 360.0) % 360.0
  }

  /** NaN when the reading has no length. */
  fun elevationFromGravity(x: Float, y: Float, z: Float): Double {
    val n = sqrt((x * x + y * y + z * z).toDouble())
    if (n < 1e-3) return Double.NaN
    return deg(asin((-z / n).coerceIn(-1.0, 1.0)))
  }

  /** Mean of headings on the circle (so 359° and 1° average to 0°), 0–360. */
  fun meanHeading(values: List<Double>): Double {
    var s = 0.0
    var c = 0.0
    for (v in values) {
      s += sin(Math.toRadians(v))
      c += cos(Math.toRadians(v))
    }
    return (deg(atan2(s, c)) + 360.0) % 360.0
  }

  /** Largest minus smallest — how steady the aim was. */
  fun spread(values: List<Double>): Double =
    if (values.isEmpty()) 0.0 else (values.maxOrNull()!! - values.minOrNull()!!)

  /** Steady enough to capture. */
  fun steady(values: List<Double>, maxSpread: Double = 1.0): Boolean =
    values.size >= 5 && abs(spread(values)) <= maxSpread
}
