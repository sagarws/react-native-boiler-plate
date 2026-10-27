package com.rnboilerplate.screenocr.share

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import androidx.annotation.RequiresApi

/**
 * "All phone audio": Android's playback capture (API 29+) over the
 * floating button's existing screen-capture consent. Captures what other
 * apps play with media / game / unknown usage — never calls, never the
 * microphone, and never apps that opt out of capture (often DRM video/music).
 *
 * Reads 100 ms of 48 kHz stereo at a time (real-time paced by the
 * recorder), mixes in Akshar's own speech ([mix]), and hands non-silent
 * chunks to [onChunk]. Needs RECORD_AUDIO (Android's gate for playback
 * capture; nothing is recorded from the microphone).
 */
@RequiresApi(Build.VERSION_CODES.Q)
class DeviceAudioCapture(
  private val projection: MediaProjection,
  private val onChunk: (ByteArray) -> Unit,
  private val onFailed: () -> Unit,
) {
  @Volatile private var running = false
  private var thread: Thread? = null
  /** Pending speech to mix in: interleaved 48 kHz stereo. */
  private val speech = ArrayDeque<ShortArray>()
  private var speechOffset = 0

  fun start() {
    if (running) return
    running = true
    thread = Thread({ run() }, "device-audio-capture").also { it.start() }
  }

  fun stop() {
    running = false
    thread?.interrupt()
    thread = null
    synchronized(speech) {
      speech.clear()
      speechOffset = 0
    }
  }

  /** Queues Akshar's own speech (any rate/channels) to be mixed into the stream. */
  fun mix(clip: PcmClip) {
    val samples = resampleToStereo48k(clip)
    synchronized(speech) { speech.addLast(samples) }
  }

  fun flushSpeech() =
    synchronized(speech) {
      speech.clear()
      speechOffset = 0
    }

  @SuppressLint("MissingPermission") // Checked by AudioShareHub before starting.
  private fun run() {
    val record =
      try {
        val config =
          AudioPlaybackCaptureConfiguration.Builder(projection)
            .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
            .addMatchingUsage(AudioAttributes.USAGE_GAME)
            .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
            .build()
        val format =
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(RATE)
            .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
            .build()
        val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, AudioFormat.ENCODING_PCM_16BIT)
        AudioRecord.Builder()
          .setAudioFormat(format)
          .setBufferSizeInBytes(maxOf(min * 2, CHUNK_BYTES * 2))
          .setAudioPlaybackCaptureConfig(config)
          .build()
      } catch (_: Exception) {
        running = false
        onFailed()
        return
      }
    try {
      record.startRecording()
      val bytes = ByteArray(CHUNK_BYTES)
      val shorts = ShortArray(CHUNK_BYTES / 2)
      while (running) {
        var read = 0
        while (read < bytes.size && running) {
          val n = record.read(bytes, read, bytes.size - read)
          if (n < 0) throw IllegalStateException("AudioRecord read failed: $n")
          read += n
        }
        if (!running) break
        // Little-endian 16-bit → shorts, mix speech, back to bytes.
        var peak = 0
        for (i in shorts.indices) {
          shorts[i] = ((bytes[2 * i + 1].toInt() shl 8) or (bytes[2 * i].toInt() and 0xff)).toShort()
        }
        val mixed = mixSpeechInto(shorts)
        for (i in shorts.indices) {
          val v = shorts[i].toInt()
          if (v > peak) peak = v else if (-v > peak) peak = -v
          bytes[2 * i] = v.toByte()
          bytes[2 * i + 1] = (v shr 8).toByte()
        }
        // Skip pure silence: saves bandwidth; the receiver plays silence anyway.
        if (mixed || peak > SILENCE_PEAK) onChunk(bytes.copyOf())
      }
    } catch (_: InterruptedException) {
    } catch (_: Exception) {
      if (running) onFailed()
    } finally {
      running = false
      try {
        record.stop()
      } catch (_: IllegalStateException) {
      }
      record.release()
    }
  }

  /** Adds queued speech into [out] (saturating); true if any was mixed. */
  private fun mixSpeechInto(out: ShortArray): Boolean =
    synchronized(speech) {
      var i = 0
      var any = false
      while (i < out.size && speech.isNotEmpty()) {
        val head = speech.first()
        val n = minOf(out.size - i, head.size - speechOffset)
        for (k in 0 until n) {
          out[i + k] = (out[i + k] + head[speechOffset + k]).coerceIn(-32768, 32767).toShort()
        }
        any = true
        i += n
        speechOffset += n
        if (speechOffset >= head.size) {
          speech.removeFirst()
          speechOffset = 0
        }
      }
      any
    }

  companion object {
    const val RATE = 48_000
    const val CHANNELS = 2
    /** 100 ms of 48 kHz stereo 16-bit. */
    private const val CHUNK_BYTES = RATE / 10 * CHANNELS * 2
    private const val SILENCE_PEAK = 8

    /** Linear-interpolated resample of [clip] to interleaved 48 kHz stereo. */
    fun resampleToStereo48k(clip: PcmClip): ShortArray {
      val inFrames = clip.data.size / (2 * clip.channels)
      if (inFrames == 0) return ShortArray(0)
      fun sample(frame: Int, channel: Int): Int {
        val c = if (clip.channels == 1) 0 else channel
        val i = (frame * clip.channels + c) * 2
        return (clip.data[i + 1].toInt() shl 8) or (clip.data[i].toInt() and 0xff)
      }
      val outFrames = (inFrames.toLong() * RATE / clip.sampleRate).toInt()
      val out = ShortArray(outFrames * CHANNELS)
      val step = clip.sampleRate.toDouble() / RATE
      for (f in 0 until outFrames) {
        val pos = f * step
        val i0 = pos.toInt().coerceAtMost(inFrames - 1)
        val i1 = (i0 + 1).coerceAtMost(inFrames - 1)
        val t = pos - i0
        for (ch in 0 until CHANNELS) {
          out[f * CHANNELS + ch] = (sample(i0, ch) * (1 - t) + sample(i1, ch) * t).toInt().toShort()
        }
      }
      return out
    }
  }
}
