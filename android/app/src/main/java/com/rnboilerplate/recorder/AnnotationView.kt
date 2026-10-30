package com.rnboilerplate.recorder

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.view.MotionEvent
import android.view.View
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/** Editor tools. MOVE drags text labels. */
enum class AnnotationTool { PEN, HIGHLIGHTER, TEXT, RECT, ARROW, BLUR, CROP, MOVE }

/**
 * Screenshot annotation canvas. The original bitmap is never modified:
 * every edit is an operation in image coordinates (stroke, shape, text,
 * pixelate, crop, text move), so undo/redo is just moving operations
 * between two stacks and [export] renders the result fresh at full
 * resolution.
 */
class AnnotationView(context: Context, private val source: Bitmap) : View(context) {
  interface Listener {
    fun onHistoryChanged()

    /** TEXT tool tapped at image point (x, y). */
    fun onTextRequested(x: Float, y: Float)

    fun onCropPending(pending: Boolean)
  }

  sealed class Op
  private class Stroke(val path: Path, val paint: Paint) : Op()
  private class Shape(val arrow: Boolean, val a: FloatArray, val b: FloatArray, val paint: Paint) : Op()
  class TextLabel(val text: String, var x: Float, var y: Float, val paint: Paint, val background: Boolean) : Op()
  private class Move(val label: TextLabel, val fromX: Float, val fromY: Float, val toX: Float, val toY: Float) : Op()
  private class Pixelate(val rect: Rect, val tile: Bitmap) : Op()
  private class Crop(val rect: RectF, val before: RectF) : Op()

  var listener: Listener? = null
  var tool = AnnotationTool.PEN
    set(value) {
      field = value
      if (value != AnnotationTool.CROP) clearPendingCrop()
    }
  var color = Color.RED
  /** Brush width in image pixels. */
  var thickness = 8f
  var textSize = 48f
  var textBackground = false

  private val ops = mutableListOf<Op>()
  private val redo = mutableListOf<Op>()
  private var crop = RectF(0f, 0f, source.width.toFloat(), source.height.toFloat())
  private val toView = Matrix()
  private val toImage = Matrix()
  private val bitmapPaint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val pixelPaint = Paint() // No filtering: keeps the blocks sharp.
  private val dim = Paint().apply { color = Color.argb(140, 0, 0, 0) }
  private val frame = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = Color.WHITE; strokeWidth = 3f }

  // In-progress gesture.
  private var livePath: Path? = null
  private var livePaint: Paint? = null
  private var start: FloatArray? = null
  private var end: FloatArray? = null
  private var dragging: TextLabel? = null
  private var dragFrom = floatArrayOf(0f, 0f)
  private var dragOffset = floatArrayOf(0f, 0f)
  private var pendingCrop: RectF? = null

  val canUndo: Boolean
    get() = ops.isNotEmpty()

  val canRedo: Boolean
    get() = redo.isNotEmpty()

  val hasEdits: Boolean
    get() = ops.isNotEmpty()

  private fun updateMatrix() {
    val w = width.toFloat()
    val h = height.toFloat()
    if (w <= 0 || h <= 0) return
    toView.setRectToRect(crop, RectF(0f, 0f, w, h), Matrix.ScaleToFit.CENTER)
    toView.invert(toImage)
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    updateMatrix()
  }

  private fun image(e: MotionEvent): FloatArray = floatArrayOf(e.x, e.y).also { toImage.mapPoints(it) }

  private fun viewScale(): Float = toView.mapRadius(1f)

  private fun strokePaint(highlighter: Boolean) =
    Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
      color = this@AnnotationView.color
      strokeWidth = if (highlighter) thickness * 3 else thickness
      if (highlighter) {
        alpha = 90
        strokeCap = Paint.Cap.SQUARE
      }
    }

  @SuppressLint("ClickableViewAccessibility")
  override fun onTouchEvent(e: MotionEvent): Boolean {
    val p = image(e)
    when (tool) {
      AnnotationTool.PEN, AnnotationTool.HIGHLIGHTER -> when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          livePaint = strokePaint(tool == AnnotationTool.HIGHLIGHTER)
          livePath = Path().apply { moveTo(p[0], p[1]) }
        }
        MotionEvent.ACTION_MOVE -> livePath?.lineTo(p[0], p[1])
        MotionEvent.ACTION_UP -> {
          val path = livePath
          val paint = livePaint
          if (path != null && paint != null) {
            path.lineTo(p[0] + 0.1f, p[1] + 0.1f) // A tap still leaves a dot.
            push(Stroke(path, paint))
          }
          livePath = null
        }
        MotionEvent.ACTION_CANCEL -> livePath = null
      }
      AnnotationTool.RECT, AnnotationTool.ARROW, AnnotationTool.BLUR, AnnotationTool.CROP -> when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          start = clamp(p)
          end = clamp(p)
          if (tool == AnnotationTool.CROP) clearPendingCrop()
        }
        MotionEvent.ACTION_MOVE -> end = clamp(p)
        MotionEvent.ACTION_UP -> {
          val a = start
          val b = clamp(p)
          start = null
          end = null
          if (a != null && hypot(b[0] - a[0], b[1] - a[1]) * viewScale() > 12) finishShape(a, b)
        }
        MotionEvent.ACTION_CANCEL -> {
          start = null
          end = null
        }
      }
      AnnotationTool.TEXT -> if (e.actionMasked == MotionEvent.ACTION_UP) listener?.onTextRequested(p[0], p[1])
      AnnotationTool.MOVE -> when (e.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          dragging = labelAt(p)
          dragging?.let {
            dragFrom = floatArrayOf(it.x, it.y)
            dragOffset = floatArrayOf(p[0] - it.x, p[1] - it.y)
          }
        }
        MotionEvent.ACTION_MOVE -> dragging?.let {
          it.x = p[0] - dragOffset[0]
          it.y = p[1] - dragOffset[1]
        }
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
          val label = dragging
          dragging = null
          if (label != null && (label.x != dragFrom[0] || label.y != dragFrom[1])) {
            push(Move(label, dragFrom[0], dragFrom[1], label.x, label.y))
          }
        }
      }
    }
    invalidate()
    return true
  }

  private fun clamp(p: FloatArray) =
    floatArrayOf(p[0].coerceIn(crop.left, crop.right), p[1].coerceIn(crop.top, crop.bottom))

  private fun rectOf(a: FloatArray, b: FloatArray) = RectF(min(a[0], b[0]), min(a[1], b[1]), max(a[0], b[0]), max(a[1], b[1]))

  private fun finishShape(a: FloatArray, b: FloatArray) {
    when (tool) {
      AnnotationTool.RECT, AnnotationTool.ARROW ->
        push(Shape(tool == AnnotationTool.ARROW, a, b, strokePaint(false)))
      AnnotationTool.BLUR -> {
        val r = rectOf(a, b)
        val rect = Rect(r.left.toInt(), r.top.toInt(), r.right.toInt(), r.bottom.toInt())
        rect.intersect(0, 0, source.width, source.height)
        if (rect.width() < 2 || rect.height() < 2) return
        // Downscale the region to blocks of ~1/40 of the screen width.
        val block = max(8, source.width / 40)
        val region = Bitmap.createBitmap(source, rect.left, rect.top, rect.width(), rect.height())
        val tile = Bitmap.createScaledBitmap(region, max(1, rect.width() / block), max(1, rect.height() / block), false)
        region.recycle()
        push(Pixelate(rect, tile))
      }
      AnnotationTool.CROP -> {
        pendingCrop = rectOf(a, b)
        listener?.onCropPending(true)
      }
      else -> {}
    }
  }

  fun applyCrop() {
    val r = pendingCrop ?: return
    pendingCrop = null
    listener?.onCropPending(false)
    push(Crop(r, RectF(crop)))
  }

  private fun clearPendingCrop() {
    if (pendingCrop == null) return
    pendingCrop = null
    listener?.onCropPending(false)
    invalidate()
  }

  fun addText(text: String, x: Float, y: Float) {
    if (text.isBlank()) return
    val paint =
      Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = this@AnnotationView.color
        textSize = this@AnnotationView.textSize
        isFakeBoldText = true
      }
    push(TextLabel(text.trim().take(200), x, y, paint, textBackground))
  }

  private fun labelAt(p: FloatArray): TextLabel? =
    ops.filterIsInstance<TextLabel>().lastOrNull { l ->
      val w = l.paint.measureText(l.text)
      val pad = 24f
      p[0] in (l.x - pad)..(l.x + w + pad) && p[1] in (l.y + l.paint.ascent() - pad)..(l.y + l.paint.descent() + pad)
    }

  private fun push(op: Op) {
    ops += op
    redo.clear()
    if (op is Crop) apply(op, forward = true)
    listener?.onHistoryChanged()
  }

  private fun apply(op: Op, forward: Boolean) {
    when (op) {
      is Crop -> {
        crop = RectF(if (forward) op.rect else op.before)
        updateMatrix()
      }
      is Move -> {
        op.label.x = if (forward) op.toX else op.fromX
        op.label.y = if (forward) op.toY else op.fromY
      }
      else -> {}
    }
  }

  fun undo() {
    val op = ops.removeLastOrNull() ?: return
    apply(op, forward = false)
    redo += op
    listener?.onHistoryChanged()
    invalidate()
  }

  fun redo() {
    val op = redo.removeLastOrNull() ?: return
    apply(op, forward = true)
    ops += op
    listener?.onHistoryChanged()
    invalidate()
  }

  /** Removes every annotation and the crop. Not undoable — the editor asks first. */
  fun clear() {
    ops.clear()
    redo.clear()
    crop = RectF(0f, 0f, source.width.toFloat(), source.height.toFloat())
    clearPendingCrop()
    updateMatrix()
    listener?.onHistoryChanged()
    invalidate()
  }

  private fun drawOps(canvas: Canvas) {
    canvas.drawBitmap(source, 0f, 0f, bitmapPaint)
    for (op in ops) {
      when (op) {
        is Stroke -> canvas.drawPath(op.path, op.paint)
        is Shape -> drawShape(canvas, op.arrow, op.a, op.b, op.paint)
        is TextLabel -> {
          if (op.background) {
            val w = op.paint.measureText(op.text)
            val bg = Paint().apply { color = if (Color.luminance(op.paint.color) > 0.5f) Color.argb(200, 0, 0, 0) else Color.argb(220, 255, 255, 255) }
            canvas.drawRoundRect(op.x - 12, op.y + op.paint.ascent() - 8, op.x + w + 12, op.y + op.paint.descent() + 8, 12f, 12f, bg)
          }
          canvas.drawText(op.text, op.x, op.y, op.paint)
        }
        is Pixelate -> canvas.drawBitmap(op.tile, null, op.rect, pixelPaint)
        else -> {}
      }
    }
  }

  private fun drawShape(canvas: Canvas, arrow: Boolean, a: FloatArray, b: FloatArray, paint: Paint) {
    if (!arrow) {
      canvas.drawRect(rectOf(a, b), paint)
      return
    }
    canvas.drawLine(a[0], a[1], b[0], b[1], paint)
    val angle = atan2((b[1] - a[1]).toDouble(), (b[0] - a[0]).toDouble())
    val head = max(24f, paint.strokeWidth * 4)
    for (side in listOf(-0.5, 0.5)) {
      val t = angle + Math.PI + side
      canvas.drawLine(b[0], b[1], b[0] + (head * cos(t)).toFloat(), b[1] + (head * sin(t)).toFloat(), paint)
    }
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.save()
    canvas.concat(toView)
    canvas.clipRect(crop)
    drawOps(canvas)
    livePath?.let { path -> livePaint?.let { canvas.drawPath(path, it) } }
    val a = start
    val b = end
    if (a != null && b != null) {
      when (tool) {
        AnnotationTool.RECT -> drawShape(canvas, false, a, b, strokePaint(false))
        AnnotationTool.ARROW -> drawShape(canvas, true, a, b, strokePaint(false))
        else -> canvas.drawRect(rectOf(a, b), frame.apply { strokeWidth = 3f / viewScale() })
      }
    }
    pendingCrop?.let { r ->
      // Dim everything outside the pending crop.
      canvas.drawRect(crop.left, crop.top, crop.right, r.top, dim)
      canvas.drawRect(crop.left, r.bottom, crop.right, crop.bottom, dim)
      canvas.drawRect(crop.left, r.top, r.left, r.bottom, dim)
      canvas.drawRect(r.right, r.top, crop.right, r.bottom, dim)
      canvas.drawRect(r, frame.apply { strokeWidth = 3f / viewScale() })
    }
    canvas.restore()
  }

  /** The edited image at full resolution, cropped. */
  fun export(): Bitmap {
    val out = Bitmap.createBitmap(crop.width().toInt().coerceAtLeast(1), crop.height().toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.translate(-crop.left, -crop.top)
    drawOps(canvas)
    return out
  }
}
