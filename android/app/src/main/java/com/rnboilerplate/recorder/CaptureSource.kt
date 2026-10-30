package com.rnboilerplate.recorder

import android.content.Context
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Surface
import android.view.WindowManager

/**
 * One consented MediaProjection and its single VirtualDisplay.
 *
 * Android 14+ allows one virtual display per projection, so instead of
 * re-creating it the display's surface is switched: an ImageReader for a
 * screenshot, the video encoder's input surface while recording, nothing
 * (no frames rendered) when idle. Recording keeps the encoder size it
 * started with; screenshots follow the current orientation.
 */
class CaptureSource(
  private val context: Context,
  val projection: MediaProjection,
  private val onStopped: () -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private var display: VirtualDisplay? = null
  private var reader: ImageReader? = null
  private var released = false

  private val callback =
    object : MediaProjection.Callback() {
      override fun onStop() {
        // The user ended sharing, the screen locked (Android 15+) or another
        // app started its own capture: the token is gone for good.
        if (released) return
        main.post { onStopped() }
      }
    }

  init {
    projection.registerCallback(callback, main)
  }

  data class Metrics(val width: Int, val height: Int, val dpi: Int)

  fun metrics(): Metrics {
    val wm = context.getSystemService(WindowManager::class.java)
    val dpi = context.resources.displayMetrics.densityDpi
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.currentWindowMetrics.bounds
      return Metrics(b.width(), b.height(), dpi)
    }
    val dm = DisplayMetrics()
    @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
    return Metrics(dm.widthPixels, dm.heightPixels, dpi)
  }

  private fun ensureDisplay(width: Int, height: Int, dpi: Int, surface: Surface?) {
    val current = display
    if (current == null) {
      display =
        projection.createVirtualDisplay(
          "AksharRecorder",
          width,
          height,
          dpi,
          DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
          surface,
          null,
          main,
        )
    } else {
      current.resize(width, height, dpi)
      current.surface = surface
    }
  }

  /** Points the display at the encoder's input (size fixed for the recording). */
  fun attachEncoder(surface: Surface, width: Int, height: Int) {
    ensureDisplay(width, height, metrics().dpi, surface)
  }

  /** No surface: the compositor renders nothing for us (pause, idle). */
  fun detach() {
    display?.surface = null
  }

  /**
   * Captures one frame at the current screen size. [onResult] gets null when
   * nothing arrived within [timeoutMs] (e.g. capture blocked).
   */
  fun screenshot(timeoutMs: Long, onResult: (Bitmap?) -> Unit) {
    val m = metrics()
    reader?.close()
    val r = ImageReader.newInstance(m.width, m.height, PixelFormat.RGBA_8888, 2)
    reader = r
    var done = false
    val timeout = Runnable {
      if (done) return@Runnable
      done = true
      detach()
      onResult(null)
    }
    r.setOnImageAvailableListener({ ir ->
      if (done) return@setOnImageAvailableListener
      val image = try { ir.acquireLatestImage() } catch (_: Exception) { null } ?: return@setOnImageAvailableListener
      done = true
      main.removeCallbacks(timeout)
      val bitmap =
        try {
          val plane = image.planes[0]
          val rowPadding = plane.rowStride - plane.pixelStride * image.width
          val padded = Bitmap.createBitmap(image.width + rowPadding / plane.pixelStride, image.height, Bitmap.Config.ARGB_8888)
          padded.copyPixelsFromBuffer(plane.buffer)
          if (padded.width == image.width) padded
          else Bitmap.createBitmap(padded, 0, 0, image.width, image.height).also { padded.recycle() }
        } catch (_: Exception) {
          null
        } finally {
          image.close()
        }
      detach()
      onResult(bitmap)
    }, main)
    ensureDisplay(m.width, m.height, m.dpi, r.surface)
    main.postDelayed(timeout, timeoutMs)
  }

  fun release() {
    if (released) return
    released = true
    try {
      projection.unregisterCallback(callback)
    } catch (_: Exception) {
    }
    display?.release()
    display = null
    reader?.close()
    reader = null
    try {
      projection.stop()
    } catch (_: Exception) {
    }
  }
}
