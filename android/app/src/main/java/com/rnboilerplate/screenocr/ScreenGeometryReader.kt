package com.rnboilerplate.screenocr

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.DisplayMetrics
import android.view.Display
import android.view.WindowInsets
import android.view.WindowManager

/**
 * Reads the current [ScreenGeometry] in the coordinate space pagination
 * targets use: physical pixels of the full default display in its current
 * rotation (the space of `dispatchGesture` and `getBoundsInScreen`).
 */
object ScreenGeometryReader {
  fun current(context: Context): ScreenGeometry {
    val display =
      context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    val rotation = display?.rotation ?: 0
    val dpi = context.resources.displayMetrics.densityDpi
    val wm = context.getSystemService(WindowManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val metrics = wm.maximumWindowMetrics
      val insets =
        metrics.windowInsets.getInsetsIgnoringVisibility(
          WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars() or
            WindowInsets.Type.displayCutout(),
        )
      return ScreenGeometry(
        widthPx = metrics.bounds.width(),
        heightPx = metrics.bounds.height(),
        densityDpi = dpi,
        rotation = rotation,
        insetTop = insets.top,
        insetBottom = insets.bottom,
        insetLeft = insets.left,
        insetRight = insets.right,
      )
    }
    val dm = DisplayMetrics()
    @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
    return ScreenGeometry(dm.widthPixels, dm.heightPixels, dm.densityDpi, rotation)
  }
}
