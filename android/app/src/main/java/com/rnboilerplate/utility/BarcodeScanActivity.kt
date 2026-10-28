package com.rnboilerplate.utility

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
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
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScanner
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import com.rnboilerplate.R
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Full-screen QR / barcode scanner: camera preview, a scan frame, torch and
 * pause. The bundled ML Kit model runs on the device; frames are analysed in
 * memory and never stored. A code is returned once it's read the same way
 * on two frames in a row, so a code left in view triggers one result only.
 */
class BarcodeScanActivity : ComponentActivity() {
  private lateinit var preview: PreviewView
  private lateinit var status: TextView
  private lateinit var torch: TextView
  private lateinit var pause: TextView
  private var camera: Camera? = null
  private var provider: ProcessCameraProvider? = null
  private val analysis: ExecutorService = Executors.newSingleThreadExecutor()
  private val scanner: BarcodeScanner by lazy { BarcodeScanning.getClient() }
  private var labels = JSONObject()
  @Volatile private var paused = false
  @Volatile private var done = false
  private var lastValue: String? = null
  private var torchOn = false

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    labels = try {
      JSONObject(intent.getStringExtra(EXTRA_LABELS) ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      finishWith(ERROR_PREFIX + "camera_permission")
      return
    }
    setContentView(buildUi())
    startCamera()
  }

  private fun label(key: String, fallback: String) = labels.optString(key).ifBlank { fallback }

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics)

  private fun pill(text: String): TextView =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = 15f
      setPadding(dp(16f).toInt(), dp(10f).toInt(), dp(16f).toInt(), dp(10f).toInt())
      background = android.graphics.drawable.GradientDrawable().apply {
        cornerRadius = dp(24f)
        setColor(0x99000000.toInt())
      }
      minHeight = dp(48f).toInt()
      gravity = Gravity.CENTER
      isClickable = true
      isFocusable = true
    }

  private fun buildUi(): View {
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    preview = PreviewView(this).apply { scaleType = PreviewView.ScaleType.FILL_CENTER }
    root.addView(preview, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    root.addView(ScanFrameView(this), FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    val top = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      val pad = dp(12f).toInt()
      setPadding(pad, dp(36f).toInt(), pad, pad)
    }
    val close = ImageButton(this).apply {
      setImageResource(R.drawable.ic_x)
      background = null
      contentDescription = label("close", "Close")
      minimumWidth = dp(48f).toInt()
      minimumHeight = dp(48f).toInt()
      setOnClickListener { finishWith(null) }
    }
    top.addView(close)
    top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
    torch = pill(label("torchOn", "Light")).apply {
      visibility = View.GONE
      setOnClickListener { toggleTorch() }
    }
    top.addView(torch)
    root.addView(top, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP))

    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER_HORIZONTAL
      val pad = dp(24f).toInt()
      setPadding(pad, pad, pad, dp(40f).toInt())
    }
    status = TextView(this).apply {
      text = label("aim", "Point the camera at a QR code or barcode")
      setTextColor(Color.WHITE)
      textSize = 16f
      gravity = Gravity.CENTER
      setShadowLayer(6f, 0f, 0f, Color.BLACK)
    }
    bottom.addView(status)
    pause = pill(label("pause", "Pause")).apply { setOnClickListener { togglePause() } }
    bottom.addView(pause, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
      topMargin = dp(16f).toInt()
    })
    root.addView(bottom, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM))
    return root
  }

  private fun startCamera() {
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener({
      try {
        val p = future.get()
        provider = p
        val previewUseCase = Preview.Builder().build().also { it.surfaceProvider = preview.surfaceProvider }
        val selector = ResolutionSelector.Builder()
          .setResolutionStrategy(
            ResolutionStrategy(android.util.Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
          )
          .build()
        val analyzer = ImageAnalysis.Builder()
          .setResolutionSelector(selector)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .build()
          .also { it.setAnalyzer(analysis) { image -> analyze(image) } }
        p.unbindAll()
        camera = p.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, previewUseCase, analyzer)
        if (camera?.cameraInfo?.hasFlashUnit() == true) torch.visibility = View.VISIBLE
      } catch (e: Exception) {
        finishWith(ERROR_PREFIX + "camera_failed")
      }
    }, ContextCompat.getMainExecutor(this))
  }

  @SuppressLint("UnsafeOptInUsageError")
  private fun analyze(image: ImageProxy) {
    val media = image.image
    if (paused || done || media == null) {
      image.close()
      return
    }
    val input = InputImage.fromMediaImage(media, image.imageInfo.rotationDegrees)
    scanner.process(input)
      .addOnSuccessListener { codes ->
        val code = codes.firstOrNull { !it.rawValue.isNullOrEmpty() }
        val value = code?.rawValue
        if (code != null && value != null && !done && !paused) {
          if (value == lastValue) {
            done = true
            finishWith(BarcodeJson.of(code).toString())
          } else {
            lastValue = value
          }
        } else if (code == null) {
          lastValue = null
        }
      }
      .addOnCompleteListener { image.close() }
  }

  private fun toggleTorch() {
    torchOn = !torchOn
    camera?.cameraControl?.enableTorch(torchOn)
    torch.text = if (torchOn) label("torchOff", "Light off") else label("torchOn", "Light")
  }

  private fun togglePause() {
    paused = !paused
    lastValue = null
    pause.text = if (paused) label("resume", "Resume") else label("pause", "Pause")
    status.text = if (paused) label("paused", "Paused") else label("aim", "Point the camera at a QR code or barcode")
  }

  private fun finishWith(result: String?) {
    runOnUiThread {
      if (result == null) {
        setResult(Activity.RESULT_CANCELED)
      } else {
        setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_RESULT, result))
      }
      finish()
    }
  }

  override fun onDestroy() {
    provider?.unbindAll()
    analysis.shutdown()
    try {
      scanner.close()
    } catch (_: Exception) {
      // Never created.
    }
    super.onDestroy()
  }

  /** Dims everything outside a centred square and draws its corners. */
  private class ScanFrameView(context: Context) : View(context) {
    private val dim = Paint().apply { color = 0x88000000.toInt() }
    private val corner = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      style = Paint.Style.STROKE
      strokeWidth = 8f
      strokeCap = Paint.Cap.ROUND
    }
    private val path = Path()

    override fun onDraw(canvas: Canvas) {
      val size = minOf(width, height) * 0.7f
      val left = (width - size) / 2
      val top = (height - size) / 2.2f
      val rect = RectF(left, top, left + size, top + size)
      path.reset()
      path.fillType = Path.FillType.EVEN_ODD
      path.addRect(0f, 0f, width.toFloat(), height.toFloat(), Path.Direction.CW)
      path.addRoundRect(rect, 32f, 32f, Path.Direction.CW)
      canvas.drawPath(path, dim)
      val l = size * 0.12f
      with(rect) {
        canvas.drawLine(left, top, left + l, top, corner)
        canvas.drawLine(left, top, left, top + l, corner)
        canvas.drawLine(right, top, right - l, top, corner)
        canvas.drawLine(right, top, right, top + l, corner)
        canvas.drawLine(left, bottom, left + l, bottom, corner)
        canvas.drawLine(left, bottom, left, bottom - l, corner)
        canvas.drawLine(right, bottom, right - l, bottom, corner)
        canvas.drawLine(right, bottom, right, bottom - l, corner)
      }
    }
  }

  companion object {
    const val EXTRA_LABELS = "labels"
    const val EXTRA_RESULT = "result"
    const val ERROR_PREFIX = "error:"
  }
}

/** A decoded code as JSON for JS (which re-validates everything). */
object BarcodeJson {
  private val FORMATS = mapOf(
    Barcode.FORMAT_QR_CODE to "QR_CODE",
    Barcode.FORMAT_AZTEC to "AZTEC",
    Barcode.FORMAT_DATA_MATRIX to "DATA_MATRIX",
    Barcode.FORMAT_PDF417 to "PDF417",
    Barcode.FORMAT_EAN_13 to "EAN_13",
    Barcode.FORMAT_EAN_8 to "EAN_8",
    Barcode.FORMAT_UPC_A to "UPC_A",
    Barcode.FORMAT_UPC_E to "UPC_E",
    Barcode.FORMAT_CODE_128 to "CODE_128",
    Barcode.FORMAT_CODE_39 to "CODE_39",
    Barcode.FORMAT_CODE_93 to "CODE_93",
    Barcode.FORMAT_CODABAR to "CODABAR",
    Barcode.FORMAT_ITF to "ITF",
  )

  fun of(code: Barcode): JSONObject {
    val o = JSONObject()
      .put("value", code.rawValue ?: "")
      .put("format", FORMATS[code.format] ?: "UNKNOWN")
    code.wifi?.let {
      o.put("wifi", JSONObject().put("ssid", it.ssid ?: "").put("password", it.password ?: "").put("type", it.encryptionType))
    }
    return o
  }
}
