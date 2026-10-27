package com.rnboilerplate.screenocr

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.rnboilerplate.R
import kotlin.math.roundToInt

/**
 * Lets the user pin the Next Page button: a draggable crosshair plus a small
 * control bar (Fixed / Moves with content, Cancel, Save).
 *
 * The crosshair is its own small window that consumes the drag, so the app
 * underneath is never tapped while positioning. Nothing is stored until the
 * user taps Save; the crosshair's on-screen centre (physical screen px, same
 * space as gestures) is then handed to [Listener.onPinned] and both windows
 * are removed, so they cannot intercept the later click.
 */
class TargetPicker(private val context: Context, private val listener: Listener) {
  interface Listener {
    fun onPinned(x: Int, y: Int, anchor: TargetAnchor)

    fun onPickerCancelled()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private fun dp(v: Int) = (v * density).roundToInt()

  private val markerSize = dp(72)
  private var anchor = TargetAnchor.SCREEN
  private var attached = false

  private val ring = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val crosshair = ImageView(context).apply { setImageResource(R.drawable.ic_crosshair) }
  private val marker =
    FrameLayout(context).apply {
      background = ring
      contentDescription = context.getString(R.string.picker_marker)
      addView(crosshair, FrameLayout.LayoutParams(dp(40), dp(40), Gravity.CENTER))
    }
  private val markerParams =
    WindowManager.LayoutParams(
        markerSize,
        markerSize,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      )
      .apply { gravity = Gravity.TOP or Gravity.START }

  private val barBackground = GradientDrawable().apply { cornerRadius = dp(20).toFloat() }
  private val hint = TextView(context).apply { setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f) }
  private val anchorButton = textButton("") { toggleAnchor() }
  private val cancelButton = textButton(context.getString(R.string.picker_cancel)) { cancel() }
  private val saveButton = textButton(context.getString(R.string.picker_save)) { save() }
  private val bar =
    LinearLayout(context).apply {
      orientation = LinearLayout.VERTICAL
      background = barBackground
      setPadding(dp(14), dp(10), dp(14), dp(8))
      elevation = dp(6).toFloat()
      addView(hint)
      addView(
        LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.END
          addView(anchorButton)
          addView(cancelButton)
          addView(saveButton)
        },
      )
    }
  private val barParams =
    WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT,
      )
      .apply {
        gravity = Gravity.TOP
        y = dp(48)
      }

  private fun textButton(label: String, onClick: () -> Unit) =
    Button(context, null, android.R.attr.borderlessButtonStyle).apply {
      text = label
      isAllCaps = false
      minHeight = dp(48)
      setOnClickListener { onClick() }
    }

  init {
    marker.setOnTouchListener(DragListener())
    refreshAnchorLabel()
  }

  val isShowing: Boolean
    get() = attached

  /** Shows the picker; starts at [startX],[startY] (e.g. the saved target) or near the bottom right. */
  fun show(config: OcrConfig, startX: Int?, startY: Int?) {
    if (attached) return
    ring.setColor(withAlpha(config.panelColor, 0xCC))
    ring.setStroke(dp(3), config.bubbleColor)
    crosshair.imageTintList = ColorStateList.valueOf(config.bubbleColor)
    barBackground.setColor(config.panelColor)
    hint.setTextColor(config.panelTextColor)
    for (b in listOf(anchorButton, cancelButton)) b.setTextColor(config.panelTextColor)
    saveButton.setTextColor(config.bubbleColor)
    hint.text = context.getString(R.string.picker_hint)

    val geometry = ScreenGeometryReader.current(context)
    val cx = startX ?: (geometry.widthPx - dp(64))
    val cy = startY ?: (geometry.heightPx - geometry.insetBottom - dp(96))
    markerParams.x = (cx - markerSize / 2).coerceIn(0, geometry.widthPx - markerSize)
    markerParams.y = (cy - markerSize / 2).coerceIn(0, geometry.heightPx - markerSize)
    wm.addView(bar, barParams)
    wm.addView(marker, markerParams)
    attached = true
  }

  fun remove() {
    if (!attached) return
    attached = false
    for (v in listOf(marker, bar)) {
      try {
        wm.removeViewImmediate(v)
      } catch (_: IllegalArgumentException) {
        // Already gone.
      }
    }
  }

  private fun toggleAnchor() {
    anchor = if (anchor == TargetAnchor.SCREEN) TargetAnchor.CONTENT else TargetAnchor.SCREEN
    refreshAnchorLabel()
  }

  private fun refreshAnchorLabel() {
    anchorButton.text =
      context.getString(
        if (anchor == TargetAnchor.SCREEN) R.string.picker_anchor_screen else R.string.picker_anchor_content,
      )
  }

  private fun save() {
    val location = IntArray(2)
    marker.getLocationOnScreen(location)
    val x = location[0] + marker.width / 2
    val y = location[1] + marker.height / 2
    val chosen = anchor
    remove()
    listener.onPinned(x, y, chosen)
  }

  private fun cancel() {
    remove()
    listener.onPickerCancelled()
  }

  private fun withAlpha(color: Int, alpha: Int) = (color and 0x00FFFFFF) or (alpha shl 24)

  private inner class DragListener : View.OnTouchListener {
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var geometry: ScreenGeometry? = null

    // The marker only moves; it never forwards touches, so the target app is
    // not tapped while positioning.
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(v: View, event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX
          downY = event.rawY
          startX = markerParams.x
          startY = markerParams.y
          geometry = ScreenGeometryReader.current(context)
        }
        MotionEvent.ACTION_MOVE -> {
          val geometry = geometry ?: return true
          markerParams.x = (startX + (event.rawX - downX)).roundToInt().coerceIn(0, geometry.widthPx - markerSize)
          markerParams.y = (startY + (event.rawY - downY)).roundToInt().coerceIn(0, geometry.heightPx - markerSize)
          wm.updateViewLayout(marker, markerParams)
        }
      }
      return true
    }
  }
}
