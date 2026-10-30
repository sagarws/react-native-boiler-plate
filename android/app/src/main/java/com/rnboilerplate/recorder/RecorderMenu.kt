package com.rnboilerplate.recorder

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.rnboilerplate.R
import kotlin.math.roundToInt

/**
 * The long-press mode menu: four options in a compact card beside the
 * button, the current one highlighted. Opens with a short scale/fade from
 * the button's side; a tap outside (or Back via TalkBack) closes it. The
 * card is clamped inside the screen, clear of the status and navigation bars.
 */
class RecorderMenu(
  private val context: Context,
  private val onPick: (RecorderMode) -> Unit,
  private val onDismiss: () -> Unit,
) {
  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private var root: FrameLayout? = null

  private fun dp(v: Int) = (v * density).roundToInt()

  val showing: Boolean
    get() = root != null

  @SuppressLint("ClickableViewAccessibility")
  fun show(config: RecorderConfig, bubble: RecorderBubble) {
    if (root != null) return
    val dark = config.dark
    val surface = if (dark) Color.rgb(32, 33, 36) else Color.WHITE
    val text = if (dark) Color.WHITE else Color.rgb(32, 33, 36)
    val muted = if (dark) Color.argb(170, 255, 255, 255) else Color.argb(150, 32, 33, 36)
    val selectedBg = Color.argb(if (dark) 60 else 36, Color.red(config.accentColor), Color.green(config.accentColor), Color.blue(config.accentColor))

    val card =
      LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(8), dp(8), dp(8), dp(8))
        background = GradientDrawable().apply {
          cornerRadius = dp(20).toFloat()
          setColor(surface)
          setStroke(dp(1), Color.argb(40, 128, 128, 128))
        }
        elevation = dp(12).toFloat()
        isClickable = true
      }
    card.addView(
      TextView(context).apply {
        setText(R.string.rec_menu_title)
        setTextColor(muted)
        textSize = 12f
        setPadding(dp(12), dp(4), dp(12), dp(8))
      },
    )
    for (mode in RecorderMode.entries) {
      val selected = mode == config.mode
      val row =
        LinearLayout(context).apply {
          orientation = LinearLayout.HORIZONTAL
          gravity = Gravity.CENTER_VERTICAL
          setPadding(dp(12), dp(10), dp(14), dp(10))
          background = GradientDrawable().apply {
            cornerRadius = dp(14).toFloat()
            setColor(if (selected) selectedBg else Color.TRANSPARENT)
          }
          isClickable = true
          isFocusable = true
          contentDescription = context.getString(mode.label()) + ". " + context.getString(desc(mode)) +
            if (selected) ". " + context.getString(R.string.rec_menu_selected) else ""
          setOnClickListener { pick(mode) }
        }
      val iconBg = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(if (selected) config.accentColor else Color.argb(30, 128, 128, 128)) }
      row.addView(
        ImageView(context).apply {
          setImageResource(mode.icon())
          imageTintList = ColorStateList.valueOf(if (selected) Color.WHITE else text)
          background = iconBg
          setPadding(dp(8), dp(8), dp(8), dp(8))
          importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        },
        LinearLayout.LayoutParams(dp(38), dp(38)),
      )
      val labels = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, 0, 0) }
      labels.addView(TextView(context).apply {
        setText(mode.label())
        setTextColor(text)
        textSize = 15f
        typeface = Typeface.DEFAULT_BOLD
      })
      labels.addView(TextView(context).apply {
        setText(desc(mode))
        setTextColor(muted)
        textSize = 12f
      })
      row.addView(labels, LinearLayout.LayoutParams(dp(196), LinearLayout.LayoutParams.WRAP_CONTENT))
      card.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
    }

    val overlay =
      FrameLayout(context).apply {
        setBackgroundColor(Color.argb(40, 0, 0, 0))
        setOnTouchListener { _, e ->
          if (e.action == MotionEvent.ACTION_DOWN) dismiss()
          true
        }
      }
    card.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
    val (sw, sh) = bubble.screen()
    val w = card.measuredWidth
    val h = card.measuredHeight
    val gap = dp(10)
    val left =
      if (bubble.isOnRight) (bubble.x - w - gap).coerceAtLeast(dp(8))
      else (bubble.x + bubble.size + gap).coerceAtMost(sw - w - dp(8))
    val top = (bubble.y + bubble.size / 2 - h / 2).coerceIn(dp(48), (sh - h - dp(72)).coerceAtLeast(dp(48)))
    overlay.addView(card, FrameLayout.LayoutParams(w, h).apply { leftMargin = left; topMargin = top })

    val params =
      WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
      ).apply { gravity = Gravity.TOP or Gravity.START }
    try {
      wm.addView(overlay, params)
    } catch (_: Exception) {
      return
    }
    root = overlay
    card.pivotX = if (bubble.isOnRight) w.toFloat() else 0f
    card.pivotY = (bubble.y + bubble.size / 2 - top).toFloat().coerceIn(0f, h.toFloat())
    card.scaleX = 0.85f
    card.scaleY = 0.85f
    card.alpha = 0f
    card.animate().scaleX(1f).scaleY(1f).alpha(1f).setDuration(160).setInterpolator(DecelerateInterpolator()).start()
  }

  private fun desc(mode: RecorderMode): Int =
    when (mode) {
      RecorderMode.SCREENSHOT -> R.string.rec_mode_screenshot_desc
      RecorderMode.SCREEN -> R.string.rec_mode_screen_desc
      RecorderMode.VOICE -> R.string.rec_mode_voice_desc
      RecorderMode.SCREEN_VOICE -> R.string.rec_mode_screen_voice_desc
    }

  private fun pick(mode: RecorderMode) {
    remove()
    onPick(mode)
  }

  fun dismiss() {
    if (root == null) return
    remove()
    onDismiss()
  }

  fun remove() {
    val view = root ?: return
    root = null
    try {
      wm.removeViewImmediate(view)
    } catch (_: IllegalArgumentException) {
    }
  }
}
