package com.rnboilerplate.recorder

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.rnboilerplate.R
import kotlin.math.roundToInt

private fun Context.dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

private fun overlayParams(width: Int = WindowManager.LayoutParams.WRAP_CONTENT) =
  WindowManager.LayoutParams(
    width,
    WindowManager.LayoutParams.WRAP_CONTENT,
    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
    PixelFormat.TRANSLUCENT,
  ).apply { gravity = Gravity.TOP or Gravity.START }

private fun iconButton(context: Context, icon: Int, tint: Int, label: Int, onClick: () -> Unit) =
  ImageView(context).apply {
    setImageResource(icon)
    imageTintList = ColorStateList.valueOf(tint)
    val pad = context.dp(8)
    setPadding(pad, pad, pad, pad)
    contentDescription = context.getString(label)
    isClickable = true
    isFocusable = true
    background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(Color.argb(30, 128, 128, 128)) }
    setOnClickListener { onClick() }
  }

/**
 * Compact controls beside the button while recording: a red dot, elapsed
 * time, segment number and what is being captured, plus Pause/Resume and
 * Stop. Updated once a second from the service's own timer — nothing goes
 * through React Native.
 */
class RecordingControls(
  private val context: Context,
  private val onPauseResume: () -> Unit,
  private val onStop: () -> Unit,
) {
  private val wm = context.getSystemService(WindowManager::class.java)
  private var root: LinearLayout? = null
  private var time: TextView? = null
  private var detail: TextView? = null
  private var pause: ImageView? = null
  private var dot: ImageView? = null
  private val params = overlayParams()

  fun show(config: RecorderConfig, bubble: RecorderBubble) {
    if (root != null) return
    val dark = config.dark
    val fg = if (dark) Color.WHITE else Color.rgb(32, 33, 36)
    val muted = if (dark) Color.argb(170, 255, 255, 255) else Color.argb(150, 32, 33, 36)
    val pill =
      LinearLayout(context).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(context.dp(12), context.dp(6), context.dp(6), context.dp(6))
        background = GradientDrawable().apply {
          cornerRadius = context.dp(24).toFloat()
          setColor(if (dark) Color.rgb(32, 33, 36) else Color.WHITE)
          setStroke(context.dp(1), Color.argb(40, 128, 128, 128))
        }
        elevation = context.dp(8).toFloat()
      }
    dot = ImageView(context).apply {
      setImageResource(R.drawable.ic_rec_dot)
      imageTintList = ColorStateList.valueOf(RecorderBubble.RECORDING_RED)
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }
    pill.addView(dot, LinearLayout.LayoutParams(context.dp(14), context.dp(14)))
    val labels = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(context.dp(8), 0, context.dp(8), 0) }
    time = TextView(context).apply {
      setTextColor(fg)
      textSize = 15f
      typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
      text = "00:00"
    }
    detail = TextView(context).apply {
      setTextColor(muted)
      textSize = 11f
    }
    labels.addView(time)
    labels.addView(detail)
    pill.addView(labels)
    pause = iconButton(context, R.drawable.ic_pause, fg, R.string.rec_pause, onPauseResume)
    pill.addView(pause, LinearLayout.LayoutParams(context.dp(36), context.dp(36)).apply { marginEnd = context.dp(6) })
    pill.addView(
      iconButton(context, R.drawable.ic_rec_stop, RecorderBubble.RECORDING_RED, R.string.rec_stop, onStop),
      LinearLayout.LayoutParams(context.dp(36), context.dp(36)),
    )
    root = pill
    position(bubble)
    try {
      wm.addView(pill, params)
    } catch (_: Exception) {
      root = null
    }
  }

  /** Above the button when there's room, else below; aligned to its side. */
  fun position(bubble: RecorderBubble) {
    val view = root ?: return
    view.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
    val (sw, _) = bubble.screen()
    val w = view.measuredWidth
    val h = view.measuredHeight
    params.x = if (bubble.isOnRight) (bubble.x + bubble.size - w).coerceAtLeast(context.dp(8)) else bubble.x.coerceAtMost(sw - w - context.dp(8))
    params.y = if (bubble.y - h - context.dp(8) > context.dp(40)) bubble.y - h - context.dp(8) else bubble.y + bubble.size + context.dp(8)
    if (view.isAttachedToWindow) {
      try {
        wm.updateViewLayout(view, params)
      } catch (_: Exception) {
      }
    }
  }

  fun update(elapsedMs: Long, segment: Int, content: String, paused: Boolean) {
    time?.text = formatElapsed(elapsedMs)
    detail?.text = context.getString(R.string.rec_controls_detail, segment, content)
    pause?.setImageResource(if (paused) R.drawable.ic_play else R.drawable.ic_pause)
    pause?.contentDescription = context.getString(if (paused) R.string.rec_resume else R.string.rec_pause)
    dot?.alpha = if (paused) 0.35f else 1f
  }

  fun remove() {
    val view = root ?: return
    root = null
    try {
      wm.removeViewImmediate(view)
    } catch (_: IllegalArgumentException) {
    }
  }

  companion object {
    fun formatElapsed(ms: Long): String {
      val s = ms / 1000
      val h = s / 3600
      val m = (s % 3600) / 60
      val sec = s % 60
      return if (h > 0) "%d:%02d:%02d".format(h, m, sec) else "%02d:%02d".format(m, sec)
    }
  }
}

/**
 * The small floating preview after a screenshot: thumbnail with a countdown
 * bar and Edit / Save / Discard. It never covers the screen; it closes on
 * its own after the preview time (saving only if the user turned on
 * auto-save). Tapping the image also opens the editor.
 */
class ScreenshotPreview(
  private val context: Context,
  private val listener: Listener,
) {
  interface Listener {
    fun onPreviewEdit()

    fun onPreviewSave()

    fun onPreviewDiscard()

    fun onPreviewTimeout()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val main = Handler(Looper.getMainLooper())
  private var root: LinearLayout? = null
  private val timeout = Runnable { listener.onPreviewTimeout() }

  fun show(bitmap: Bitmap, config: RecorderConfig, bubble: RecorderBubble) {
    remove()
    val dark = config.dark
    val fg = if (dark) Color.WHITE else Color.rgb(32, 33, 36)
    val card =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(context.dp(8), context.dp(8), context.dp(8), context.dp(8))
        background = GradientDrawable().apply {
          cornerRadius = context.dp(18).toFloat()
          setColor(if (dark) Color.rgb(32, 33, 36) else Color.WHITE)
          setStroke(context.dp(1), Color.argb(40, 128, 128, 128))
        }
        elevation = context.dp(10).toFloat()
      }
    val thumbW = context.dp(132)
    val thumbH = (thumbW * bitmap.height.toFloat() / bitmap.width.coerceAtLeast(1)).roundToInt().coerceAtMost(context.dp(220))
    val scaled = Bitmap.createScaledBitmap(bitmap, thumbW, thumbH, true)
    card.addView(
      ImageView(context).apply {
        setImageBitmap(scaled)
        scaleType = ImageView.ScaleType.CENTER_CROP
        clipToOutline = true
        background = GradientDrawable().apply { cornerRadius = context.dp(10).toFloat(); setColor(Color.BLACK) }
        contentDescription = context.getString(R.string.rec_preview_image)
        isClickable = true
        setOnClickListener { listener.onPreviewEdit() }
      },
      LinearLayout.LayoutParams(thumbW, thumbH),
    )
    val bar =
      ProgressBar(context, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 1000
        progress = 1000
        progressTintList = ColorStateList.valueOf(config.accentColor)
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
      }
    card.addView(bar, LinearLayout.LayoutParams(thumbW, context.dp(4)).apply { topMargin = context.dp(6) })
    val actions = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
    val size = context.dp(38)
    fun gap() = LinearLayout.LayoutParams(size, size).apply { marginStart = context.dp(4); marginEnd = context.dp(4) }
    actions.addView(iconButton(context, R.drawable.ic_rec_pencil, fg, R.string.rec_preview_edit) { listener.onPreviewEdit() }, gap())
    actions.addView(iconButton(context, R.drawable.ic_rec_save, config.accentColor, R.string.rec_preview_save) { listener.onPreviewSave() }, gap())
    actions.addView(iconButton(context, R.drawable.ic_x, fg, R.string.rec_preview_discard) { listener.onPreviewDiscard() }, gap())
    card.addView(actions, LinearLayout.LayoutParams(thumbW, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = context.dp(6) })

    val params = overlayParams()
    card.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
    val (sw, sh) = bubble.screen()
    params.x = if (bubble.isOnRight) (bubble.x - card.measuredWidth - context.dp(10)).coerceAtLeast(context.dp(8)) else (bubble.x + bubble.size + context.dp(10)).coerceAtMost(sw - card.measuredWidth - context.dp(8))
    params.y = (bubble.y + bubble.size / 2 - card.measuredHeight / 2).coerceIn(context.dp(48), (sh - card.measuredHeight - context.dp(72)).coerceAtLeast(context.dp(48)))
    try {
      wm.addView(card, params)
    } catch (_: Exception) {
      return
    }
    root = card
    card.alpha = 0f
    card.animate().alpha(1f).setDuration(150).start()
    val ms = config.previewSeconds * 1000L
    android.animation.ObjectAnimator.ofInt(bar, "progress", 1000, 0).apply { duration = ms; start() }
    main.postDelayed(timeout, ms)
  }

  /** Stops the countdown (e.g. while the editor is open). */
  fun remove() {
    main.removeCallbacks(timeout)
    val view = root ?: return
    root = null
    try {
      wm.removeViewImmediate(view)
    } catch (_: IllegalArgumentException) {
    }
  }
}
