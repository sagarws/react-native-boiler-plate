package com.rnboilerplate.utility

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.cos
import kotlin.math.sin

class SightMathTest {
  /** Device → world rotation for a phone held upright (portrait, screen
   *  facing the user), its camera aimed [pitchDeg] above the horizon and
   *  turned [yawDeg] clockwise from north. */
  private fun upright(pitchDeg: Double, yawDeg: Double = 0.0): FloatArray {
    // Upright facing north: device x = east, y = up, z = south (towards the user).
    val p = Math.toRadians(pitchDeg)
    val yw = Math.toRadians(yawDeg)
    // Columns are the device axes in world coordinates.
    fun yaw(v: DoubleArray) = doubleArrayOf(
      v[0] * cos(yw) + v[1] * sin(yw),
      -v[0] * sin(yw) + v[1] * cos(yw),
      v[2],
    )
    val x = yaw(doubleArrayOf(1.0, 0.0, 0.0))
    // The camera looks along −z: (0, cos p, sin p). y = z × x keeps the
    // axes right-handed.
    val yAxis = yaw(doubleArrayOf(0.0, -sin(p), cos(p)))
    val zAxis = yaw(doubleArrayOf(0.0, -cos(p), -sin(p)))
    return floatArrayOf(
      x[0].toFloat(), yAxis[0].toFloat(), zAxis[0].toFloat(),
      x[1].toFloat(), yAxis[1].toFloat(), zAxis[1].toFloat(),
      x[2].toFloat(), yAxis[2].toFloat(), zAxis[2].toFloat(),
    )
  }

  @Test
  fun elevationFollowsTheCameraAim() {
    assertEquals(0.0, SightMath.elevationFromRotation(upright(0.0)), 1e-4)
    assertEquals(30.0, SightMath.elevationFromRotation(upright(30.0)), 1e-4)
    assertEquals(-20.0, SightMath.elevationFromRotation(upright(-20.0)), 1e-4)
  }

  @Test
  fun azimuthFollowsTheTurn() {
    assertEquals(0.0, SightMath.azimuthFromRotation(upright(0.0)), 1e-4)
    assertEquals(90.0, SightMath.azimuthFromRotation(upright(10.0, 90.0)), 1e-3)
  }

  @Test
  fun elevationFromGravity() {
    // Upright: gravity reads +y → camera level.
    assertEquals(0.0, SightMath.elevationFromGravity(0f, 9.81f, 0f), 1e-6)
    // Flat, screen up: camera points at the floor.
    assertEquals(-90.0, SightMath.elevationFromGravity(0f, 0f, 9.81f), 1e-6)
    // Tilted back 30° (camera up 30°): z component = −g·sin 30°.
    assertEquals(30.0, SightMath.elevationFromGravity(0f, 8.4957f, -4.905f), 1e-3)
    assertTrue(SightMath.elevationFromGravity(0f, 0f, 0f).isNaN())
  }

  @Test
  fun averagesHeadingsAcrossNorth() {
    assertEquals(0.0, SightMath.meanHeading(listOf(359.0, 1.0)).let { if (it > 180) it - 360 else it }, 1e-6)
    assertEquals(90.0, SightMath.meanHeading(listOf(80.0, 100.0)), 1e-6)
  }

  @Test
  fun steadinessNeedsEnoughCloseSamples() {
    assertTrue(SightMath.steady(listOf(10.0, 10.2, 10.1, 10.4, 10.3)))
    assertFalse(SightMath.steady(listOf(10.0, 12.0, 10.1, 10.4, 10.3)))
    assertFalse(SightMath.steady(listOf(10.0, 10.1)))
  }
}
