package com.rnboilerplate.photowidget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import java.io.File
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Photo files for widgets: picked photos are copied (upright, at most
 * 2048 px) into private storage, so the widget never depends on the
 * gallery item still existing or on a granted URI permission. Rendering
 * decodes only what the widget needs and caps the bitmap, because a
 * widget's RemoteViews have a strict memory budget.
 */
object PhotoImages {
  private const val DIR = "photo_widgets"
  private const val MAX_IMPORT = 2048
  /** Longest side of a rendered widget bitmap. */
  const val MAX_RENDER = 900

  data class Imported(val path: String, val width: Int, val height: Int)

  fun dir(context: Context): File = File(context.filesDir, DIR).apply { mkdirs() }

  /** True when [path] is one of our own photo files. */
  fun owns(context: Context, path: String): Boolean {
    val f = File(path)
    return f.canonicalPath.startsWith(dir(context).canonicalPath + File.separator)
  }

  fun import(context: Context, uri: Uri): Imported {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    require(bounds.outWidth > 0 && bounds.outHeight > 0) { "not_an_image" }
    val rotation = resolver.openInputStream(uri)?.use {
      when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    } ?: 0f
    var sample = 1
    while (max(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_IMPORT) sample *= 2
    val decoded = resolver.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: error("decode_failed")
    val scale = MAX_IMPORT.toFloat() / max(decoded.width, decoded.height)
    val m = Matrix().apply {
      if (scale < 1f) postScale(scale, scale)
      if (rotation != 0f) postRotate(rotation)
    }
    val upright = if (m.isIdentity) decoded else Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true)
    // Keep transparency (e.g. a logo PNG): JPEG would turn it black.
    val png = upright.hasAlpha()
    val file = File(dir(context), "${UUID.randomUUID()}.${if (png) "png" else "jpg"}")
    file.outputStream().use {
      upright.compress(if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG, 90, it)
    }
    val out = Imported(file.absolutePath, upright.width, upright.height)
    if (upright !== decoded) upright.recycle()
    decoded.recycle()
    return out
  }

  fun delete(context: Context, path: String) {
    if (owns(context, path)) File(path).delete()
  }

  /** Deletes photo files no config uses any more (after a replace / delete). */
  fun prune(context: Context, inUse: Set<String>) {
    dir(context).listFiles()?.forEach { if (it.absolutePath !in inUse) it.delete() }
  }

  /** [c] drawn at [w] × [h] px (scaled down to MAX_RENDER), or null if the file is gone. */
  fun render(c: PhotoConfig, w: Int, h: Int, density: Float): Bitmap? {
    if (w <= 0 || h <= 0) return null
    val file = File(c.image)
    if (!file.exists()) return null
    val shrink = minOf(1f, MAX_RENDER.toFloat() / max(w, h))
    val bw = max(1, (w * shrink).roundToInt())
    val bh = max(1, (h * shrink).roundToInt())
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(c.image, bounds)
    val iw = if (bounds.outWidth > 0) bounds.outWidth else c.imgW
    val ih = if (bounds.outHeight > 0) bounds.outHeight else c.imgH
    if (iw <= 0 || ih <= 0) return null
    val l = PhotoMath.layout(iw, ih, bw.toFloat(), bh.toFloat(), c.mode, c.frameW, c.frameH, c.focusX, c.focusY, c.zoom)
    val sample = PhotoMath.sampleSize(l.src.width, l.src.height, l.dst.width, l.dst.height)
    val photo = BitmapFactory.decodeFile(c.image, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return null
    val k = photo.width.toFloat() / iw
    val src = Rect(
      (l.src.left * k).roundToInt(),
      (l.src.top * k).roundToInt(),
      ((l.src.left + l.src.width) * k).roundToInt(),
      ((l.src.top + l.src.height) * k).roundToInt(),
    )
    val out = Bitmap.createBitmap(bw, bh, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val frame = RectF(l.frame.left, l.frame.top, l.frame.left + l.frame.width, l.frame.top + l.frame.height)
    val radius = c.corner * density * shrink
    if (radius > 0f) canvas.clipPath(Path().apply { addRoundRect(frame, radius, radius, Path.Direction.CW) })
    val dst = RectF(l.dst.left, l.dst.top, l.dst.left + l.dst.width, l.dst.top + l.dst.height)
    canvas.drawBitmap(photo, src, dst, Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG))
    photo.recycle()
    return out
  }
}
