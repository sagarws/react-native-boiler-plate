package com.rnboilerplate.utility

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.min
import kotlin.math.sin

/**
 * Scanner-gun beeps, generated (no audio asset): a short high "bip" when a
 * code was typed on the computer, a low double tone when it could not be.
 * Plays on the media stream, so the volume keys set its loudness.
 */
class ScanBeep {
  private val rate = 44_100
  private val ok = track(listOf(2_700.0 to 90))
  private val fail = track(listOf(520.0 to 110, 0.0 to 60, 520.0 to 110))

  fun ok() = play(ok)

  fun fail() = play(fail)

  private fun play(t: AudioTrack?) {
    t ?: return
    try {
      t.stop()
      t.reloadStaticData()
      t.play()
    } catch (_: IllegalStateException) {
      // Released or not initialised: no beep.
    }
  }

  /** Static track of (frequency Hz, ms) parts; 0 Hz is silence. */
  private fun track(parts: List<Pair<Double, Int>>): AudioTrack? {
    val samples = ShortArray(parts.sumOf { it.second } * rate / 1000)
    var at = 0
    for ((freq, ms) in parts) {
      val n = ms * rate / 1000
      val fade = min(n / 2, rate * 5 / 1000) // 5 ms edges, no clicks.
      for (i in 0 until n) {
        if (freq == 0.0) continue
        val edge = min(1.0, min(i, n - 1 - i).toDouble() / fade.coerceAtLeast(1))
        samples[at + i] = (sin(2 * PI * freq * i / rate) * edge * 0.6 * Short.MAX_VALUE).toInt().toShort()
      }
      at += n
    }
    return try {
      AudioTrack.Builder()
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_MEDIA)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        .setAudioFormat(
          AudioFormat.Builder()
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setSampleRate(rate)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build(),
        )
        .setTransferMode(AudioTrack.MODE_STATIC)
        .setBufferSizeInBytes(samples.size * 2)
        .build()
        .also { it.write(samples, 0, samples.size) }
    } catch (_: Exception) {
      null
    }
  }

  fun release() {
    ok?.release()
    fail?.release()
  }
}
