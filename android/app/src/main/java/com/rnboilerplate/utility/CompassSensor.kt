package com.rnboilerplate.utility

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.view.Surface
import android.view.Display
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Magnetic heading from the fused rotation-vector sensor, or accelerometer +
 * magnetometer where that's missing. Corrected for the screen's rotation and
 * smoothed on the unit circle (so 359° → 1° doesn't swing through 180°).
 * Sensors are registered only between [start] and [stop].
 */
class CompassSensor(
  private val context: Context,
  private val onHeading: (heading: Double, accuracy: Int) -> Unit,
) : SensorEventListener {
  private val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val rotationSensor: Sensor? = manager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
  private val accel: Sensor? = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
  private val magnet: Sensor? = manager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)

  private val gravity = FloatArray(3)
  private val geomagnetic = FloatArray(3)
  private var hasGravity = false
  private var hasMagnet = false
  private val rotation = FloatArray(9)
  private val remapped = FloatArray(9)
  private val orientation = FloatArray(3)

  private var smoothX = 0.0
  private var smoothY = 0.0
  private var primed = false
  private var accuracy = SensorManager.SENSOR_STATUS_UNRELIABLE
  private var lastEmit = 0L
  private var lastHeading = -1.0
  private var running = false

  /** 'rotation_vector' | 'accel_mag' | 'none'. */
  val support: String
    get() = when {
      rotationSensor != null && magnet != null -> "rotation_vector"
      accel != null && magnet != null -> "accel_mag"
      else -> "none"
    }

  fun start(): Boolean {
    if (running) return true
    if (support == "none") return false
    running = true
    primed = false
    hasGravity = false
    hasMagnet = false
    if (support == "rotation_vector") {
      manager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_GAME)
    } else {
      manager.registerListener(this, accel, SensorManager.SENSOR_DELAY_GAME)
    }
    // The magnetometer also reports calibration accuracy.
    manager.registerListener(this, magnet, SensorManager.SENSOR_DELAY_GAME)
    return true
  }

  fun stop() {
    if (!running) return
    running = false
    manager.unregisterListener(this)
  }

  override fun onAccuracyChanged(sensor: Sensor, value: Int) {
    if (sensor.type == Sensor.TYPE_MAGNETIC_FIELD) accuracy = value
  }

  override fun onSensorChanged(event: SensorEvent) {
    when (event.sensor.type) {
      Sensor.TYPE_ROTATION_VECTOR -> {
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        publish()
      }
      Sensor.TYPE_ACCELEROMETER -> {
        lowPass(event.values, gravity, hasGravity)
        hasGravity = true
      }
      Sensor.TYPE_MAGNETIC_FIELD -> {
        lowPass(event.values, geomagnetic, hasMagnet)
        hasMagnet = true
        if (support == "accel_mag" && hasGravity &&
          SensorManager.getRotationMatrix(rotation, null, gravity, geomagnetic)
        ) {
          publish()
        }
      }
    }
  }

  private fun lowPass(input: FloatArray, out: FloatArray, primed: Boolean) {
    for (i in 0..2) out[i] = if (primed) out[i] + 0.2f * (input[i] - out[i]) else input[i]
  }

  /** Rotation of the main screen; DisplayManager works from the app context. */
  private fun displayRotation(): Int =
    (context.getSystemService(Context.DISPLAY_SERVICE) as DisplayManager)
      .getDisplay(Display.DEFAULT_DISPLAY)?.rotation ?: Surface.ROTATION_0

  private fun publish() {
    // Heading of the top of the screen, whichever way the phone is turned.
    val (x, y) = when (displayRotation()) {
      Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
      Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
      Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
      else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
    }
    SensorManager.remapCoordinateSystem(rotation, x, y, remapped)
    SensorManager.getOrientation(remapped, orientation)
    val raw = orientation[0].toDouble()
    if (!primed) {
      smoothX = cos(raw)
      smoothY = sin(raw)
      primed = true
    } else {
      smoothX += SMOOTHING * (cos(raw) - smoothX)
      smoothY += SMOOTHING * (sin(raw) - smoothY)
    }
    val heading = (Math.toDegrees(atan2(smoothY, smoothX)) + 360.0) % 360.0
    val now = System.currentTimeMillis()
    if (now - lastEmit < MIN_INTERVAL_MS) return
    if (lastHeading >= 0 && angleDelta(heading, lastHeading) < 0.3) return
    lastEmit = now
    lastHeading = heading
    onHeading(heading, accuracy)
  }

  companion object {
    /** Low-pass weight per sample: steady without feeling laggy. */
    private const val SMOOTHING = 0.15
    /** ~25 updates a second at most. */
    private const val MIN_INTERVAL_MS = 40L

    fun angleDelta(a: Double, b: Double): Double {
      val d = Math.abs(a - b) % 360.0
      return if (d > 180) 360 - d else d
    }
  }
}
