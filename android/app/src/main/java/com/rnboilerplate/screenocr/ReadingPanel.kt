package com.rnboilerplate.screenocr

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import com.rnboilerplate.R
import kotlin.math.roundToInt

/**
 * Compact playback controller shown at the bottom of the screen while a
 * read-aloud session runs: status, Play/Pause, Restart section, Next (or
 * Continue after a manual scroll), Copy, Stop.
 *
 * Its own small, non-focusable window, so it never takes keyboard focus or
 * touches outside itself. Colours come from the theme pushed by JS.
 */
class ReadingPanel(private val context: Context, private val listener: Listener) {
  interface Listener {
    fun onPanelPlayPause()

    fun onPanelRestart()

    fun onPanelNext()

    fun onPanelCopy()

    fun onPanelStop()

    fun onPanelRecalibrate()
  }

  private val wm = context.getSystemService(WindowManager::class.java)
  private val density = context.resources.displayMetrics.density
  private fun dp(value: Int) = (value * density).roundToInt()

  private val background = GradientDrawable().apply { cornerRadius = dp(28).toFloat() }
  private val playBackground = GradientDrawable().apply { shape = GradientDrawable.OVAL }
  private val modeIcon = icon(R.drawable.ic_volume_2, null)
  private val title = label(14f)
  private val status = label(12f)
  private val playPause = button(R.drawable.ic_pause, R.string.reading_pause) { listener.onPanelPlayPause() }
  private val restart = button(R.drawable.ic_rotate_ccw, R.string.reading_restart) { listener.onPanelRestart() }
  private val next = button(R.drawable.ic_skip_forward, R.string.reading_next) { listener.onPanelNext() }
  private val copy = button(R.drawable.ic_copy, R.string.reading_copy) { listener.onPanelCopy() }
  private val stop = button(R.drawable.ic_square, R.string.reading_stop) { listener.onPanelStop() }
  private val recalibrate =
    button(R.drawable.ic_crosshair, R.string.pagination_recalibrate) { listener.onPanelRecalibrate() }

  private val root =
    LinearLayout(context).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(14), dp(6), dp(6), dp(6))
      background = this@ReadingPanel.background
      elevation = dp(6).toFloat()
      val texts =
        LinearLayout(context).apply {
          orientation = LinearLayout.VERTICAL
          addView(title)
          addView(status)
        }
      addView(modeIcon, LinearLayout.LayoutParams(dp(20), dp(20)).apply { marginEnd = dp(8) })
      addView(texts, LinearLayout.LayoutParams(dp(112), LinearLayout.LayoutParams.WRAP_CONTENT))
      for (b in listOf(playPause, restart, next, recalibrate, copy, stop)) {
        addView(b, LinearLayout.LayoutParams(dp(44), dp(44)).apply { marginStart = dp(2) })
      }
      playPause.background = playBackground
    }

  private val params =
    WindowManager.LayoutParams(
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.WRAP_CONTENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.TRANSLUCENT,
      )
      .apply {
        gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
        y = dp(72)
      }

  private var attached = false

  private fun label(sizeSp: Float) =
    TextView(context).apply {
      setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
      maxLines = 1
      ellipsize = TextUtils.TruncateAt.END
    }

  private fun icon(res: Int, description: Int?) =
    android.widget.ImageView(context).apply {
      setImageResource(res)
      importantForAccessibility =
        if (description == null) View.IMPORTANT_FOR_ACCESSIBILITY_NO else View.IMPORTANT_FOR_ACCESSIBILITY_YES
    }

  private fun button(res: Int, description: Int, onClick: () -> Unit) =
    ImageButton(context).apply {
      setImageResource(res)
      contentDescription = context.getString(description)
      setBackgroundColor(Color.TRANSPARENT)
      scaleType = android.widget.ImageView.ScaleType.CENTER
      setPadding(dp(10), dp(10), dp(10), dp(10))
      setOnClickListener { onClick() }
    }

  fun applyConfig(config: OcrConfig) {
    background.setColor(config.panelColor)
    playBackground.setColor(config.bubbleColor)
    val text = ColorStateList.valueOf(config.panelTextColor)
    title.setTextColor(config.panelTextColor)
    status.setTextColor(config.panelTextColor)
    status.alpha = 0.75f
    modeIcon.imageTintList = ColorStateList.valueOf(config.bubbleColor)
    for (b in listOf(restart, next, recalibrate, copy, stop)) b.imageTintList = text
    playPause.imageTintList = ColorStateList.valueOf(config.bubbleIconColor)
    modeIcon.setImageResource(
      when (config.action) {
        FloatingAction.SPEAK_SCROLL -> R.drawable.ic_scroll_text
        FloatingAction.SPEAK_PAGINATION -> R.drawable.ic_book_open
        FloatingAction.SPEAK_TRANSLATE -> R.drawable.ic_languages
        else -> R.drawable.ic_volume_2
      },
    )
    val pagination = config.action == FloatingAction.SPEAK_PAGINATION
    next.visibility =
      if (config.action == FloatingAction.SPEAK_SCROLL || pagination) View.VISIBLE else View.GONE
    recalibrate.visibility = if (pagination) View.VISIBLE else View.GONE
    // Keep the bar compact: in pagination mode Copy makes way for Recalibrate.
    copy.visibility = if (pagination) View.GONE else View.VISIBLE
  }

  fun show(config: OcrConfig) {
    applyConfig(config)
    if (attached) return
    wm.addView(root, params)
    attached = true
  }

  fun remove() {
    if (!attached) return
    attached = false
    try {
      wm.removeViewImmediate(root)
    } catch (_: IllegalArgumentException) {
      // Already gone (overlay permission revoked).
    }
  }

  /** Hidden while a screenshot is taken so it is not read as text. */
  fun setHiddenForCapture(hidden: Boolean) {
    root.visibility = if (hidden) View.INVISIBLE else View.VISIBLE
  }

  /** Status and controls for a Speak-with-translation session. */
  fun updateTranslate(state: TranslateState, info: TranslateInfo, target: String) {
    val res = context.resources
    title.text = context.getString(R.string.reading_mode_translate, TranslationPrompt.languageName(target))
    status.text =
      when (state) {
        TranslateState.CAPTURING -> context.getString(R.string.reading_status_capturing)
        TranslateState.RUNNING_OCR -> context.getString(R.string.reading_status_ocr)
        TranslateState.TRANSLATING -> context.getString(R.string.translate_status_translating)
        TranslateState.SPEAKING ->
          if (info.detectedLanguage.isNotEmpty()) {
            context.getString(R.string.translate_status_from, TranslationPrompt.languageName(info.detectedLanguage))
          } else {
            context.getString(R.string.reading_status_speaking)
          }
        TranslateState.PAUSED -> context.getString(R.string.reading_status_paused)
        TranslateState.COMPLETE -> context.getString(R.string.reading_status_complete)
        TranslateState.STOPPED -> context.getString(R.string.reading_status_stopped)
        TranslateState.ERROR, TranslateState.IDLE ->
          context.getString(info.error?.let { translateErrorText(it) } ?: R.string.reading_status_error)
      }
    val paused = state == TranslateState.PAUSED
    playPause.setImageResource(if (paused) R.drawable.ic_play else R.drawable.ic_pause)
    playPause.contentDescription = res.getString(if (paused) R.string.reading_resume else R.string.reading_pause)
    setEnabled(playPause, state == TranslateState.SPEAKING || paused)
    setEnabled(restart, state == TranslateState.SPEAKING || paused || state == TranslateState.COMPLETE)
    setEnabled(copy, state == TranslateState.SPEAKING || paused || state == TranslateState.COMPLETE)
  }

  fun translateErrorText(error: TranslateError): Int =
    when (error) {
      TranslateError.NO_KEY -> R.string.translate_error_no_key
      TranslateError.NO_CONSENT -> R.string.translate_error_no_consent
      TranslateError.NO_INTERNET -> R.string.translate_error_no_internet
      TranslateError.INVALID_KEY -> R.string.translate_error_invalid_key
      TranslateError.API_DISABLED -> R.string.translate_error_api_disabled
      TranslateError.QUOTA -> R.string.translate_error_quota
      TranslateError.SAFETY_BLOCKED -> R.string.translate_error_safety
      TranslateError.SERVER -> R.string.translate_error_server
      TranslateError.TIMEOUT -> R.string.translate_error_timeout
      TranslateError.BAD_RESPONSE -> R.string.translate_error_bad_response
      TranslateError.CANCELLED -> R.string.reading_status_stopped
    }

  /** Status and controls for a Speak-with-pagination session. */
  fun updatePagination(state: PaginationState, info: PaginationInfo) {
    val res = context.resources
    title.text = context.getString(R.string.reading_mode_pagination)
    status.text =
      when (state) {
        PaginationState.CAPTURING_SCREEN -> context.getString(R.string.reading_status_capturing)
        PaginationState.RUNNING_OCR -> context.getString(R.string.reading_status_ocr)
        PaginationState.SPEAKING_PAGE -> context.getString(R.string.pagination_status_page, info.page)
        PaginationState.PAUSED -> context.getString(R.string.reading_status_paused)
        PaginationState.CLICKING_NEXT_PAGE -> context.getString(R.string.pagination_status_clicking)
        PaginationState.WAITING_FOR_PAGE_CHANGE,
        PaginationState.VERIFYING_PAGE_CHANGE -> context.getString(R.string.pagination_status_waiting)
        PaginationState.NEEDS_ATTENTION -> context.getString(issueText(info.issue))
        PaginationState.COMPLETED -> context.getString(R.string.reading_status_complete)
        PaginationState.STOPPED -> context.getString(R.string.reading_status_stopped)
        PaginationState.ERROR, PaginationState.IDLE -> context.getString(issueText(info.issue))
      }
    val paused = state == PaginationState.PAUSED
    playPause.setImageResource(if (paused) R.drawable.ic_play else R.drawable.ic_pause)
    playPause.contentDescription = res.getString(if (paused) R.string.reading_resume else R.string.reading_pause)
    setEnabled(playPause, state == PaginationState.SPEAKING_PAGE || paused)
    // Next: skip to the next page while reading; "Retry once" / "Skip page" when stuck.
    val attention = state == PaginationState.NEEDS_ATTENTION
    val canAct = attention && (info.canRetry || info.issue == PaginationIssue.EMPTY_PAGE)
    next.setImageResource(if (attention) R.drawable.ic_rotate_ccw else R.drawable.ic_skip_forward)
    next.contentDescription =
      res.getString(
        when {
          attention && info.issue == PaginationIssue.EMPTY_PAGE -> R.string.pagination_skip_page
          attention -> R.string.pagination_retry_once
          else -> R.string.pagination_next_now
        },
      )
    setEnabled(next, canAct || state == PaginationState.SPEAKING_PAGE || paused)
    setEnabled(restart, state == PaginationState.SPEAKING_PAGE || paused)
  }

  private fun setEnabled(button: ImageButton, enabled: Boolean) {
    button.isEnabled = enabled
    button.alpha = if (enabled) 1f else 0.4f
  }

  private fun issueText(issue: PaginationIssue): Int =
    when (issue) {
      PaginationIssue.NO_TARGET -> R.string.pagination_issue_no_target
      PaginationIssue.TARGET_INVALID -> R.string.pagination_issue_target_invalid
      PaginationIssue.TARGET_NOT_FOUND -> R.string.pagination_issue_target_not_found
      PaginationIssue.APP_CHANGED -> R.string.pagination_issue_app_changed
      PaginationIssue.NO_PERMISSION -> R.string.pagination_issue_no_permission
      PaginationIssue.CLICK_FAILED -> R.string.pagination_issue_click_failed
      PaginationIssue.PAGE_NOT_CHANGED -> R.string.pagination_issue_page_not_changed
      PaginationIssue.EMPTY_PAGE -> R.string.pagination_issue_empty_page
      PaginationIssue.CAPTURE_FAILED -> R.string.screen_ocr_capture_failed
      PaginationIssue.OCR_FAILED -> R.string.screen_ocr_failed
      PaginationIssue.SPEECH_FAILED -> R.string.reading_error_speech
      PaginationIssue.VOICE_MISSING -> R.string.reading_error_voice
      PaginationIssue.PAGE_LIMIT -> R.string.pagination_issue_page_limit
      PaginationIssue.LAST_PAGE -> R.string.pagination_issue_last_page
      PaginationIssue.NONE -> R.string.reading_status_error
    }

  fun update(state: ReadingState, info: ReadingInfo, autoScroll: Boolean) {
    val res = context.resources
    title.text =
      context.getString(if (autoScroll) R.string.reading_mode_scroll else R.string.reading_mode_speak)
    status.text =
      when (state) {
        ReadingState.CAPTURING -> context.getString(R.string.reading_status_capturing)
        ReadingState.OCR_PROCESSING -> context.getString(R.string.reading_status_ocr)
        ReadingState.SPEAKING ->
          if (autoScroll) context.getString(R.string.reading_status_section, info.section)
          else context.getString(R.string.reading_status_speaking)
        ReadingState.PAUSED -> context.getString(R.string.reading_status_paused)
        ReadingState.SCROLLING -> context.getString(R.string.reading_status_scrolling)
        ReadingState.WAITING_FOR_SCROLL -> context.getString(R.string.reading_status_manual)
        ReadingState.COMPLETE -> context.getString(R.string.reading_status_complete)
        ReadingState.STOPPED -> context.getString(R.string.reading_status_stopped)
        ReadingState.ERROR, ReadingState.IDLE -> context.getString(R.string.reading_status_error)
      }
    val paused = state == ReadingState.PAUSED
    playPause.setImageResource(if (paused) R.drawable.ic_play else R.drawable.ic_pause)
    playPause.contentDescription =
      res.getString(if (paused) R.string.reading_resume else R.string.reading_pause)
    playPause.isEnabled = state == ReadingState.SPEAKING || paused
    playPause.alpha = if (playPause.isEnabled) 1f else 0.4f
    val waiting = state == ReadingState.WAITING_FOR_SCROLL
    next.setImageResource(if (waiting) R.drawable.ic_play else R.drawable.ic_skip_forward)
    next.contentDescription = res.getString(if (waiting) R.string.reading_continue else R.string.reading_next)
    next.isEnabled = waiting || state == ReadingState.SPEAKING || paused
    next.alpha = if (next.isEnabled) 1f else 0.4f
    val canRestart = state == ReadingState.SPEAKING || paused || state == ReadingState.COMPLETE
    restart.isEnabled = canRestart
    restart.alpha = if (canRestart) 1f else 0.4f
  }
}
