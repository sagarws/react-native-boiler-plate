package com.rnboilerplate.utility

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.pdf.PdfDocument
import android.net.Uri
import com.rnboilerplate.common.FileShare
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream
import java.util.UUID

/**
 * Scanned pages as private JPEG files (files/scans), and what can be made
 * from them. Pages are decoded one at a time and downsampled, so a long
 * document never holds more than one page bitmap in memory.
 */
object DocumentPages {
  /** Longest side a page is drawn at in a PDF or exported image. */
  private const val MAX_SIDE = 2400

  private fun dir(context: Context) = File(context.filesDir, "scans").apply { mkdirs() }

  /** Copies scanner output (content/file URIs) into private storage. */
  fun importPages(context: Context, uris: List<Uri>): List<String> =
    uris.map { uri ->
      val out = File(dir(context), "${UUID.randomUUID()}.jpg")
      val input = context.contentResolver.openInputStream(uri) ?: throw IllegalStateException("Page not readable")
      input.use { i -> FileOutputStream(out).use { o -> i.copyTo(o) } }
      out.absolutePath
    }

  /** A page file inside app storage, or an error. */
  fun page(context: Context, path: String): File =
    FileShare.privateFile(context, path) ?: throw IllegalArgumentException("Not a scanned page")

  /** Rotates by a multiple of 90°; writes a new file and deletes the old one. */
  fun rotate(context: Context, path: String, degrees: Int): String {
    val src = page(context, path)
    val bitmap = decode(src, MAX_SIDE)
    val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(degrees.toFloat()) }, true)
    if (rotated !== bitmap) bitmap.recycle()
    val out = File(dir(context), "${UUID.randomUUID()}.jpg")
    FileOutputStream(out).use { rotated.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    rotated.recycle()
    src.delete()
    return out.absolutePath
  }

  /** Decodes [file] downsampled so its longest side is at most about [maxSide]. */
  fun decode(file: File, maxSide: Int): Bitmap {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) throw IllegalStateException("Unreadable page")
    val opts = BitmapFactory.Options().apply {
      inSampleSize = PageLayout.sampleSize(bounds.outWidth, bounds.outHeight, maxSide)
    }
    return BitmapFactory.decodeFile(file.absolutePath, opts) ?: throw IllegalStateException("Unreadable page")
  }

  /** Writes a multi-page PDF, pages in the given order, each fitted to A4. */
  fun writePdf(context: Context, paths: List<String>, out: OutputStream) {
    val files = paths.map { page(context, it) }
    val pdf = PdfDocument()
    try {
      val paint = Paint(Paint.FILTER_BITMAP_FLAG)
      files.forEachIndexed { index, file ->
        val bitmap = decode(file, MAX_SIDE)
        val (pw, ph) = PageLayout.a4For(bitmap.width, bitmap.height)
        val page = pdf.startPage(PdfDocument.PageInfo.Builder(pw, ph, index + 1).create())
        page.canvas.drawColor(Color.WHITE)
        val r = PageLayout.fit(bitmap.width, bitmap.height, pw, ph, PageLayout.MARGIN)
        page.canvas.drawBitmap(bitmap, null, RectF(r[0], r[1], r[2], r[3]), paint)
        pdf.finishPage(page)
        bitmap.recycle()
      }
      pdf.writeTo(out)
    } finally {
      pdf.close()
    }
  }

  /** Writes one page as JPEG or PNG. */
  fun writeImage(context: Context, path: String, png: Boolean, out: OutputStream) {
    val bitmap = decode(page(context, path), MAX_SIDE)
    try {
      if (png) bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      else bitmap.compress(Bitmap.CompressFormat.JPEG, 92, out)
    } finally {
      bitmap.recycle()
    }
  }

  /** A PDF in the cache for the share sheet (replaced on each share). */
  fun cachePdf(context: Context, paths: List<String>, fileName: String): File {
    val shareDir = File(context.cacheDir, "share").apply {
      mkdirs()
      listFiles()?.forEach { it.delete() }
    }
    val out = File(shareDir, PageLayout.safeName(fileName, "pdf"))
    FileOutputStream(out).use { writePdf(context, paths, it) }
    return out
  }

  fun delete(context: Context, paths: List<String>) {
    paths.forEach { FileShare.privateFile(context, it)?.delete() }
  }
}

/** Page geometry and naming (pure; unit tested). */
object PageLayout {
  /** A4 at 72 dpi. */
  const val A4_SHORT = 595
  const val A4_LONG = 842
  const val MARGIN = 18f

  /** Portrait A4 for tall pages, landscape for wide ones. */
  fun a4For(width: Int, height: Int): Pair<Int, Int> =
    if (width > height) A4_LONG to A4_SHORT else A4_SHORT to A4_LONG

  /** [left, top, right, bottom] of the image fitted (aspect kept) and centred. */
  fun fit(imgW: Int, imgH: Int, pageW: Int, pageH: Int, margin: Float): FloatArray {
    val boxW = pageW - 2 * margin
    val boxH = pageH - 2 * margin
    val scale = minOf(boxW / imgW, boxH / imgH)
    val w = imgW * scale
    val h = imgH * scale
    val left = (pageW - w) / 2
    val top = (pageH - h) / 2
    return floatArrayOf(left, top, left + w, top + h)
  }

  /** Power-of-two downsampling so the longest side fits [maxSide]. */
  fun sampleSize(width: Int, height: Int, maxSide: Int): Int {
    var sample = 1
    while (maxOf(width, height) / (sample * 2) >= maxSide) sample *= 2
    return sample
  }

  /** A file name without path separators or odd characters, with [ext]. */
  fun safeName(name: String, ext: String): String {
    val base = name.substringBeforeLast('.').replace(Regex("[^\\p{L}\\p{N} _.-]"), "").trim().trimStart('.').take(80)
    return "${base.ifBlank { "scan" }}.$ext"
  }
}
