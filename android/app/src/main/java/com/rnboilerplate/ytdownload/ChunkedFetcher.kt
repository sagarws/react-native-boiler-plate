package com.rnboilerplate.ytdownload

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Downloads one googlevideo stream to a file in Range chunks. YouTube slows
 * down single large requests, so ~10 MB pieces keep the full speed. Resumes
 * from what is already on disk and retries a failed chunk a few times.
 */
class ChunkedFetcher(
  private val isCancelled: () -> Boolean,
  private val onProgress: (written: Long, total: Long) -> Unit,
) {
  fun fetch(url: String, dest: File, expectedSize: Long) {
    var total = expectedSize
    var position = if (dest.exists()) dest.length() else 0L
    FileOutputStream(dest, true).use { out ->
      while (total <= 0 || position < total) {
        if (isCancelled()) throw CancelledException()
        var attempt = 0
        while (true) {
          try {
            val (next, reportedTotal) = fetchRange(url, position, out)
            if (reportedTotal > 0) total = reportedTotal
            // Nothing new from the server: the stream is complete.
            if (next == position) total = position
            position = next
            break
          } catch (e: CancelledException) {
            throw e
          } catch (e: YtException) {
            throw e
          } catch (e: IOException) {
            if (++attempt >= MAX_ATTEMPTS) throw e
            Thread.sleep(RETRY_DELAY_MS * attempt)
          }
        }
        onProgress(position, total)
      }
    }
  }

  /**
   * Appends bytes from [start] (one chunk) to [out].
   * Returns (new file length, total stream size or -1 when unknown).
   */
  private fun fetchRange(url: String, start: Long, out: FileOutputStream): Pair<Long, Long> {
    val connection = URL(url).openConnection() as HttpURLConnection
    try {
      connection.connectTimeout = 20_000
      connection.readTimeout = 30_000
      connection.setRequestProperty("User-Agent", YtExtractor.USER_AGENT)
      connection.setRequestProperty("Range", "bytes=$start-${start + CHUNK_SIZE - 1}")
      val code = connection.responseCode
      when {
        code == 416 -> return start to start
        code == 403 || code == 410 -> throw YtException("link_expired")
        code >= 400 -> throw IOException("HTTP $code")
      }
      // 200 = the server ignored Range and sends the whole file: start over.
      val wholeFile = code == 200
      val base = if (wholeFile) 0L else start
      if (wholeFile && start > 0) out.channel.truncate(0)
      val total =
        if (wholeFile) connection.contentLengthLong
        else connection.getHeaderField("Content-Range")?.substringAfterLast('/')?.toLongOrNull() ?: -1L
      var written = 0L
      var lastReport = 0L
      val buffer = ByteArray(BUFFER_SIZE)
      connection.inputStream.use { input ->
        while (true) {
          if (isCancelled()) throw CancelledException()
          val read = input.read(buffer)
          if (read < 0) break
          out.write(buffer, 0, read)
          written += read
          if (written - lastReport >= REPORT_EVERY) {
            lastReport = written
            onProgress(base + written, total)
          }
        }
      }
      return base + written to total
    } finally {
      connection.disconnect()
    }
  }

  class CancelledException : Exception("cancelled")

  companion object {
    private const val CHUNK_SIZE = 10L * 1024 * 1024
    private const val BUFFER_SIZE = 64 * 1024
    private const val REPORT_EVERY = 512L * 1024
    private const val MAX_ATTEMPTS = 4
    private const val RETRY_DELAY_MS = 1_500L
  }
}
