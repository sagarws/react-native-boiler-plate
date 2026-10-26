package com.rnboilerplate.screenocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.util.DisplayMetrics
import android.view.WindowInsets
import android.view.WindowManager
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Grabs single frames from a user-consented [MediaProjection].
 *
 * One virtual display is created per projection (Android 14+ allows only one)
 * and it starts with **no surface**, so nothing is rendered or copied while
 * the user is not capturing. A capture attaches the [ImageReader] surface,
 * takes the first frame, and detaches it again — no continuous capture, no
 * polling. Rotation is handled by resizing the display before a capture.
 *
 * Content Android protects (FLAG_SECURE windows, DRM video) arrives black;
 * that is the platform's decision and is deliberately not worked around.
 */
class ScreenCapturer(
  private val context: Context,
  private val projection: MediaProjection,
  private val onStopped: () -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val thread = HandlerThread("ScreenOcrCapture").apply { start() }
  private val worker = Handler(thread.looper)
  private var reader: ImageReader? = null
  private var display: VirtualDisplay? = null
  private var width = 0
  private var height = 0
  private var released = false

  private val projectionCallback =
    object : MediaProjection.Callback() {
      override fun onStop() {
        // The user or the system ended the session (status-bar stop, lock
        // screen on newer Android, another app taking over the projection).
        main.post { onStopped() }
      }
    }

  init {
    // Android 14 requires the callback before the virtual display exists.
    projection.registerCallback(projectionCallback, main)
    ensureDisplay()
  }

  private data class Metrics(val width: Int, val height: Int, val densityDpi: Int)

  private fun metrics(): Metrics {
    val wm = context.getSystemService(WindowManager::class.java)
    val dpi = context.resources.displayMetrics.densityDpi
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.maximumWindowMetrics.bounds
      return Metrics(bounds.width(), bounds.height(), dpi)
    }
    val dm = DisplayMetrics()
    @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
    return Metrics(dm.widthPixels, dm.heightPixels, dm.densityDpi)
  }

  private fun ensureDisplay() {
    val m = metrics()
    if (display != null && m.width == width && m.height == height) return
    width = m.width
    height = m.height
    reader?.close()
    reader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 2)
    val existing = display
    if (existing == null) {
      display =
        projection.createVirtualDisplay(
          "ScreenOcr",
          width,
          height,
          m.densityDpi,
          DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
          null,
          null,
          worker,
        )
    } else {
      existing.resize(width, height, m.densityDpi)
    }
  }

  /** Captures one frame. Call on the main thread; [onResult] runs on the main thread. */
  fun capture(timeoutMs: Long, onResult: (Bitmap?) -> Unit) {
    if (released) {
      onResult(null)
      return
    }
    try {
      ensureDisplay()
    } catch (e: RuntimeException) {
      onResult(null)
      return
    }
    val imageReader = reader
    val virtualDisplay = display
    if (imageReader == null || virtualDisplay == null) {
      onResult(null)
      return
    }

    // Drop any frame left over from a previous capture.
    imageReader.acquireLatestImage()?.close()
    val (cropTop, cropBottom) = systemBarInsets()

    val done = AtomicBoolean(false)
    fun finish(bitmap: Bitmap?) {
      imageReader.setOnImageAvailableListener(null, null)
      virtualDisplay.surface = null
      onResult(bitmap)
    }
    val timeout = Runnable { if (done.compareAndSet(false, true)) finish(null) }

    imageReader.setOnImageAvailableListener(
      { source ->
        val image = source.acquireLatestImage() ?: return@setOnImageAvailableListener
        if (!done.compareAndSet(false, true)) {
          image.close()
          return@setOnImageAvailableListener
        }
        val bitmap =
          try {
            toBitmap(image, cropTop, cropBottom)
          } catch (e: RuntimeException) {
            null
          } finally {
            image.close()
          }
        main.post {
          main.removeCallbacks(timeout)
          finish(bitmap)
        }
      },
      worker,
    )
    virtualDisplay.surface = imageReader.surface
    main.postDelayed(timeout, timeoutMs)
  }

  /**
   * Status-bar and navigation-bar heights. They are cropped away: the clock,
   * battery and notification icons are not screen text (the Devanagari model
   * read them as "১l61" on a test device), and a changing clock would look
   * like new text to the reading session on every screen.
   */
  private fun systemBarInsets(): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val wm = context.getSystemService(WindowManager::class.java)
      val insets =
        wm.currentWindowMetrics.windowInsets.getInsetsIgnoringVisibility(
          WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars() or
            WindowInsets.Type.displayCutout(),
        )
      return insets.top to insets.bottom
    }
    val res = context.resources
    val id = res.getIdentifier("status_bar_height", "dimen", "android")
    return (if (id > 0) res.getDimensionPixelSize(id) else 0) to 0
  }

  /** RGBA frame → ARGB bitmap, cropped of row padding and system bars, scaled for OCR. */
  private fun toBitmap(image: Image, cropTop: Int, cropBottom: Int): Bitmap {
    val plane = image.planes[0]
    val pixelStride = plane.pixelStride
    val rowPadding = plane.rowStride - pixelStride * image.width
    val padded =
      Bitmap.createBitmap(
        image.width + rowPadding / pixelStride,
        image.height,
        Bitmap.Config.ARGB_8888,
      )
    padded.copyPixelsFromBuffer(plane.buffer)
    val top = cropTop.coerceIn(0, image.height / 4)
    val height = (image.height - top - cropBottom.coerceIn(0, image.height / 4)).coerceAtLeast(1)
    val cropped =
      if (padded.width == image.width && top == 0 && height == image.height) {
        padded
      } else {
        Bitmap.createBitmap(padded, 0, top, image.width, height).also { padded.recycle() }
      }
    // ML Kit needs ~16px per character; a 1080px short side keeps phone UI
    // text well above that while bounding memory and inference time on QHD+
    // screens.
    val shortSide = min(cropped.width, cropped.height)
    if (shortSide <= MAX_SHORT_SIDE) return cropped
    val scale = MAX_SHORT_SIDE.toFloat() / shortSide
    val scaled =
      Bitmap.createScaledBitmap(
        cropped,
        (cropped.width * scale).roundToInt(),
        (cropped.height * scale).roundToInt(),
        true,
      )
    if (scaled !== cropped) cropped.recycle()
    return scaled
  }

  fun release() {
    if (released) return
    released = true
    reader?.setOnImageAvailableListener(null, null)
    display?.release()
    reader?.close()
    display = null
    reader = null
    projection.unregisterCallback(projectionCallback)
    projection.stop()
    thread.quitSafely()
  }

  private companion object {
    const val MAX_SHORT_SIDE = 1080
  }
}
