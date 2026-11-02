package com.rnboilerplate.ytdownload

import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.os.Build
import java.io.File
import java.io.FileDescriptor
import java.nio.ByteBuffer

/**
 * Joins the downloaded video-only and audio-only streams (or remuxes a
 * single audio stream) into one playable file with Android's MediaMuxer —
 * no re-encoding, so it is fast and lossless. Samples are written in
 * timestamp order across tracks so the output is properly interleaved.
 */
object StreamMuxer {
  private const val BUFFER_SIZE = 8 * 1024 * 1024

  private class Input(val extractor: MediaExtractor, val track: Int, val buffer: ByteBuffer) {
    var done = false
  }

  fun muxerFormat(output: OutputFormat): Int =
    when (output) {
      OutputFormat.MP4, OutputFormat.M4A -> MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
      OutputFormat.WEBM, OutputFormat.WEBM_AUDIO -> MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM
      OutputFormat.OGG ->
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) MediaMuxer.OutputFormat.MUXER_OUTPUT_OGG
        else throw YtException("unsupported_format")
    }

  /** Writes to an open file descriptor (MediaStore, Android 10+). */
  fun mux(inputs: List<File>, output: OutputFormat, fd: FileDescriptor, isCancelled: () -> Boolean, onProgress: (Float) -> Unit) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) throw YtException("unsupported_format")
    run(inputs, MediaMuxer(fd, muxerFormat(output)), isCancelled, onProgress)
  }

  /** Writes to a file path (app folder, before Android 10). */
  fun mux(inputs: List<File>, output: OutputFormat, path: String, isCancelled: () -> Boolean, onProgress: (Float) -> Unit) {
    run(inputs, MediaMuxer(path, muxerFormat(output)), isCancelled, onProgress)
  }

  private fun run(files: List<File>, muxer: MediaMuxer, isCancelled: () -> Boolean, onProgress: (Float) -> Unit) {
    val inputs = mutableListOf<Input>()
    var started = false
    try {
      var durationUs = 0L
      for (file in files) {
        val extractor = MediaExtractor()
        try {
          extractor.setDataSource(file.absolutePath)
          // YouTube DASH files hold exactly one track.
          val format = extractor.getTrackFormat(0)
          extractor.selectTrack(0)
          if (format.containsKey(MediaFormat.KEY_DURATION)) durationUs = maxOf(durationUs, format.getLong(MediaFormat.KEY_DURATION))
          inputs += Input(extractor, muxer.addTrack(format), ByteBuffer.allocateDirect(BUFFER_SIZE))
        } catch (e: Exception) {
          extractor.release()
          throw e
        }
      }
      muxer.start()
      started = true

      val info = MediaCodec.BufferInfo()
      var lastProgress = 0L
      while (inputs.any { !it.done }) {
        if (isCancelled()) throw ChunkedFetcher.CancelledException()
        // Next sample = the earliest one across the inputs still open.
        val next = inputs.filter { !it.done }.minByOrNull { it.extractor.sampleTime } ?: break
        val ex = next.extractor
        val size = ex.readSampleData(next.buffer, 0)
        if (size < 0) {
          next.done = true
          continue
        }
        info.offset = 0
        info.size = size
        info.presentationTimeUs = ex.sampleTime
        info.flags = if (ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0
        muxer.writeSampleData(next.track, next.buffer, info)
        if (durationUs > 0 && info.presentationTimeUs - lastProgress > 1_000_000) {
          lastProgress = info.presentationTimeUs
          onProgress((info.presentationTimeUs.toFloat() / durationUs).coerceIn(0f, 1f))
        }
        ex.advance()
      }
      muxer.stop()
      started = false
    } finally {
      inputs.forEach { runCatching { it.extractor.release() } }
      if (started) runCatching { muxer.stop() }
      runCatching { muxer.release() }
    }
  }
}
