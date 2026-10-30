package com.rnboilerplate.recorder

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.os.Build

/**
 * 16-bit PCM from system playback capture, the microphone, or both summed.
 *
 * System audio is Android's AudioPlaybackCapture (API 29+, over the screen
 * capture consent): it hears only media/game/unknown-usage playback from
 * apps that allow capture — never calls, and not apps that opt out (often
 * DRM video/music). Each chunk carries a CLOCK_MONOTONIC presentation time
 * from AudioRecord's own timestamp, the same clock as screen frames, so
 * audio and video stay in sync over hours instead of drifting.
 */
class PcmSource private constructor(
  private val system: AudioRecord?,
  private val mic: AudioRecord?,
  val sampleRate: Int,
  val channels: Int,
) {
  private val timestamp = AudioTimestamp()
  private var framesRead = 0L
  private var startNs = 0L
  private var lastPtsUs = Long.MIN_VALUE
  private var micScratch = ShortArray(0)

  val hasSystem: Boolean
    get() = system != null

  val hasMic: Boolean
    get() = mic != null

  fun start() {
    system?.startRecording()
    mic?.startRecording()
    startNs = System.nanoTime()
  }

  /**
   * Fills [out] (blocking, real-time paced). Returns the chunk's start time
   * in µs (monotonic), or -1 when a read failed.
   */
  fun read(out: ShortArray): Long {
    val primary = system ?: mic ?: return -1
    var filled = 0
    while (filled < out.size) {
      val n = primary.read(out, filled, out.size - filled)
      if (n < 0) return -1
      filled += n
    }
    if (system != null && mic != null) {
      if (micScratch.size != out.size) micScratch = ShortArray(out.size)
      var m = 0
      while (m < micScratch.size) {
        val n = mic.read(micScratch, m, micScratch.size - m)
        if (n < 0) break
        m += n
      }
      for (i in 0 until m) out[i] = (out[i] + micScratch[i]).coerceIn(-32768, 32767).toShort()
    }
    val frames = out.size / channels
    val pts = ptsFor(primary, framesRead)
    framesRead += frames
    // Never go backwards (the muxer rejects it).
    val safe = if (pts <= lastPtsUs) lastPtsUs + 1 else pts
    lastPtsUs = safe
    return safe
  }

  private fun ptsFor(record: AudioRecord, frame: Long): Long {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N &&
      record.getTimestamp(timestamp, AudioTimestamp.TIMEBASE_MONOTONIC) == AudioRecord.SUCCESS
    ) {
      return timestamp.nanoTime / 1000 + (frame - timestamp.framePosition) * 1_000_000L / sampleRate
    }
    return startNs / 1000 + frame * 1_000_000L / sampleRate
  }

  fun release() {
    for (r in listOfNotNull(system, mic)) {
      try {
        r.stop()
      } catch (_: IllegalStateException) {
      }
      r.release()
    }
  }

  /** Why a requested source couldn't open (the recording continues without it). */
  enum class Missing { SYSTEM_UNSUPPORTED, SYSTEM_FAILED, MIC_FAILED }

  data class Opened(val source: PcmSource?, val missing: Set<Missing>)

  companion object {
    @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the service first.
    fun open(want: AudioSource, projection: MediaProjection?, quality: AudioQuality): Opened {
      val missing = mutableSetOf<Missing>()
      val mask = if (quality.channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO
      val format =
        AudioFormat.Builder()
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .setSampleRate(quality.sampleRate)
          .setChannelMask(mask)
          .build()
      val min = AudioRecord.getMinBufferSize(quality.sampleRate, mask, AudioFormat.ENCODING_PCM_16BIT)
      val buffer = maxOf(min * 4, quality.sampleRate * quality.channels) // ≥ 0.5 s

      var system: AudioRecord? = null
      if (want.system) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || projection == null) {
          missing += Missing.SYSTEM_UNSUPPORTED
        } else {
          system =
            try {
              val config =
                AudioPlaybackCaptureConfiguration.Builder(projection)
                  .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                  .addMatchingUsage(AudioAttributes.USAGE_GAME)
                  .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                  .build()
              AudioRecord.Builder()
                .setAudioFormat(format)
                .setBufferSizeInBytes(buffer)
                .setAudioPlaybackCaptureConfig(config)
                .build()
                .takeIf { it.state == AudioRecord.STATE_INITIALIZED }
            } catch (_: Exception) {
              null
            }
          if (system == null) missing += Missing.SYSTEM_FAILED
        }
      }
      var mic: AudioRecord? = null
      if (want.mic) {
        mic =
          try {
            AudioRecord.Builder()
              .setAudioSource(MediaRecorder.AudioSource.MIC)
              .setAudioFormat(format)
              .setBufferSizeInBytes(buffer)
              .build()
              .takeIf { it.state == AudioRecord.STATE_INITIALIZED }
          } catch (_: Exception) {
            null
          }
        if (mic == null) missing += Missing.MIC_FAILED
      }
      if (system == null && mic == null) return Opened(null, missing)
      return Opened(PcmSource(system, mic, quality.sampleRate, quality.channels), missing)
    }
  }
}
