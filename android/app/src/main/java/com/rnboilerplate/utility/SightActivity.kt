package com.rnboilerplate.utility

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.rnboilerplate.R
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Angle sighting for trigonometric measuring: camera preview with a
 * crosshair and the live elevation of the camera's aim. The user aims at
 * each point in turn (the steps come from JS, already translated) and taps
 * Capture; the angle is averaged over the last ~0.3 s. Returns a JSON array
 * of {elevation, azimuth|null}. Frames are only shown, never analysed or
 * stored.
 *
 * Sensors: game rotation vector (no magnetometer, so nearby metal doesn't
 * bend the turn between points), else rotation vector, else gravity /
 * accelerometer (elevation only; azimuth is then null).
 */
class SightActivity : ComponentActivity(), SensorEventListener {
  private lateinit var preview: PreviewView
  private lateinit var angleText: TextView
  private lateinit var stepText: TextView
  private lateinit var steadyText: TextView
  private lateinit var captureButton: TextView
  private lateinit var backButton: TextView
  private lateinit var crosshair: CrosshairView
  private var provider: ProcessCameraProvider? = null
  private lateinit var sensors: SensorManager
  private var sensor: Sensor? = null
  private var hasHeading = false

  private var labels = JSONObject()
  private var steps: List<String> = emptyList()
  private val captures = mutableListOf<JSONObject>()
  private val elevations = ArrayDeque<Double>()
  private val headings = ArrayDeque<Double>()
  private val rotation = FloatArray(9)
  private var lastUi = 0L

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    labels = try {
      JSONObject(intent.getStringExtra(EXTRA_LABELS) ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    steps = labels.optJSONArray("steps")?.let { arr -> (0 until arr.length()).map { arr.optString(it) } }.orEmpty()
    if (steps.isEmpty()) {
      finishWith(null, "sight_failed")
      return
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      finishWith(null, "camera_permission")
      return
    }
    sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
    sensor = sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
      ?: sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
      ?: sensors.getDefaultSensor(Sensor.TYPE_GRAVITY)
      ?: sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    if (sensor == null) {
      finishWith(null, "no_sensor")
      return
    }
    hasHeading = sensor!!.type == Sensor.TYPE_GAME_ROTATION_VECTOR || sensor!!.type == Sensor.TYPE_ROTATION_VECTOR
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    setContentView(buildUi())
    showStep()
    startCamera()
  }

  override fun onResume() {
    super.onResume()
    sensor?.let { sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
  }

  override fun onPause() {
    if (::sensors.isInitialized) sensors.unregisterListener(this)
    super.onPause()
  }

  override fun onDestroy() {
    provider?.unbindAll()
    super.onDestroy()
  }

  private fun label(key: String, fallback: String) = labels.optString(key).ifBlank { fallback }

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

  private fun button(text: String, primary: Boolean): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = 16f
      gravity = Gravity.CENTER
      minHeight = dp(52f).toInt()
      setPadding(dp(16f).toInt(), dp(12f).toInt(), dp(16f).toInt(), dp(12f).toInt())
      background = GradientDrawable().apply {
        cornerRadius = dp(26f)
        setColor(if (primary) 0xFF7C3AED.toInt() else 0x99000000.toInt())
      }
      isClickable = true
      isFocusable = true
    }

  private fun shadowText(size: Float): TextView =
    TextView(this).apply {
      setTextColor(Color.WHITE)
      textSize = size
      gravity = Gravity.CENTER
      setShadowLayer(6f, 0f, 0f, Color.BLACK)
    }

  private fun buildUi(): View {
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    crosshair = CrosshairView(this)
    root.addView(crosshair, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    val top = LinearLayout(this).apply {
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12f).toInt(), dp(36f).toInt(), dp(12f).toInt(), dp(12f).toInt())
    }
    top.addView(ImageButton(this).apply {
      setImageResource(R.drawable.ic_x)
      background = null
      contentDescription = label("close", "Close")
      minimumWidth = dp(48f).toInt()
      minimumHeight = dp(48f).toInt()
      setOnClickListener { finishWith(null, null) }
    })
    top.addView(shadowText(18f).apply {
      text = label("title", "Angle measure")
      gravity = Gravity.START
    })
    root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(16f).toInt(), dp(16f).toInt(), dp(16f).toInt(), dp(36f).toInt())
      background = GradientDrawable(GradientDrawable.Orientation.BOTTOM_TOP, intArrayOf(0xCC000000.toInt(), 0x00000000))
    }
    angleText = shadowText(40f)
    stepText = shadowText(16f)
    steadyText = shadowText(14f)
    bottom.addView(angleText)
    bottom.addView(stepText)
    bottom.addView(steadyText)
    val row = LinearLayout(this).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(16f).toInt(), 0, 0)
    }
    backButton = button(label("back", "Back"), false).apply { setOnClickListener { undo() } }
    captureButton = button(label("capture", "Capture angle"), true).apply { setOnClickListener { capture() } }
    val gap = dp(8f).toInt()
    row.addView(backButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = gap })
    row.addView(captureButton, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 2f).apply { marginStart = gap })
    bottom.addView(row)
    root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    return root
  }

  private fun startCamera() {
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      try {
        val p = future.get()
        provider = p
        val use = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
        p.unbindAll()
        p.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, use)
      } catch (_: Exception) {
        finishWith(null, "camera_failed")
      }
    }, ContextCompat.getMainExecutor(this))
  }

  private fun showStep() {
    val i = captures.size
    stepText.text = steps.getOrElse(i) { "" }
    backButton.isEnabled = i > 0
    backButton.alpha = if (i > 0) 1f else 0.4f
  }

  private fun undo() {
    if (captures.isEmpty()) return
    captures.removeAt(captures.size - 1)
    showStep()
  }

  private fun capture() {
    if (elevations.size < MIN_SAMPLES) return
    val e = elevations.average()
    val o = JSONObject().put("elevation", e)
    if (hasHeading && headings.isNotEmpty()) o.put("azimuth", SightMath.meanHeading(headings.toList()))
    else o.put("azimuth", JSONObject.NULL)
    captures.add(o)
    if (captures.size >= steps.size) {
      finishWith(JSONArray(captures).toString(), null)
      return
    }
    showStep()
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) = Unit

  override fun onSensorChanged(event: SensorEvent) {
    val elevation: Double
    var heading: Double? = null
    when (event.sensor.type) {
      Sensor.TYPE_GAME_ROTATION_VECTOR, Sensor.TYPE_ROTATION_VECTOR -> {
        SensorManager.getRotationMatrixFromVector(rotation, event.values)
        elevation = SightMath.elevationFromRotation(rotation)
        heading = SightMath.azimuthFromRotation(rotation)
      }
      else -> elevation = SightMath.elevationFromGravity(event.values[0], event.values[1], event.values[2])
    }
    if (elevation.isNaN()) return
    elevations.addLast(elevation)
    if (elevations.size > WINDOW) elevations.removeFirst()
    if (heading != null) {
      headings.addLast(heading)
      if (headings.size > WINDOW) headings.removeFirst()
    }
    val now = SystemClock.elapsedRealtime()
    if (now - lastUi < UI_MS) return
    lastUi = now
    val shown = elevations.average()
    angleText.text = String.format(Locale.getDefault(), "%+.1f°", shown)
    val steady = SightMath.steady(elevations.toList())
    steadyText.text = if (steady) label("steady", "Steady") else label("holdSteady", "Hold the phone steady")
    steadyText.setTextColor(if (steady) 0xFF4ADE80.toInt() else 0xFFFBBF24.toInt())
    crosshair.update(shown, steady)
  }

  private fun finishWith(json: String?, error: String?) {
    setResult(
      if (json != null) Activity.RESULT_OK else Activity.RESULT_CANCELED,
      Intent().apply {
        json?.let { putExtra(EXTRA_RESULT, it) }
        error?.let { putExtra(EXTRA_ERROR, it) }
      },
    )
    finish()
  }

  /** Crosshair in the centre, plus a horizon line that shows the tilt. */
  private class CrosshairView(context: Context) : View(context) {
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 4f
      color = Color.WHITE
      setShadowLayer(4f, 0f, 0f, Color.BLACK)
    }
    private val horizon = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      strokeWidth = 3f
      color = 0xCCFFFFFF.toInt()
      pathEffect = android.graphics.DashPathEffect(floatArrayOf(18f, 12f), 0f)
    }
    private var elevation = 0.0

    init {
      setLayerType(LAYER_TYPE_SOFTWARE, null)
    }

    fun update(elevation: Double, steady: Boolean) {
      this.elevation = elevation
      ring.color = if (steady) 0xFF4ADE80.toInt() else Color.WHITE
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val r = width * 0.06f
      canvas.drawCircle(cx, cy, r, ring)
      canvas.drawLine(cx - r * 2.2f, cy, cx - r * 0.6f, cy, ring)
      canvas.drawLine(cx + r * 0.6f, cy, cx + r * 2.2f, cy, ring)
      canvas.drawLine(cx, cy - r * 2.2f, cx, cy - r * 0.6f, ring)
      canvas.drawLine(cx, cy + r * 0.6f, cx, cy + r * 2.2f, ring)
      canvas.drawCircle(cx, cy, 3f, ring)
      // Where the horizon would be (≈ one screen-height per 60°).
      val y = (cy + elevation / 60.0 * height).toFloat()
      if (y in 0f..height.toFloat()) canvas.drawLine(0f, y, width.toFloat(), y, horizon)
    }
  }

  companion object {
    const val EXTRA_LABELS = "labels"
    const val EXTRA_RESULT = "result"
    const val EXTRA_ERROR = "error"
    private const val WINDOW = 15
    private const val MIN_SAMPLES = 5
    private const val UI_MS = 66L
  }
}
