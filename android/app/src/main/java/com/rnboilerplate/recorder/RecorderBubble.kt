package com.rnboilerplate.recorder

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import com.rnboilerplate.R
import kotlin.math.hypot
import kotlin.math.roundToInt

/** The mode's glyph, shared by the bubble, menu and notification. */
fun RecorderMode.icon(): Int =
  when (this) {
    RecorderMode.SCREENSHOT -> R.drawable.ic_rec_camera
    RecorderMode.SCREEN -> R.drawable.ic_rec_video
    RecorderMode.VOICE -> R.drawable.ic_rec_mic
    RecorderMode.SCREEN_VOICE -> R.drawable.ic_rec_screen_voice
  }

fun RecorderMode.label(): Int =
  when (this) {
    RecorderMode.SCREENSHOT -> R.string.rec_mode_screenshot
    RecorderMode.SCREEN -> R.string.rec_mode_screen
    RecorderMode.VOICE -> R.string.rec_mode_voice
    RecorderMode.SCREEN_VOICE -> R.string.rec_mode_screen_voice
  }

/**
 * The recording button drawn over other apps — its own window, separate
 * from the OCR button. Not focusable; the window is exactly the circle.
 * Tap runs the selected mode, long-press opens the mode menu, drag moves it
 * (snapping to the nearest side; side + height ratio persisted). A drag or
 * a long-press never also fires a tap.
 */
class RecorderBubble(
  private val context: Context,
  private val prefs: RecorderPrefs,
  private val listener: Listener,
) {
  interface Listener {
    fun onBubbleTap()

    fun onBubbleLongPress()

    fun onBubbleMoved()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private val main = Handler(Looper.getMainLooper())
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val edgeMargin = (8 * density).roundToInt()
  private val sizePx = (52 * density).roundToInt()

  private val circle = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val ring = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val icon =
    ImageView(context).apply {
      scaleType = ImageView.ScaleType.FIT_CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
  private val ringView = View(context).apply { background = ring; alpha = 0f }
  private val root =
    FrameLayout(context).apply {
      isClickable = true
      setOnClickListener { listener.onBubbleTap() }
      setOnLongClickListener {
        listener.onBubbleLongPress()
        true
      }
    }

  private val params =
    WindowManager.LayoutParams(
        sizePx,
        sizePx,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      )
      .apply { gravity = Gravity.TOP or Gravity.START }

  private var attached = false
  private var config = RecorderConfig()
  private var active = false
  private var snap: ValueAnimator? = null
  private var pulse: ValueAnimator? = null

  init {
    val fill = FrameLayout.LayoutParams.MATCH_PARENT
    val inset = (sizePx * 0.27f).roundToInt()
    val face = FrameLayout(context).apply { background = circle; setPadding(inset, inset, inset, inset) }
    face.addView(icon, FrameLayout.LayoutParams(fill, fill))
    root.addView(ringView, FrameLayout.LayoutParams(fill, fill))
    root.addView(face, FrameLayout.LayoutParams(fill, fill))
    root.setOnTouchListener(Drag())
  }

  val x: Int
    get() = params.x

  val y: Int
    get() = params.y

  val size: Int
    get() = sizePx

  val isOnRight: Boolean
    get() = params.x + sizePx / 2 > screen().first / 2

  fun show(initial: RecorderConfig) {
    if (attached) return
    apply(initial)
    place()
    wm.addView(root, params)
    attached = true
  }

  fun remove() {
    snap?.cancel()
    pulse?.cancel()
    main.removeCallbacksAndMessages(null)
    if (!attached) return
    attached = false
    try {
      wm.removeViewImmediate(root)
    } catch (_: IllegalArgumentException) {
    }
  }

  fun apply(next: RecorderConfig) {
    config = next
    render()
  }

  /** Recording: red face with a stop glyph and a slow pulse ring. */
  fun setActive(isActive: Boolean, paused: Boolean = false) {
    active = isActive
    render()
    pulse?.cancel()
    if (isActive && !paused) {
      pulse =
        ValueAnimator.ofFloat(0.15f, 0.7f).apply {
          duration = 900
          repeatMode = ValueAnimator.REVERSE
          repeatCount = ValueAnimator.INFINITE
          addUpdateListener { ringView.alpha = it.animatedValue as Float }
          start()
        }
    } else {
      ringView.alpha = 0f
    }
  }

  /** Keeps the display awake while recording (only if the user turned it on). */
  fun setKeepScreenOn(on: Boolean) {
    params.flags =
      if (on) params.flags or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
      else params.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON.inv()
    if (attached) wm.updateViewLayout(root, params)
  }

  fun setHidden(hidden: Boolean) {
    root.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
  }

  private fun render() {
    val surface = if (config.dark) Color.rgb(32, 33, 36) else Color.WHITE
    val fg = if (config.dark) Color.WHITE else Color.rgb(32, 33, 36)
    if (active) {
      circle.setColor(RECORDING_RED)
      circle.setStroke((2 * density).roundToInt(), Color.WHITE)
      icon.setImageResource(R.drawable.ic_rec_stop)
      icon.imageTintList = ColorStateList.valueOf(Color.WHITE)
      root.contentDescription = context.getString(R.string.rec_bubble_stop)
    } else {
      circle.setColor(surface)
      circle.setStroke((2 * density).roundToInt(), config.accentColor)
      icon.setImageResource(config.mode.icon())
      icon.imageTintList = ColorStateList.valueOf(if (config.mode == RecorderMode.SCREENSHOT) fg else config.accentColor)
      root.contentDescription =
        context.getString(R.string.rec_bubble_description, context.getString(config.mode.label()))
    }
    ring.setColor(Color.TRANSPARENT)
    ring.setStroke((4 * density).roundToInt(), RECORDING_RED)
    root.alpha = if (active) 1f else 0.94f
  }

  fun screen(): Pair<Int, Int> {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val b = wm.currentWindowMetrics.bounds
      return b.width() to b.height()
    }
    val dm = DisplayMetrics()
    @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
    return dm.widthPixels to dm.heightPixels
  }

  private fun maxX() = (screen().first - sizePx - edgeMargin).coerceAtLeast(edgeMargin)

  // Keep clear of the status bar and gesture/navigation area.
  private fun minY() = (48 * density).roundToInt()

  private fun maxY() = (screen().second - sizePx - (72 * density).roundToInt()).coerceAtLeast(minY())

  private fun place() {
    val p = prefs.readPosition()
    params.x = if (p.onRight) maxX() else edgeMargin
    params.y = (minY() + p.yRatio * (maxY() - minY())).roundToInt()
  }

  fun resetPosition() {
    prefs.resetPosition()
    onScreenChanged()
  }

  fun onScreenChanged() {
    if (!attached) return
    snap?.cancel()
    place()
    wm.updateViewLayout(root, params)
    listener.onBubbleMoved()
  }

  private fun snapToEdge() {
    val onRight = isOnRight
    params.y = params.y.coerceIn(minY(), maxY())
    val span = (maxY() - minY()).coerceAtLeast(1)
    prefs.writePosition(RecorderBubblePosition(onRight, (params.y - minY()).toFloat() / span))
    val target = if (onRight) maxX() else edgeMargin
    snap?.cancel()
    snap =
      ValueAnimator.ofInt(params.x, target).apply {
        duration = 180
        interpolator = DecelerateInterpolator()
        addUpdateListener {
          if (!attached) return@addUpdateListener
          params.x = it.animatedValue as Int
          wm.updateViewLayout(root, params)
        }
        addListener(object : android.animation.AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: android.animation.Animator) = listener.onBubbleMoved()
        })
        start()
      }
  }

  private inner class Drag : View.OnTouchListener {
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var longPressed = false
    private val longPress = Runnable {
      longPressed = true
      root.performHapticFeedback(android.view.HapticFeedbackConstants.LONG_PRESS)
      root.performLongClick()
    }

    // Raw touches drive drag/tap/long-press; the click listeners stay for TalkBack.
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(view: View, e: MotionEvent): Boolean {
      when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          snap?.cancel()
          downX = e.rawX
          downY = e.rawY
          startX = params.x
          startY = params.y
          dragging = false
          longPressed = false
          main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = e.rawX - downX
          val dy = e.rawY - downY
          if (!dragging && !longPressed && hypot(dx, dy) > touchSlop) {
            dragging = true
            main.removeCallbacks(longPress)
          }
          if (dragging) {
            params.x = (startX + dx).roundToInt().coerceIn(edgeMargin, maxX())
            params.y = (startY + dy).roundToInt().coerceIn(minY(), maxY())
            wm.updateViewLayout(root, params)
            listener.onBubbleMoved()
          }
        }
        MotionEvent.ACTION_UP -> {
          main.removeCallbacks(longPress)
          when {
            dragging -> snapToEdge()
            !longPressed -> listener.onBubbleTap()
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(longPress)
          if (dragging) snapToEdge()
        }
      }
      return true
    }
  }

  companion object {
    val RECORDING_RED = Color.rgb(229, 72, 77)
  }
}
