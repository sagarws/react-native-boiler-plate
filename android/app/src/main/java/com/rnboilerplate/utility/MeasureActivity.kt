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
import android.opengl.GLES20
import android.opengl.GLSurfaceView
import android.opengl.Matrix
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat
import com.google.ar.core.Anchor
import com.google.ar.core.ArCoreApk
import com.google.ar.core.Camera
import com.google.ar.core.Config
import com.google.ar.core.DepthPoint
import com.google.ar.core.Frame
import com.google.ar.core.HitResult
import com.google.ar.core.Plane
import com.google.ar.core.Point
import com.google.ar.core.Session
import com.google.ar.core.TrackingFailureReason
import com.google.ar.core.TrackingState
import com.google.ar.core.exceptions.CameraNotAvailableException
import com.google.ar.core.exceptions.UnavailableUserDeclinedInstallationException
import com.google.ar.core.exceptions.UnavailableException
import com.rnboilerplate.R
import org.json.JSONObject
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/**
 * AR Measure with ARCore. Points are placed with the centre reticle on a
 * detected surface (plane, depth or feature point); nothing is guessed from
 * pixels. Length = straight line between two points; Height = their vertical
 * difference; Distance = camera to the aimed surface. A result can only be
 * saved while ARCore is tracking every point involved.
 */
class MeasureActivity : ComponentActivity(), GLSurfaceView.Renderer {
  private lateinit var surface: GLSurfaceView
  private lateinit var overlay: OverlayView
  private lateinit var status: TextView
  private lateinit var result: TextView
  private lateinit var addButton: TextView
  private lateinit var resetButton: TextView
  private lateinit var saveButton: TextView

  private var session: Session? = null
  private var installRequested = false
  private val background = ArBackgroundRenderer()
  private var mode = "length"
  private var unit = "cm"
  private var labels = JSONObject()

  // GL-thread state.
  private val anchors = mutableListOf<Anchor>()
  private var anchorSource = "plane"
  @Volatile private var addRequested = false
  @Volatile private var resetRequested = false
  @Volatile private var saveRequested = false
  private var capturedMeters: Double? = null
  private var capturedSource = ""
  private var lastUi = 0L
  private var surfaceWidth = 1
  private var surfaceHeight = 1
  private val view = FloatArray(16)
  private val proj = FloatArray(16)
  private val viewProj = FloatArray(16)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    mode = intent.getStringExtra(EXTRA_MODE)?.takeIf { it in MODES } ?: "length"
    unit = intent.getStringExtra(EXTRA_UNIT)?.takeIf { it in UNITS } ?: "cm"
    labels = try {
      JSONObject(intent.getStringExtra(EXTRA_LABELS) ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      finishWith(null, "camera_permission")
      return
    }
    setContentView(buildUi())
  }

  private fun label(key: String, fallback: String) = labels.optString(key).ifBlank { fallback }

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

  private fun button(text: String, primary: Boolean): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = 15f
      gravity = Gravity.CENTER
      minHeight = dp(48f).toInt()
      setPadding(dp(14f).toInt(), dp(10f).toInt(), dp(14f).toInt(), dp(10f).toInt())
      background = GradientDrawable().apply {
        cornerRadius = dp(24f)
        setColor(if (primary) 0xFF7C3AED.toInt() else 0x99000000.toInt())
      }
      isClickable = true
      isFocusable = true
    }

  private fun buildUi(): View {
    val root = FrameLayout(this)
    surface = GLSurfaceView(this).apply {
      preserveEGLContextOnPause = true
      setEGLContextClientVersion(2)
      setEGLConfigChooser(8, 8, 8, 8, 16, 0)
      setRenderer(this@MeasureActivity)
      renderMode = GLSurfaceView.RENDERMODE_CONTINUOUSLY
    }
    root.addView(surface, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    overlay = OverlayView(this)
    root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

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
    top.addView(TextView(this).apply {
      text = label("mode_$mode", mode)
      setTextColor(Color.WHITE)
      textSize = 18f
      setShadowLayer(6f, 0f, 0f, Color.BLACK)
    })
    root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      setPadding(dp(16f).toInt(), dp(16f).toInt(), dp(16f).toInt(), dp(36f).toInt())
      background = GradientDrawable(
        GradientDrawable.Orientation.BOTTOM_TOP,
        intArrayOf(0xCC000000.toInt(), 0x00000000),
      )
    }
    result = TextView(this).apply {
      setTextColor(Color.WHITE)
      textSize = 34f
      gravity = Gravity.CENTER
    }
    status = TextView(this).apply {
      setTextColor(Color.WHITE)
      textSize = 15f
      gravity = Gravity.CENTER
      text = label("initializing", "Move your phone slowly to find surfaces")
    }
    bottom.addView(result)
    bottom.addView(status)
    val row = LinearLayout(this).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(16f).toInt(), 0, 0)
    }
    resetButton = button(label("reset", "Reset"), false).apply { setOnClickListener { resetRequested = true } }
    addButton = button(
      if (mode == "distance") label("capture", "Capture") else label("addPoint", "Add point"),
      true,
    ).apply { setOnClickListener { addRequested = true } }
    saveButton = button(label("save", "Save"), false).apply {
      isEnabled = false
      alpha = 0.4f
      setOnClickListener { saveRequested = true }
    }
    val gap = dp(8f).toInt()
    listOf(resetButton, addButton, saveButton).forEach {
      row.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
        marginStart = gap
        marginEnd = gap
      })
    }
    bottom.addView(row)
    root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    return root
  }

  override fun onResume() {
    super.onResume()
    if (!::surface.isInitialized) return
    if (session == null) {
      try {
        when (ArCoreApk.getInstance().requestInstall(this, !installRequested)) {
          ArCoreApk.InstallStatus.INSTALL_REQUESTED -> {
            installRequested = true
            return
          }
          else -> Unit
        }
        session = Session(this).also { configure(it) }
      } catch (e: UnavailableUserDeclinedInstallationException) {
        finishWith(null, "ar_install_declined")
        return
      } catch (e: UnavailableException) {
        finishWith(null, "ar_unsupported")
        return
      } catch (e: Exception) {
        finishWith(null, "ar_failed")
        return
      }
    }
    try {
      session?.resume()
    } catch (e: CameraNotAvailableException) {
      finishWith(null, "ar_failed")
      return
    }
    surface.onResume()
  }

  private fun configure(s: Session) {
    val config = Config(s).apply {
      planeFindingMode = Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL
      focusMode = Config.FocusMode.AUTO
      updateMode = Config.UpdateMode.LATEST_CAMERA_IMAGE
      if (s.isDepthModeSupported(Config.DepthMode.AUTOMATIC)) depthMode = Config.DepthMode.AUTOMATIC
    }
    s.configure(config)
  }

  override fun onPause() {
    super.onPause()
    if (::surface.isInitialized) surface.onPause()
    session?.pause()
  }

  override fun onDestroy() {
    session?.close()
    session = null
    super.onDestroy()
  }

  // ── GL thread ──

  override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
    GLES20.glClearColor(0f, 0f, 0f, 1f)
    background.create()
  }

  override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
    GLES20.glViewport(0, 0, width, height)
    surfaceWidth = width
    surfaceHeight = height
    @Suppress("DEPRECATION")
    session?.setDisplayGeometry(windowManager.defaultDisplay.rotation, width, height)
  }

  override fun onDrawFrame(gl: GL10?) {
    GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT or GLES20.GL_DEPTH_BUFFER_BIT)
    val s = session ?: return
    val frame: Frame = try {
      s.setCameraTextureName(background.textureId)
      s.update()
    } catch (_: Exception) {
      return
    }
    background.draw(frame)
    val camera = frame.camera
    val tracking = camera.trackingState == TrackingState.TRACKING
    val hit = if (tracking) centerHit(frame) else null

    if (resetRequested) {
      resetRequested = false
      anchors.forEach { it.detach() }
      anchors.clear()
      capturedMeters = null
    }
    if (addRequested) {
      addRequested = false
      if (hit != null) {
        if (mode == "distance") {
          capturedMeters = MeasureMath.distance(camera.pose.translation, hit.first.hitPose.translation)
          capturedSource = hit.second
        } else if (anchors.size < 2) {
          anchors.add(hit.first.createAnchor())
          anchorSource = if (anchors.size == 1) hit.second else worse(anchorSource, hit.second)
        }
      }
    }

    camera.getViewMatrix(view, 0)
    camera.getProjectionMatrix(proj, 0, 0.05f, 100f)
    Matrix.multiplyMM(viewProj, 0, proj, 0, view, 0)
    val anchorsTracking = anchors.all { it.trackingState == TrackingState.TRACKING }
    val points = anchors.mapNotNull { MeasureMath.project(viewProj, it.pose.translation, surfaceWidth, surfaceHeight) }

    val meters: Double? = when {
      mode == "distance" -> capturedMeters
        ?: hit?.let { MeasureMath.distance(camera.pose.translation, it.first.hitPose.translation) }
      anchors.size == 2 -> {
        val a = anchors[0].pose.translation
        val b = anchors[1].pose.translation
        if (mode == "height") MeasureMath.vertical(a, b) else MeasureMath.distance(a, b)
      }
      anchors.size == 1 && hit != null -> {
        val a = anchors[0].pose.translation
        val b = hit.first.hitPose.translation
        if (mode == "height") MeasureMath.vertical(a, b) else MeasureMath.distance(a, b)
      }
      else -> null
    }
    val complete = if (mode == "distance") capturedMeters != null else anchors.size == 2
    val canSave = complete && tracking && anchorsTracking && (meters ?: 0.0) > 0.0

    if (saveRequested) {
      saveRequested = false
      if (canSave && meters != null) {
        val source = if (mode == "distance") capturedSource else anchorSource
        finishWith(JSONObject().put("mode", mode).put("meters", meters).put("source", source).toString(), null)
        return
      }
    }

    overlay.update(points, hit != null, complete)
    val now = System.currentTimeMillis()
    if (now - lastUi > 100) {
      lastUi = now
      val message = statusFor(camera, tracking, hit != null, anchorsTracking, complete)
      runOnUiThread {
        result.text = meters?.let { MeasureMath.format(it, unit) } ?: ""
        status.text = message
        addButton.isEnabled = hit != null && !complete
        addButton.alpha = if (addButton.isEnabled) 1f else 0.4f
        saveButton.isEnabled = canSave
        saveButton.alpha = if (canSave) 1f else 0.4f
      }
    }
  }

  /** The best surface hit under the reticle, with where it came from. */
  private fun centerHit(frame: Frame): Pair<HitResult, String>? {
    val hits = frame.hitTest(surfaceWidth / 2f, surfaceHeight / 2f)
    for (h in hits) {
      val t = h.trackable
      when {
        t is Plane && t.isPoseInPolygon(h.hitPose) && h.distance > 0 -> return h to "plane"
        t is DepthPoint -> return h to "depth"
        t is Point && t.orientationMode == Point.OrientationMode.ESTIMATED_SURFACE_NORMAL -> return h to "point"
      }
    }
    return null
  }

  private fun worse(a: String, b: String): String {
    val rank = listOf("plane", "depth", "point")
    return if (rank.indexOf(b) > rank.indexOf(a)) b else a
  }

  private fun statusFor(
    camera: Camera,
    tracking: Boolean,
    hasHit: Boolean,
    anchorsTracking: Boolean,
    complete: Boolean,
  ): String {
    if (!tracking) {
      return when (camera.trackingFailureReason) {
        TrackingFailureReason.INSUFFICIENT_LIGHT -> label("lowLight", "Too dark — add more light")
        TrackingFailureReason.EXCESSIVE_MOTION -> label("tooFast", "Moving too fast — slow down")
        TrackingFailureReason.INSUFFICIENT_FEATURES -> label("fewFeatures", "Aim at a textured surface")
        TrackingFailureReason.CAMERA_UNAVAILABLE -> label("cameraUnavailable", "Camera unavailable")
        else -> label("initializing", "Move your phone slowly to find surfaces")
      }
    }
    if (!anchorsTracking) return label("lostPoints", "Points lost — point back at them or reset")
    if (complete) return label("doneHint", "Save the result, or reset to measure again")
    if (!hasHit) return label("aimSurface", "Aim the centre at a surface")
    return when {
      mode == "distance" -> label("captureHint", "Tap Capture to keep this distance")
      anchors.isEmpty() -> label("firstPoint", "Aim at the start and tap Add point")
      else -> label(if (mode == "height") "secondPointHeight" else "secondPoint", "Aim at the end and tap Add point")
    }
  }

  private fun finishWith(json: String?, error: String?) {
    runOnUiThread {
      when {
        error != null -> setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_ERROR, error))
        json != null -> setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_RESULT, json))
        else -> setResult(Activity.RESULT_CANCELED)
      }
      finish()
    }
  }

  /** Reticle, placed points and the line between them. */
  private class OverlayView(context: Context) : View(context) {
    @Volatile private var points: List<FloatArray> = emptyList()
    @Volatile private var hasHit = false
    @Volatile private var complete = false
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 5f
    }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private val line = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      strokeWidth = 6f
      strokeCap = Paint.Cap.ROUND
    }

    fun update(points: List<FloatArray>, hasHit: Boolean, complete: Boolean) {
      this.points = points
      this.hasHit = hasHit
      this.complete = complete
      postInvalidate()
    }

    override fun onDraw(canvas: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val pts = points
      if (pts.size == 2) canvas.drawLine(pts[0][0], pts[0][1], pts[1][0], pts[1][1], line)
      else if (pts.size == 1 && !complete) canvas.drawLine(pts[0][0], pts[0][1], cx, cy, line)
      pts.forEach { canvas.drawCircle(it[0], it[1], 14f, dot) }
      ring.color = if (hasHit) 0xFF4ADE80.toInt() else 0xCCFFFFFF.toInt()
      canvas.drawCircle(cx, cy, 28f, ring)
      canvas.drawCircle(cx, cy, 4f, dot)
    }
  }

  companion object {
    const val EXTRA_MODE = "mode"
    const val EXTRA_UNIT = "unit"
    const val EXTRA_LABELS = "labels"
    const val EXTRA_RESULT = "result"
    const val EXTRA_ERROR = "error"
    private val MODES = setOf("length", "height", "distance")
    private val UNITS = setOf("cm", "m", "in", "ft")
  }
}
