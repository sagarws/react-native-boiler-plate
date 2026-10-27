package com.rnboilerplate.screenocr

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * In-app previews for File Management: downloads a Drive file into the app's
 * cache (with the caller's short-lived access token) and renders PDF pages
 * with Android's built-in [PdfRenderer] — no extra library.
 *
 * Files live in `cache/previews` (Android may clear it; [clear] does on
 * close). Nothing about the URL or token is logged. Not thread-safe: the
 * module calls this from one background thread.
 */
class FilePreviews(context: Context) {
  private val dir = File(context.cacheDir, "previews")
  private var openPath: String? = null
  private var renderer: PdfRenderer? = null
  private var descriptor: ParcelFileDescriptor? = null

  /** Downloads [url] (Authorization header [authorization]) once; returns the local path. */
  fun download(url: String, authorization: String): String {
    dir.mkdirs()
    val target = File(dir, "${hash(url)}.bin")
    if (target.exists() && target.length() > 0) return target.absolutePath
    val partial = File(dir, "${target.name}.part")
    val conn = URL(url).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 15_000
      conn.readTimeout = 30_000
      conn.setRequestProperty("Authorization", authorization)
      val status = conn.responseCode
      if (status !in 200..299) throw IOException("HTTP $status")
      if (conn.contentLengthLong > MAX_BYTES) throw IOException("too_large")
      var total = 0L
      conn.inputStream.use { input ->
        FileOutputStream(partial).use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            total += n
            if (total > MAX_BYTES) throw IOException("too_large")
            output.write(buffer, 0, n)
          }
        }
      }
      if (!partial.renameTo(target)) throw IOException("Could not save")
      return target.absolutePath
    } finally {
      partial.delete()
      conn.disconnect()
    }
  }

  fun pageCount(path: String): Int = open(path).pageCount

  /**
   * Renders page [index] at [width] px wide (white background) to a JPEG in
   * the cache; returns its `file://` URI. Cached per page and width.
   */
  fun renderPage(path: String, index: Int, width: Int): String {
    val out = File(dir, "${hash(path)}-$index-$width.jpg")
    if (out.exists()) return "file://${out.absolutePath}"
    val doc = open(path)
    require(index in 0 until doc.pageCount) { "No page $index" }
    doc.openPage(index).use { page ->
      val w = width.coerceIn(200, MAX_WIDTH)
      val h = (w.toLong() * page.height / page.width).toInt().coerceIn(1, MAX_WIDTH * 3)
      val bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      FileOutputStream(out).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      bitmap.recycle()
    }
    return "file://${out.absolutePath}"
  }

  /** Closes any open PDF and deletes cached previews. */
  fun clear() {
    close()
    dir.listFiles()?.forEach { it.delete() }
  }

  private fun open(path: String): PdfRenderer {
    renderer?.takeIf { openPath == path }?.let { return it }
    close()
    val fd = ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY)
    descriptor = fd
    return PdfRenderer(fd).also {
      renderer = it
      openPath = path
    }
  }

  private fun close() {
    try {
      renderer?.close()
      descriptor?.close()
    } catch (_: Exception) {
    }
    renderer = null
    descriptor = null
    openPath = null
  }

  companion object {
    /** Large enough for most documents/videos' metadata; keeps the cache bounded. */
    const val MAX_BYTES = 100L * 1024 * 1024
    const val MAX_WIDTH = 2000

    fun hash(value: String): String =
      MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }.take(24)
  }
}
