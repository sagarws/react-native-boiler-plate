package com.rnboilerplate.utility

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.sqrt

/**
 * The gravity direction for the bubble level: the fused gravity sensor, or
 * the accelerometer with a low-pass filter where that's missing. Reported
 * as a unit vector in device axes, at most ~20 times a second. Registered
 * only between [start] and [stop].
 */
class TiltSensor(
  context: Context,
  private val onTilt: (x: Double, y: Double, z: Double) -> Unit,
) : SensorEventListener {
  private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val gravity: Sensor? = manager.getDefaultSensor(Sensor.TYPE_GRAVITY)
  private val accel: Sensor? = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
  private val filtered = FloatArray(3)
  private var primed = false
  private var running = false
  private var lastEmit = 0L

  /** 'gravity' | 'accelerometer' | 'none'. */
  val support: String
    get() = when {
      gravity != null -> "gravity"
      accel != null -> "accelerometer"
      else -> "none"
    }

  fun start(): Boolean {
    if (running) return true
    val sensor = gravity ?: accel ?: return false
    running = true
    primed = false
    manager.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
    return true
  }

  fun stop() {
    if (!running) return
    running = false
    manager.unregisterListener(this)
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent) {
    val v = event.values
    if (event.sensor.type == Sensor.TYPE_GRAVITY || !primed) {
      filtered[0] = v[0]
      filtered[1] = v[1]
      filtered[2] = v[2]
      primed = true
    } else {
      // Accelerometer: keep the slow (gravity) part, drop hand shake.
      for (i in 0..2) filtered[i] += ALPHA * (v[i] - filtered[i])
    }
    val now = SystemClock.elapsedRealtime()
    if (now - lastEmit < EMIT_MS) return
    lastEmit = now
    val n = sqrt((filtered[0] * filtered[0] + filtered[1] * filtered[1] + filtered[2] * filtered[2]).toDouble())
    if (n < 1e-3) return
    onTilt(filtered[0] / n, filtered[1] / n, filtered[2] / n)
  }

  private companion object {
    const val ALPHA = 0.15f
    const val EMIT_MS = 50L
  }
}
