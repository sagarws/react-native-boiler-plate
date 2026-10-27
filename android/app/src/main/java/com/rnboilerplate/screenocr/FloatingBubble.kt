package com.rnboilerplate.screenocr

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
import android.widget.ProgressBar
import com.rnboilerplate.R
import kotlin.math.hypot
import kotlin.math.roundToInt

/**
 * The draggable capture button drawn over other apps.
 *
 * Its window is exactly the size of the circle and not focusable, so it never
 * takes keyboard focus or touches outside its own bounds. Dragging snaps it to
 * the nearest side edge; the side and vertical ratio are persisted, which
 * keeps the position sensible across rotation and restarts.
 */
class FloatingBubble(
  private val context: Context,
  private val prefs: OcrPrefs,
  private val listener: Listener,
) {
  interface Listener {
    fun onBubbleTap()

    fun onBubbleLongPress()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private val main = Handler(Looper.getMainLooper())
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val edgeMargin = (8 * density).roundToInt()

  private val circle = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val icon =
    ImageView(context).apply {
      setImageResource(R.drawable.ic_scan_text)
      scaleType = ImageView.ScaleType.FIT_CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
  private val spinner =
    ProgressBar(context).apply {
      isIndeterminate = true
      visibility = View.GONE
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
  private val badgeCircle = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val badge =
    ImageView(context).apply {
      background = badgeCircle
      scaleType = ImageView.ScaleType.FIT_CENTER
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
  private val face = FrameLayout(context).apply { background = circle }
  private val root =
    FrameLayout(context).apply {
      contentDescription = context.getString(R.string.screen_ocr_bubble_description)
      isClickable = true
      // TalkBack activates the button through a click, not raw touches.
      setOnClickListener { listener.onBubbleTap() }
      setOnLongClickListener {
        listener.onBubbleLongPress()
        true
      }
    }

  private val params =
    WindowManager.LayoutParams(
        0,
        0,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
          WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      )
      .apply { gravity = Gravity.TOP or Gravity.START }

  private var config = OcrConfig()
  private var attached = false
  private var processing = false
  private var reading = false
  private var snapAnimator: ValueAnimator? = null

  private val sizePx: Int
    get() = (config.bubbleSizeDp * density).roundToInt()

  init {
    val fill = FrameLayout.LayoutParams.MATCH_PARENT
    face.addView(icon, FrameLayout.LayoutParams(fill, fill))
    face.addView(spinner, FrameLayout.LayoutParams(fill, fill))
    root.addView(face, FrameLayout.LayoutParams(fill, fill))
    root.addView(badge)
    root.setOnTouchListener(DragTouchListener())
  }

  /** Adds the window. Throws if overlay permission was revoked. */
  fun show(initial: OcrConfig) {
    if (attached) return
    applyConfig(initial)
    placeFromPrefs()
    wm.addView(root, params)
    attached = true
  }

  fun remove() {
    snapAnimator?.cancel()
    main.removeCallbacksAndMessages(null)
    if (!attached) return
    attached = false
    try {
      wm.removeViewImmediate(root)
    } catch (_: IllegalArgumentException) {
      // Already detached by the system (permission revoked).
    }
  }

  fun applyConfig(next: OcrConfig) {
    config = next
    circle.setColor(next.bubbleColor)
    circle.setStroke((1.5f * density).roundToInt(), Color.argb(70, 255, 255, 255))
    icon.imageTintList = ColorStateList.valueOf(next.bubbleIconColor)
    spinner.indeterminateTintList = ColorStateList.valueOf(next.bubbleIconColor)
    val inset = (sizePx * 0.24f).roundToInt()
    face.setPadding(inset, inset, inset, inset)
    // Action badge: which of Copy / Speak / Speak + auto-scroll a tap runs.
    val badgeSize = (sizePx * 0.4f).roundToInt()
    badge.layoutParams =
      FrameLayout.LayoutParams(badgeSize, badgeSize, Gravity.BOTTOM or Gravity.END)
    val badgePad = (badgeSize * 0.2f).roundToInt()
    badge.setPadding(badgePad, badgePad, badgePad, badgePad)
    badgeCircle.setColor(next.panelColor)
    badgeCircle.setStroke((1f * density).roundToInt(), next.bubbleColor)
    badge.imageTintList = ColorStateList.valueOf(next.bubbleColor)
    badge.setImageResource(
      when (next.action) {
        FloatingAction.COPY -> R.drawable.ic_copy
        FloatingAction.SPEAK -> R.drawable.ic_volume_2
        FloatingAction.SPEAK_SCROLL -> R.drawable.ic_scroll_text
        FloatingAction.SPEAK_PAGINATION -> R.drawable.ic_book_open
        FloatingAction.SPEAK_TRANSLATE -> R.drawable.ic_languages
      },
    )
    params.width = sizePx
    params.height = sizePx
    refreshAlpha()
    if (attached) {
      clampIntoScreen()
      wm.updateViewLayout(root, params)
    }
  }

  /** Hides the bubble while a frame is captured, so it is not in the screenshot. */
  fun setHiddenForCapture(hidden: Boolean) {
    root.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
  }

  /** Reading aloud: the face shows a speaker instead of the scan glyph. */
  fun setReading(isReading: Boolean) {
    reading = isReading
    icon.setImageResource(if (isReading) R.drawable.ic_volume_2 else R.drawable.ic_scan_text)
    refreshAlpha()
  }

  fun setProcessing(isProcessing: Boolean) {
    processing = isProcessing
    icon.visibility = if (isProcessing) View.INVISIBLE else View.VISIBLE
    spinner.visibility = if (isProcessing) View.VISIBLE else View.GONE
    refreshAlpha()
  }

  fun resetPosition() {
    prefs.resetPosition()
    if (!attached) return
    placeFromPrefs()
    wm.updateViewLayout(root, params)
  }

  /** Rotation or display change: re-place from the stored side and ratio. */
  fun onScreenChanged() {
    if (!attached) return
    snapAnimator?.cancel()
    placeFromPrefs()
    wm.updateViewLayout(root, params)
  }

  private fun refreshAlpha() {
    root.alpha = if (processing || reading) 1f else config.bubbleOpacity
  }

  private data class Size(val width: Int, val height: Int)

  private fun screen(): Size {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      val bounds = wm.currentWindowMetrics.bounds
      return Size(bounds.width(), bounds.height())
    }
    val dm = DisplayMetrics()
    @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
    return Size(dm.widthPixels, dm.heightPixels)
  }

  private fun maxX() = (screen().width - sizePx - edgeMargin).coerceAtLeast(edgeMargin)

  private fun maxY() = (screen().height - sizePx - edgeMargin).coerceAtLeast(edgeMargin)

  private fun placeFromPrefs() {
    val position = prefs.readPosition()
    params.x = if (position.onRight) maxX() else edgeMargin
    params.y = (edgeMargin + position.yRatio * (maxY() - edgeMargin)).roundToInt()
  }

  private fun clampIntoScreen() {
    params.x = params.x.coerceIn(edgeMargin, maxX())
    params.y = params.y.coerceIn(edgeMargin, maxY())
  }

  private fun snapToEdge() {
    val screenWidth = screen().width
    val onRight = params.x + sizePx / 2 > screenWidth / 2
    val targetX = if (onRight) maxX() else edgeMargin
    clampIntoScreen()
    val span = (maxY() - edgeMargin).coerceAtLeast(1)
    prefs.writePosition(BubblePosition(onRight, (params.y - edgeMargin).toFloat() / span))

    snapAnimator?.cancel()
    snapAnimator =
      ValueAnimator.ofInt(params.x, targetX).apply {
        duration = 180
        interpolator = DecelerateInterpolator()
        addUpdateListener {
          if (!attached) return@addUpdateListener
          params.x = it.animatedValue as Int
          wm.updateViewLayout(root, params)
        }
        start()
      }
  }

  private inner class DragTouchListener : View.OnTouchListener {
    private var downX = 0f
    private var downY = 0f
    private var startX = 0
    private var startY = 0
    private var dragging = false
    private var longPressed = false
    private val longPress = Runnable {
      longPressed = true
      root.performLongClick()
    }

    // Raw touches drive drag/tap/long-press; the click listeners above stay
    // in place for accessibility services.
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouch(view: View, event: MotionEvent): Boolean {
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          snapAnimator?.cancel()
          downX = event.rawX
          downY = event.rawY
          startX = params.x
          startY = params.y
          dragging = false
          longPressed = false
          main.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
        }
        MotionEvent.ACTION_MOVE -> {
          val dx = event.rawX - downX
          val dy = event.rawY - downY
          if (!dragging && hypot(dx, dy) > touchSlop) {
            dragging = true
            main.removeCallbacks(longPress)
            root.alpha = 1f
          }
          if (dragging) {
            params.x = (startX + dx).roundToInt()
            params.y = (startY + dy).roundToInt()
            clampIntoScreen()
            wm.updateViewLayout(root, params)
          }
        }
        MotionEvent.ACTION_UP -> {
          main.removeCallbacks(longPress)
          if (dragging) {
            refreshAlpha()
            snapToEdge()
          } else if (!longPressed) {
            listener.onBubbleTap()
          }
        }
        MotionEvent.ACTION_CANCEL -> {
          main.removeCallbacks(longPress)
          if (dragging) {
            refreshAlpha()
            snapToEdge()
          }
        }
      }
      return true
    }
  }
}
