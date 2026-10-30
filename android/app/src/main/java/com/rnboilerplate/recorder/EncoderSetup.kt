package com.rnboilerplate.recorder

import android.media.MediaCodecInfo
import android.media.MediaCodecList
import android.media.MediaFormat
import android.os.Build
import kotlin.math.roundToInt

/** The video settings actually applied after checking the device's encoder. */
data class VideoPlan(val width: Int, val height: Int, val fps: Int, val bitrate: Int, val encoderName: String?)

/**
 * Fits the requested quality to the screen and to what the AVC encoder on
 * this phone supports: never forces an unsupported size, frame rate or
 * bitrate. The short side follows the preset (480/720/1080), never larger
 * than the screen; sizes are multiples of 16 (encoder friendly).
 */
object EncoderSetup {
  const val VIDEO_MIME = MediaFormat.MIMETYPE_VIDEO_AVC
  const val AUDIO_MIME = MediaFormat.MIMETYPE_AUDIO_AAC

  /** Pure sizing: scales [screenW]x[screenH] so its short side is ≤ [targetShort]. */
  fun scaledSize(screenW: Int, screenH: Int, targetShort: Int): Pair<Int, Int> {
    val short = minOf(screenW, screenH).coerceAtLeast(1)
    val scale = minOf(1.0, targetShort.toDouble() / short)
    fun align(v: Double) = ((v / 16.0).roundToInt() * 16).coerceAtLeast(16)
    return align(screenW * scale) to align(screenH * scale)
  }

  private fun encoderInfo(): MediaCodecInfo? =
    MediaCodecList(MediaCodecList.REGULAR_CODECS).codecInfos.filter { info ->
      info.isEncoder && info.supportedTypes.any { it.equals(VIDEO_MIME, ignoreCase = true) }
    }.sortedBy { info ->
      // Prefer hardware encoders: lower power over hours of recording.
      val hw = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) info.isHardwareAccelerated else !info.name.startsWith("OMX.google", true) && !info.name.startsWith("c2.android", true)
      if (hw) 0 else 1
    }.firstOrNull()

  fun plan(screenW: Int, screenH: Int, quality: VideoQuality): VideoPlan {
    val info = encoderInfo()
    val caps = info?.getCapabilitiesForType(VIDEO_MIME)?.videoCapabilities
    var target = quality.height
    var size = scaledSize(screenW, screenH, target)
    if (caps != null) {
      // Step the short side down until the encoder accepts the size.
      while (target > 240 && !caps.isSizeSupported(size.first, size.second)) {
        target -= 120
        size = scaledSize(screenW, screenH, target)
      }
    }
    var fps = quality.fps
    var bitrate = quality.bitrate
    if (caps != null) {
      val rates = try { caps.getSupportedFrameRatesFor(size.first, size.second) } catch (_: Exception) { null }
      if (rates != null) fps = fps.coerceIn(rates.lower.toInt().coerceAtLeast(1), rates.upper.toInt().coerceAtLeast(1))
      bitrate = bitrate.coerceIn(caps.bitrateRange.lower, caps.bitrateRange.upper)
    }
    return VideoPlan(size.first, size.second, fps, bitrate, info?.name)
  }

  fun videoFormat(plan: VideoPlan): MediaFormat =
    MediaFormat.createVideoFormat(VIDEO_MIME, plan.width, plan.height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, plan.bitrate)
      setInteger(MediaFormat.KEY_FRAME_RATE, plan.fps)
      // A key frame every second keeps segment boundaries close to the
      // requested interval (a segment can only start on a key frame).
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      // Static screens still produce frames, so timing stays continuous.
      setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 1_000_000L / plan.fps)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER, plan.fps.toFloat())
    }

  fun audioFormat(quality: AudioQuality): MediaFormat =
    MediaFormat.createAudioFormat(AUDIO_MIME, quality.sampleRate, quality.channels).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, quality.bitrate)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
    }

  /** Rough MB per minute for the settings screen's storage estimate. */
  fun estimateMbPerMinute(videoBitrate: Int, audioBitrate: Int): Double =
    (videoBitrate + audioBitrate) * 60.0 / 8.0 / 1_000_000.0
}
