package com.rnboilerplate.recorder

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer

/**
 * Joins a session's segments into one file by remuxing — compressed samples
 * are copied, never decoded or re-encoded, so it is fast, lossless and
 * streams one sample at a time (constant memory however long the session).
 * Each segment's samples are placed at its stored session start time, which
 * restores the original continuous timeline and keeps audio and video in
 * sync. Segments come from one continuous encoder, so their formats match;
 * a segment whose tracks differ is rejected rather than producing a broken
 * file.
 */
class SegmentMerger(private val storage: OutputStorage) {
  data class Part(val uri: Uri, val startUs: Long)

  class MergeException(val code: String) : Exception(code)

  /** Writes [parts] (in order) into [output]; [onProgress] gets 0–1. Returns the duration in µs. */
  fun merge(parts: List<Part>, output: Uri, onProgress: (Float) -> Unit): Long {
    if (parts.isEmpty()) throw MergeException("no_segments")
    val (pfd, muxer) =
      try {
        SegmentedRecorder.openMuxer(storage, output)
      } catch (e: Exception) {
        throw MergeException("storage")
      }
    var started = false
    var endUs = 0L
    try {
      val tracks = HashMap<String, Int>() // "video" / "audio" → muxer track
      val formats = HashMap<String, MediaFormat>()
      val last = HashMap<Int, Long>()
      var buffer = ByteBuffer.allocate(1 shl 20)
      val info = MediaCodec.BufferInfo()
      val base = parts.first().startUs
      for ((n, part) in parts.withIndex()) {
        val extractor = MediaExtractor()
        storage.openRead(part.uri).use { input ->
          extractor.setDataSource(input.fileDescriptor)
          val map = HashMap<Int, Int>() // extractor track → muxer track
          for (t in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(t)
            val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
            val kind = if (mime.startsWith("video/")) "video" else if (mime.startsWith("audio/")) "audio" else continue
            if (!started) {
              tracks[kind] = muxer.addTrack(format)
              formats[kind] = format
            } else {
              val first = formats[kind] ?: throw MergeException("incompatible")
              if (first.getString(MediaFormat.KEY_MIME) != mime || !sameShape(first, format)) throw MergeException("incompatible")
            }
            if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
              val max = format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE)
              if (max > buffer.capacity()) buffer = ByteBuffer.allocate(max)
            }
            map[t] = tracks[kind] ?: continue
            extractor.selectTrack(t)
          }
          if (!started) {
            if (tracks.isEmpty()) throw MergeException("no_tracks")
            muxer.start()
            started = true
          }
          val offset = part.startUs - base
          while (true) {
            val size =
              try {
                extractor.readSampleData(buffer, 0)
              } catch (_: IllegalArgumentException) {
                // A sample bigger than advertised: grow once and retry.
                buffer = ByteBuffer.allocate(buffer.capacity() * 2)
                extractor.readSampleData(buffer, 0)
              }
            if (size < 0) break
            val track = map[extractor.sampleTrackIndex]
            if (track != null) {
              var pts = offset + extractor.sampleTime
              val prev = last[track]
              if (prev != null && pts <= prev) pts = prev + 1
              last[track] = pts
              val key = extractor.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0
              info.set(0, size, pts, if (key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
              muxer.writeSampleData(track, buffer, info)
              if (pts > endUs) endUs = pts
            }
            extractor.advance()
          }
        }
        extractor.release()
        onProgress((n + 1).toFloat() / parts.size)
      }
      muxer.stop()
      return endUs
    } catch (e: MergeException) {
      throw e
    } catch (e: Exception) {
      throw MergeException("merge_failed")
    } finally {
      try {
        muxer.release()
      } catch (_: Exception) {
      }
      try {
        pfd?.close()
      } catch (_: Exception) {
      }
    }
  }

  private fun sameShape(a: MediaFormat, b: MediaFormat): Boolean {
    fun int(f: MediaFormat, k: String) = if (f.containsKey(k)) f.getInteger(k) else -1
    return int(a, MediaFormat.KEY_WIDTH) == int(b, MediaFormat.KEY_WIDTH) &&
      int(a, MediaFormat.KEY_HEIGHT) == int(b, MediaFormat.KEY_HEIGHT) &&
      int(a, MediaFormat.KEY_SAMPLE_RATE) == int(b, MediaFormat.KEY_SAMPLE_RATE) &&
      int(a, MediaFormat.KEY_CHANNEL_COUNT) == int(b, MediaFormat.KEY_CHANNEL_COUNT)
  }
}

/** Checks a finished file really is playable media, and makes list thumbnails. */
object MediaCheck {
  data class Info(val durationMs: Long, val width: Int, val height: Int, val hasVideo: Boolean, val hasAudio: Boolean)

  fun inspect(context: Context, storage: OutputStorage, uri: Uri): Info? =
    try {
      storage.openRead(uri).use { pfd ->
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(pfd.fileDescriptor)
          var video = false
          var audio = false
          var w = 0
          var h = 0
          var durUs = 0L
          for (t in 0 until extractor.trackCount) {
            val f = extractor.getTrackFormat(t)
            val mime = f.getString(MediaFormat.KEY_MIME) ?: continue
            if (f.containsKey(MediaFormat.KEY_DURATION)) durUs = maxOf(durUs, f.getLong(MediaFormat.KEY_DURATION))
            if (mime.startsWith("video/")) {
              video = true
              w = f.getInteger(MediaFormat.KEY_WIDTH)
              h = f.getInteger(MediaFormat.KEY_HEIGHT)
            } else if (mime.startsWith("audio/")) {
              audio = true
            }
          }
          if ((!video && !audio) || durUs <= 0) null else Info(durUs / 1000, w, h, video, audio)
        } finally {
          extractor.release()
        }
      }
    } catch (_: Exception) {
      null
    }

  fun verify(context: Context, storage: OutputStorage, uri: Uri): Boolean = inspect(context, storage, uri) != null

  private fun thumbFile(context: Context, id: String) =
    File(context.cacheDir, "recording_thumbs").apply { mkdirs() }.let { File(it, "$id.jpg") }

  fun videoThumb(context: Context, storage: OutputStorage, uri: Uri, id: String): String? =
    try {
      val retriever = MediaMetadataRetriever()
      try {
        storage.openRead(uri).use { pfd ->
          retriever.setDataSource(pfd.fileDescriptor)
          val frame = retriever.getFrameAtTime(1_000_000L, MediaMetadataRetriever.OPTION_CLOSEST_SYNC) ?: return null
          saveThumb(context, frame, id)
        }
      } finally {
        retriever.release()
      }
    } catch (_: Exception) {
      null
    }

  fun saveThumb(context: Context, bitmap: Bitmap, id: String): String? =
    try {
      val scale = 320f / maxOf(bitmap.width, bitmap.height)
      val small =
        if (scale < 1f) Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt().coerceAtLeast(1), (bitmap.height * scale).toInt().coerceAtLeast(1), true)
        else bitmap
      val file = thumbFile(context, id)
      FileOutputStream(file).use { small.compress(Bitmap.CompressFormat.JPEG, 80, it) }
      if (small !== bitmap) small.recycle()
      file.absolutePath
    } catch (_: Exception) {
      null
    }

  fun deleteThumb(context: Context, id: String) {
    thumbFile(context, id).delete()
  }
}
