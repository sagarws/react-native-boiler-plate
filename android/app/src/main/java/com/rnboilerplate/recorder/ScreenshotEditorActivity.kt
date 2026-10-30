package com.rnboilerplate.recorder

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import android.widget.Toast
import com.rnboilerplate.R
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Screenshot annotation editor: pen, highlighter, text (placed by tap, moved
 * with Move), rectangle, arrow, pixelate (for sensitive details), crop;
 * colour and thickness; undo / redo / clear. The original is untouched
 * until Save, which writes a new "…_Edited.png" to the screenshot folder.
 *
 * Opened from the floating preview (EXTRA_SOURCE = private temp file) or
 * from the library (a saved screenshot's URI). Not exported.
 */
class ScreenshotEditorActivity : Activity(), AnnotationView.Listener {
  private lateinit var canvas: AnnotationView
  private lateinit var undoButton: TextView
  private lateinit var redoButton: TextView
  private lateinit var applyCrop: TextView
  private val toolChips = mutableMapOf<AnnotationTool, TextView>()
  private val colorDots = mutableMapOf<Int, View>()
  private var source: String = ""
  private var saved = false
  private val io = Executors.newSingleThreadExecutor()
  private val accent = Color.rgb(229, 72, 77)

  private fun dp(v: Int) = (v * resources.displayMetrics.density).roundToInt()

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    source = intent.getStringExtra(EXTRA_SOURCE).orEmpty()
    val bitmap = if (source.isEmpty()) null else ScreenshotSaver.load(this, Uri.parse(source))
    if (bitmap == null) {
      Toast.makeText(this, R.string.rec_editor_open_failed, Toast.LENGTH_SHORT).show()
      finish()
      return
    }
    canvas = AnnotationView(this, bitmap).also { it.listener = this }

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(Color.rgb(18, 18, 20))
      fitsSystemWindows = true
    }

    // Top bar: Cancel · Undo · Redo · Clear · Save
    val top = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(8), dp(6), dp(8), dp(6))
    }
    top.addView(action(R.string.rec_editor_cancel) { confirmCancel() })
    top.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
    undoButton = action(R.string.rec_editor_undo) { canvas.undo() }
    redoButton = action(R.string.rec_editor_redo) { canvas.redo() }
    top.addView(undoButton)
    top.addView(redoButton)
    top.addView(action(R.string.rec_editor_clear) { confirmClear() })
    top.addView(action(R.string.rec_editor_save, primary = true) { save() })
    root.addView(top)

    val stage = FrameLayout(this)
    stage.addView(canvas, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
    applyCrop = action(R.string.rec_editor_apply_crop, primary = true) { canvas.applyCrop() }.apply { visibility = View.GONE }
    stage.addView(applyCrop, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(12) })
    root.addView(stage, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

    // Tools
    val tools = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(8), dp(8), dp(8), dp(4)) }
    for ((tool, label) in listOf(
      AnnotationTool.PEN to R.string.rec_tool_pen,
      AnnotationTool.HIGHLIGHTER to R.string.rec_tool_highlighter,
      AnnotationTool.TEXT to R.string.rec_tool_text,
      AnnotationTool.MOVE to R.string.rec_tool_move,
      AnnotationTool.RECT to R.string.rec_tool_rect,
      AnnotationTool.ARROW to R.string.rec_tool_arrow,
      AnnotationTool.BLUR to R.string.rec_tool_blur,
      AnnotationTool.CROP to R.string.rec_tool_crop,
    )) {
      val chip = chip(label) { selectTool(tool) }
      toolChips[tool] = chip
      tools.addView(chip)
    }
    root.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(tools) })

    // Colours + thickness
    val bottom = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(dp(12), dp(4), dp(12), dp(12))
    }
    for ((c, name) in COLORS) {
      val dot = View(this).apply {
        contentDescription = getString(name)
        isClickable = true
        isFocusable = true
        setOnClickListener { selectColor(c) }
      }
      colorDots[c] = dot
      bottom.addView(dot, LinearLayout.LayoutParams(dp(28), dp(28)).apply { marginEnd = dp(8) })
    }
    val thickness = SeekBar(this).apply {
      max = 40
      progress = 8
      contentDescription = getString(R.string.rec_editor_thickness)
      progressTintList = ColorStateList.valueOf(accent)
      thumbTintList = ColorStateList.valueOf(accent)
      setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(bar: SeekBar, value: Int, fromUser: Boolean) {
          val px = (value.coerceAtLeast(2) * bitmap.width / 1080f).coerceAtLeast(2f)
          canvas.thickness = px
          canvas.textSize = px * 6
        }
        override fun onStartTrackingTouch(bar: SeekBar) {}
        override fun onStopTrackingTouch(bar: SeekBar) {}
      })
    }
    bottom.addView(thickness, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    root.addView(bottom)

    setContentView(root)
    canvas.thickness = 8f * bitmap.width / 1080f
    canvas.textSize = canvas.thickness * 6
    selectTool(AnnotationTool.PEN)
    selectColor(COLORS.first().first)
    onHistoryChanged()
  }

  private fun action(label: Int, primary: Boolean = false, onClick: () -> Unit) =
    TextView(this).apply {
      setText(label)
      setTextColor(Color.WHITE)
      textSize = 14f
      typeface = Typeface.DEFAULT_BOLD
      setPadding(dp(12), dp(8), dp(12), dp(8))
      background = GradientDrawable().apply { cornerRadius = dp(18).toFloat(); setColor(if (primary) accent else Color.TRANSPARENT) }
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
    }

  private fun chip(label: Int, onClick: () -> Unit) =
    TextView(this).apply {
      setText(label)
      textSize = 13f
      setPadding(dp(14), dp(8), dp(14), dp(8))
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(6) }
    }

  private fun selectTool(tool: AnnotationTool) {
    canvas.tool = tool
    for ((t, chip) in toolChips) {
      val on = t == tool
      chip.setTextColor(if (on) Color.WHITE else Color.argb(200, 255, 255, 255))
      chip.background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(if (on) accent else Color.argb(40, 255, 255, 255)) }
      chip.isSelected = on
    }
  }

  private fun selectColor(color: Int) {
    canvas.color = color
    for ((c, dot) in colorDots) {
      dot.background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(c)
        setStroke(dp(if (c == color) 3 else 1), if (c == color) Color.WHITE else Color.argb(90, 255, 255, 255))
      }
      dot.isSelected = c == color
    }
  }

  override fun onHistoryChanged() {
    undoButton.isEnabled = canvas.canUndo
    undoButton.alpha = if (canvas.canUndo) 1f else 0.4f
    redoButton.isEnabled = canvas.canRedo
    redoButton.alpha = if (canvas.canRedo) 1f else 0.4f
  }

  override fun onCropPending(pending: Boolean) {
    applyCrop.visibility = if (pending) View.VISIBLE else View.GONE
  }

  override fun onTextRequested(x: Float, y: Float) {
    val input = EditText(this).apply {
      hint = getString(R.string.rec_editor_text_hint)
      setSingleLine(false)
      maxLines = 3
    }
    val container = FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(input) }
    var withBackground = false
    AlertDialog.Builder(this)
      .setTitle(R.string.rec_tool_text)
      .setView(container)
      .setMultiChoiceItems(arrayOf(getString(R.string.rec_editor_text_background)), booleanArrayOf(false)) { _, _, checked -> withBackground = checked }
      .setPositiveButton(R.string.rec_editor_add) { _, _ ->
        canvas.textBackground = withBackground
        canvas.addText(input.text.toString(), x, y)
        canvas.invalidate()
      }
      .setNegativeButton(R.string.rec_editor_cancel, null)
      .show()
  }

  private fun confirmClear() {
    if (!canvas.hasEdits) return
    AlertDialog.Builder(this)
      .setMessage(R.string.rec_editor_clear_confirm)
      .setPositiveButton(R.string.rec_editor_clear) { _, _ -> canvas.clear() }
      .setNegativeButton(R.string.rec_editor_cancel, null)
      .show()
  }

  private fun confirmCancel() {
    if (!canvas.hasEdits) {
      finish()
      return
    }
    AlertDialog.Builder(this)
      .setMessage(R.string.rec_editor_discard_confirm)
      .setPositiveButton(R.string.rec_editor_discard) { _, _ -> finish() }
      .setNegativeButton(R.string.rec_editor_keep_editing, null)
      .show()
  }

  @Deprecated("Back handling kept on the platform Activity API")
  override fun onBackPressed() = confirmCancel()

  private fun save() {
    val bitmap = canvas.export()
    val config = RecorderPrefs(this).read()
    io.execute {
      val ok =
        try {
          ScreenshotSaver.save(applicationContext, bitmap, config, edited = true)
          true
        } catch (_: Exception) {
          false
        } finally {
          bitmap.recycle()
        }
      runOnUiThread {
        if (ok) {
          saved = true
          Toast.makeText(this, R.string.rec_screenshot_saved, Toast.LENGTH_SHORT).show()
          finish()
        } else {
          Toast.makeText(this, R.string.rec_save_failed, Toast.LENGTH_LONG).show()
        }
      }
    }
  }

  override fun onDestroy() {
    if (isFinishing && source.isNotEmpty()) RecorderEvents.onEditorClosed?.invoke(source, saved)
    io.shutdown()
    super.onDestroy()
  }

  companion object {
    const val EXTRA_SOURCE = "source"

    private val COLORS = listOf(
      Color.rgb(229, 72, 77) to R.string.rec_color_red,
      Color.rgb(255, 200, 40) to R.string.rec_color_yellow,
      Color.rgb(48, 164, 108) to R.string.rec_color_green,
      Color.rgb(0, 144, 255) to R.string.rec_color_blue,
      Color.WHITE to R.string.rec_color_white,
      Color.BLACK to R.string.rec_color_black,
    )

    fun open(context: Context, source: String) {
      context.startActivity(
        Intent(context, ScreenshotEditorActivity::class.java)
          .putExtra(EXTRA_SOURCE, source)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }
}
