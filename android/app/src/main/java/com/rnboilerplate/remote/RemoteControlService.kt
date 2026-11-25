package com.rnboilerplate.remote

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.lang.ref.WeakReference
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min

/**
 * Remote Access: performs the taps, swipes, scrolls, navigation buttons and
 * typing that a controlling device sends, while a session the user allowed is
 * running. Android allows another app to be operated only through an
 * accessibility service the user turns on in system settings — this app never
 * enables it, and the JS layer only calls it for an active full-control
 * session (the same rule the desktop host enforces).
 *
 * It reads no screen content except the focused text field (to insert typed
 * text at the cursor) and keeps nothing.
 *
 * Pointer input is collected from "down" to "up" and dispatched as one gesture
 * with the real path and duration, so a tap is a tap, a hold is a long press
 * and a drag is a swipe — Android cancels a gesture that is replaced while it
 * runs, so live streaming of moves would break drags.
 */
class RemoteControlService : AccessibilityService() {
  private val main = Handler(Looper.getMainLooper())
  private var points = ArrayList<FloatArray>()
  private var downAt = 0L
  private var scrollX = 0f
  private var scrollY = 0f
  private var scrollAt = floatArrayOf(0.5f, 0.5f)
  private var scrollPending = false

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = WeakReference(this)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (instance?.get() === this) instance = null
    super.onDestroy()
  }

  private fun screen(): Pair<Int, Int> {
    val metrics = resources.displayMetrics
    @Suppress("DEPRECATION")
    val wm = getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.currentWindowMetrics.bounds
      b.width() to b.height()
    } else {
      val real = android.util.DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(real)
      (if (real.widthPixels > 0) real.widthPixels else metrics.widthPixels) to
        (if (real.heightPixels > 0) real.heightPixels else metrics.heightPixels)
    }
  }

  private fun toScreen(x: Double, y: Double): FloatArray {
    val (w, h) = screen()
    return floatArrayOf(
      (x.coerceIn(0.0, 1.0) * (w - 1)).toFloat(),
      (y.coerceIn(0.0, 1.0) * (h - 1)).toFloat(),
    )
  }

  fun pointer(action: String, x: Double, y: Double, button: Int) {
    main.post {
      when (action) {
        "down" -> {
          if (button == 2) {
            // Right click = Back, as in most remote tools for Android.
            performGlobalAction(GLOBAL_ACTION_BACK)
            points.clear()
            return@post
          }
          if (button == 1) {
            performGlobalAction(GLOBAL_ACTION_HOME)
            points.clear()
            return@post
          }
          points = arrayListOf(toScreen(x, y))
          downAt = SystemClock.uptimeMillis()
        }
        "move" -> {
          if (points.isEmpty()) return@post
          val p = toScreen(x, y)
          val last = points.last()
          if (hypot(p[0] - last[0], p[1] - last[1]) >= 2f && points.size < MAX_POINTS) points.add(p)
        }
        "up" -> {
          if (points.isEmpty()) return@post
          points.add(toScreen(x, y))
          val duration = (SystemClock.uptimeMillis() - downAt).coerceIn(MIN_GESTURE_MS, MAX_GESTURE_MS)
          dispatch(points, duration)
          points = ArrayList()
        }
        else -> points = ArrayList()
      }
    }
  }

  private fun dispatch(path: List<FloatArray>, durationMs: Long) {
    val first = path.first()
    val moved = path.any { hypot(it[0] - first[0], it[1] - first[1]) > TAP_SLOP_PX }
    val p = Path().apply {
      moveTo(first[0], first[1])
      if (moved) for (i in 1 until path.size) lineTo(path[i][0], path[i][1])
    }
    val stroke = GestureDescription.StrokeDescription(p, 0, durationMs)
    runCatching { dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null) }
  }

  /** Wheel events arrive in bursts; they are added up and played as one swipe. */
  fun scroll(x: Double, y: Double, dx: Double, dy: Double) {
    main.post {
      scrollX += dx.toFloat()
      scrollY += dy.toFloat()
      scrollAt = floatArrayOf(x.toFloat(), y.toFloat())
      if (scrollPending) return@post
      scrollPending = true
      main.postDelayed({ flushScroll() }, SCROLL_BATCH_MS)
    }
  }

  private fun flushScroll() {
    scrollPending = false
    val (w, h) = screen()
    val start = toScreen(scrollAt[0].toDouble(), scrollAt[1].toDouble())
    // Content scrolls down (dy > 0) when the finger moves up.
    val distY = (-scrollY * SCROLL_FACTOR).coerceIn(-h * 0.45f, h * 0.45f)
    val distX = (-scrollX * SCROLL_FACTOR).coerceIn(-w * 0.45f, w * 0.45f)
    scrollX = 0f
    scrollY = 0f
    if (abs(distX) < 4f && abs(distY) < 4f) return
    val fromX = start[0].coerceIn(w * 0.05f, w * 0.95f)
    val fromY = start[1].coerceIn(h * 0.1f, h * 0.9f)
    val toX = (fromX + distX).coerceIn(1f, w - 2f)
    val toY = (fromY + distY).coerceIn(1f, h - 2f)
    val path = Path().apply {
      moveTo(fromX, fromY)
      lineTo(toX, toY)
    }
    val stroke = GestureDescription.StrokeDescription(path, 0, SCROLL_SWIPE_MS)
    runCatching { dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null) }
  }

  fun global(name: String): Boolean {
    val action = when (name) {
      "back" -> GLOBAL_ACTION_BACK
      "home" -> GLOBAL_ACTION_HOME
      "recents" -> GLOBAL_ACTION_RECENTS
      "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
      "quickSettings" -> GLOBAL_ACTION_QUICK_SETTINGS
      "power" -> GLOBAL_ACTION_POWER_DIALOG
      "lock" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_LOCK_SCREEN else return false
      "screenshot" -> if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) GLOBAL_ACTION_TAKE_SCREENSHOT else return false
      else -> return false
    }
    return performGlobalAction(action)
  }

  private fun focusedField(): AccessibilityNodeInfo? =
    rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }

  /** The field's real text (not its hint) and selection. */
  private fun state(node: AccessibilityNodeInfo): Triple<String, Int, Int> {
    val showingHint = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && node.isShowingHintText
    val text = if (showingHint) "" else node.text?.toString().orEmpty()
    var start = node.textSelectionStart
    var end = node.textSelectionEnd
    if (start < 0 || start > text.length) start = text.length
    if (end < 0 || end > text.length) end = start
    return Triple(text, min(start, end), max(start, end))
  }

  private fun setText(node: AccessibilityNodeInfo, text: String, cursor: Int): Boolean {
    val ok = node.performAction(
      AccessibilityNodeInfo.ACTION_SET_TEXT,
      Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) },
    )
    select(node, cursor, cursor)
    return ok
  }

  private fun select(node: AccessibilityNodeInfo, start: Int, end: Int) {
    node.performAction(
      AccessibilityNodeInfo.ACTION_SET_SELECTION,
      Bundle().apply {
        putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, start)
        putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, end)
      },
    )
  }

  fun typeText(input: String): Boolean {
    val node = focusedField() ?: return false
    val (text, start, end) = state(node)
    return setText(node, text.substring(0, start) + input + text.substring(end), start + input.length)
  }

  fun edit(name: String): Boolean {
    if (name == "enter" && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val node = focusedField()
      if (node != null) {
        val ime = AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id
        if (node.performAction(ime)) return true
      }
    }
    val node = focusedField() ?: return false
    val (text, start, end) = state(node)
    return when (name) {
      "backspace" ->
        if (start != end) setText(node, text.removeRange(start, end), start)
        else if (start > 0) setText(node, text.removeRange(start - 1, start), start - 1)
        else true
      "delete" ->
        if (start != end) setText(node, text.removeRange(start, end), start)
        else if (start < text.length) setText(node, text.removeRange(start, start + 1), start)
        else true
      "enter" -> if (node.isMultiLine) typeText("\n") else false
      "selectAll" -> {
        select(node, 0, text.length)
        true
      }
      "copy" -> node.performAction(AccessibilityNodeInfo.ACTION_COPY)
      "paste" -> node.performAction(AccessibilityNodeInfo.ACTION_PASTE)
      "cut" -> node.performAction(AccessibilityNodeInfo.ACTION_CUT)
      "left" -> {
        val c = if (start != end) start else max(0, start - 1)
        select(node, c, c)
        true
      }
      "right" -> {
        val c = if (start != end) end else min(text.length, end + 1)
        select(node, c, c)
        true
      }
      "home" -> {
        select(node, 0, 0)
        true
      }
      "end" -> {
        select(node, text.length, text.length)
        true
      }
      else -> false
    }
  }

  companion object {
    private const val MAX_POINTS = 400
    private const val MIN_GESTURE_MS = 40L
    private const val MAX_GESTURE_MS = 10_000L
    private const val TAP_SLOP_PX = 12f
    private const val SCROLL_BATCH_MS = 120L
    private const val SCROLL_SWIPE_MS = 180L
    private const val SCROLL_FACTOR = 1.2f

    @Volatile private var instance: WeakReference<RemoteControlService>? = null

    fun current(): RemoteControlService? = instance?.get()

    fun isEnabled(context: Context): Boolean {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
      ) ?: return false
      val me = ComponentName(context, RemoteControlService::class.java)
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }
}
