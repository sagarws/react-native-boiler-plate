package com.rnboilerplate.utility

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import kotlin.math.PI
import kotlin.math.sin

/**
 * Speaker Water Eject: a generated low-frequency tone (no audio asset) for a
 * fixed time, with an optional gentle vibration. Holds transient audio focus
 * and stops at once if another app (a call, an alarm) takes it. Never runs
 * in the background on its own: the screen stops it when it closes.
 */
class TonePlayer(
  private val context: Context,
  private val onEnded: (reason: String) -> Unit,
) {
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var playing = false
  private var thread: Thread? = null
  private var focusRequest: AudioFocusRequest? = null
  private val stopRunnable = Runnable { stop("finished") }

  private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
    if (change == AudioManager.AUDIOFOCUS_LOSS ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
      change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
    ) {
      main.post { stop("interrupted") }
    }
  }

  private val vibrator: Vibrator? =
    if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager)?.defaultVibrator
    } else {
      @Suppress("DEPRECATION")
      context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    }

  fun hasVibrator(): Boolean = vibrator?.hasVibrator() == true

  /** Returns 'playing' or 'focus_denied'. Must be called on the main thread. */
  fun start(mode: String, durationMs: Long, vibrate: Boolean): String {
    stop(null)
    if (!requestFocus()) return "focus_denied"
    playing = true
    val safeDuration = durationMs.coerceIn(5_000L, MAX_DURATION_MS)
    thread = Thread({ render(mode, safeDuration) }, "water-eject-tone").apply { start() }
    if (vibrate && hasVibrator()) vibrate()
    main.postDelayed(stopRunnable, safeDuration)
    return "playing"
  }

  /** Stops sound and vibration. [reason] null = silent (no event). */
  fun stop(reason: String?) {
    main.removeCallbacks(stopRunnable)
    val wasPlaying = playing
    playing = false
    thread?.join(500)
    thread = null
    vibrator?.cancel()
    abandonFocus()
    if (wasPlaying && reason != null) onEnded(reason)
  }

  private fun requestFocus(): Boolean {
    val attrs = attributes()
    return if (Build.VERSION.SDK_INT >= 26) {
      val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()
      focusRequest = req
      audio.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) ==
        AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
  }

  private fun abandonFocus() {
    if (Build.VERSION.SDK_INT >= 26) {
      focusRequest?.let { audio.abandonAudioFocusRequest(it) }
      focusRequest = null
    } else {
      @Suppress("DEPRECATION") audio.abandonAudioFocus(focusListener)
    }
  }

  private fun attributes() =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()

  private fun vibrate() {
    val v = vibrator ?: return
    // Half a second on, a second off — never continuous.
    val timings = longArrayOf(0, 500, 1000)
    if (Build.VERSION.SDK_INT >= 26) {
      val amplitudes = intArrayOf(0, if (v.hasAmplitudeControl()) 160 else VibrationEffect.DEFAULT_AMPLITUDE, 0)
      v.vibrate(VibrationEffect.createWaveform(timings, amplitudes, 0))
    } else {
      @Suppress("DEPRECATION") v.vibrate(timings, 0)
    }
  }

  private fun render(mode: String, durationMs: Long) {
    val rate = SAMPLE_RATE
    val minBuf = AudioTrack.getMinBufferSize(rate, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val track = AudioTrack.Builder()
      .setAudioAttributes(attributes())
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(rate)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
          .build(),
      )
      .setBufferSizeInBytes(maxOf(minBuf, rate / 5 * 2))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
    try {
      track.play()
      val chunk = ShortArray(rate / 20)
      var phase = 0.0
      var n = 0L
      val total = rate * durationMs / 1000
      while (playing && n < total) {
        for (i in chunk.indices) {
          val t = (n + i).toDouble() / rate
          val freq = ToneShape.frequency(mode, t)
          phase += 2 * PI * freq / rate
          if (phase > 2 * PI) phase -= 2 * PI
          // Short fade in/out avoids clicks; level stays below full scale.
          val env = ToneShape.envelope(mode, t, durationMs / 1000.0)
          chunk[i] = (sin(phase) * env * AMPLITUDE * Short.MAX_VALUE).toInt().toShort()
        }
        track.write(chunk, 0, chunk.size)
        n += chunk.size
      }
    } catch (_: Exception) {
      main.post { stop("error") }
    } finally {
      try {
        track.stop()
      } catch (_: IllegalStateException) {
        // Never started.
      }
      track.release()
    }
  }

  companion object {
    private const val SAMPLE_RATE = 44_100
    /** 80% of full scale: loud enough to move the speaker, no clipping. */
    private const val AMPLITUDE = 0.8
    /** Hard cap whatever JS asks: two minutes. */
    const val MAX_DURATION_MS = 120_000L
  }
}

/** The tone's frequency and loudness over time (pure; unit tested). */
object ToneShape {
  const val LOW_HZ = 165.0

  fun frequency(mode: String, t: Double): Double =
    when (mode) {
      // 100 → 400 Hz and back every 6 s.
      "sweep" -> {
        val p = (t % 6.0) / 6.0
        val tri = if (p < 0.5) p * 2 else (1 - p) * 2
        100.0 + 300.0 * tri
      }
      else -> LOW_HZ
    }

  fun envelope(mode: String, t: Double, total: Double): Double {
    val fade = minOf(1.0, t / 0.05, (total - t) / 0.05).coerceAtLeast(0.0)
    if (mode != "pulse") return fade
    // 0.6 s on, 0.4 s off, with soft edges.
    val p = t % 1.0
    val gate = when {
      p < 0.03 -> p / 0.03
      p < 0.57 -> 1.0
      p < 0.6 -> (0.6 - p) / 0.03
      else -> 0.0
    }
    return fade * gate
  }
}
