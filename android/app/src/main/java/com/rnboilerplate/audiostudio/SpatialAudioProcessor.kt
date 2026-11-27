package com.rnboilerplate.audiostudio

import android.content.Context
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.rnboilerplate.spatialaudio.SpatialEngine
import com.rnboilerplate.spatialaudio.SpatialParams
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Process-wide hand-off between JS (setDspParams / getDspState, any thread)
 * and the audio processor (ExoPlayer's playback thread). Each setDspParams
 * publishes a new array, so the processor only crosses JNI when it changed.
 */
object SpatialDsp {
  @Volatile var params: FloatArray? = null
    private set

  @Volatile var state: FloatArray = FloatArray(SpatialParams.STATE_COUNT)
    internal set

  fun setParams(values: FloatArray) {
    val next = (params ?: FloatArray(SpatialParams.COUNT)).copyOf(maxOf(SpatialParams.COUNT, values.size))
    values.copyInto(next)
    params = next
  }
}

/**
 * Renders every decoded sample through [SpatialEngine]. Accepts 16-bit or
 * float PCM, mono, stereo or multichannel (5.1, 7.1, 7.1.4 … are folded to
 * stereo first by [Downmix]), any sample rate; outputs stereo in the input's
 * encoding. Sits first in the sink's processor chain, so Sonic (speed with
 * pitch preserved) runs after it on the already-spatialised signal.
 *
 * All callbacks run on ExoPlayer's playback thread; the engine is never
 * touched from anywhere else.
 */
@OptIn(UnstableApi::class)
class SpatialAudioProcessor : BaseAudioProcessor() {
  private var engine: SpatialEngine? = null
  private var appliedParams: FloatArray? = null
  private var lastStateReadMs = 0L
  /** Only used when the sink hands over a heap buffer (the engine needs direct memory). */
  private var scratch: ByteBuffer = EMPTY
  /** Multichannel input folded to stereo (direct, same encoding). */
  private var mix: ByteBuffer = EMPTY

  override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
    val encoding = inputAudioFormat.encoding
    if ((encoding != C.ENCODING_PCM_16BIT && encoding != C.ENCODING_PCM_FLOAT) ||
      inputAudioFormat.channelCount !in 1..MAX_CHANNELS
    ) {
      throw AudioProcessor.UnhandledAudioFormatException(inputAudioFormat)
    }
    return AudioProcessor.AudioFormat(inputAudioFormat.sampleRate, 2, encoding)
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val inFrame = inputAudioFormat.bytesPerFrame
    val frames = inputBuffer.remaining() / inFrame
    if (frames == 0) return
    val inBytes = frames * inFrame
    val outBytes = frames * outputAudioFormat.bytesPerFrame
    val output = replaceOutputBuffer(outBytes)
    val current = engine
    if (current == null) {
      // Not flushed yet (cannot happen in the sink's order); pass through as stereo.
      passThrough(inputBuffer, frames, output)
    } else {
      applyParams(current)
      val channels = inputAudioFormat.channelCount
      val isFloat = inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT
      // JNI reads from the buffer's base address, so hand it a view that starts at position().
      val input =
        if (channels > 2) {
          val need = frames * 2 * (if (isFloat) 4 else 2)
          if (mix.capacity() < need) mix = ByteBuffer.allocateDirect(need).order(ByteOrder.nativeOrder())
          mix.clear()
          Downmix.toStereo(inputBuffer.duplicate().order(ByteOrder.nativeOrder()), channels, frames, isFloat, mix)
          mix.flip()
          mix
        } else if (inputBuffer.isDirect) {
          inputBuffer.slice()
        } else {
          if (scratch.capacity() < inBytes) scratch = ByteBuffer.allocateDirect(inBytes).order(ByteOrder.nativeOrder())
          scratch.clear()
          scratch.put(inputBuffer.duplicate().apply { limit(position() + inBytes) })
          scratch.flip()
          scratch
        }
      current.process(input, minOf(channels, 2), output, frames, isFloat)
      inputBuffer.position(inputBuffer.position() + inBytes)
      output.position(0)
      output.limit(outBytes)
      readState(current)
    }
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    val rate = inputAudioFormat.sampleRate
    val current = engine
    if (current != null && current.sampleRate == rate) {
      current.reset()
    } else {
      current?.close()
      engine = SpatialEngine(rate)
      appliedParams = null
    }
  }

  override fun onReset() {
    engine?.close()
    engine = null
    appliedParams = null
    scratch = EMPTY
    mix = EMPTY
    SpatialDsp.state = FloatArray(SpatialParams.STATE_COUNT)
  }

  private fun applyParams(current: SpatialEngine) {
    val latest = SpatialDsp.params ?: return
    if (latest !== appliedParams) {
      current.setParams(latest)
      appliedParams = latest
    }
  }

  private fun readState(current: SpatialEngine) {
    val now = SystemClock.elapsedRealtime()
    if (now - lastStateReadMs >= STATE_INTERVAL_MS) {
      lastStateReadMs = now
      SpatialDsp.state = current.state()
    }
  }

  private fun passThrough(input: ByteBuffer, frames: Int, output: ByteBuffer) {
    val sample = if (inputAudioFormat.encoding == C.ENCODING_PCM_FLOAT) 4 else 2
    val channels = inputAudioFormat.channelCount
    val bytes = ByteArray(sample)
    repeat(frames) {
      input.get(bytes)
      output.put(bytes)
      if (channels == 1) output.put(bytes) else { input.get(bytes); output.put(bytes) }
      // Further channels of a multichannel frame are dropped here (only reached before flush).
      repeat(maxOf(0, channels - 2)) { input.get(bytes) }
    }
    output.flip()
  }

  private companion object {
    const val STATE_INTERVAL_MS = 100L
    /** 7.1.4 / 9.1.6 and other immersive layouts decode to up to 16 channels. */
    const val MAX_CHANNELS = 24
    val EMPTY: ByteBuffer = ByteBuffer.allocateDirect(0)
  }
}

/**
 * Folds multichannel PCM to stereo (ITU-style: centre and surrounds at −3 dB
 * into their side, LFE at −6 dB into both), then scales so the busiest side
 * cannot exceed full scale — multichannel music (e.g. Samsung's 7.1.4 demo
 * tracks) would otherwise be rejected by the stereo engine.
 *
 * Decoders deliver channels in Android's mask order with absent ones
 * skipped, so each common channel count maps to one layout; other counts
 * alternate left/right.
 */
internal object Downmix {
  private const val L = 0
  private const val R = 1
  private const val C = 2
  private const val LFE = 3
  private const val BL = 4
  private const val BR = 5
  private const val SL = 6
  private const val SR = 7
  private const val BC = 8
  private const val TL = 9
  private const val TR = 10

  private fun layout(n: Int): IntArray =
    when (n) {
      3 -> intArrayOf(L, R, C)
      4 -> intArrayOf(L, R, BL, BR)
      5 -> intArrayOf(L, R, C, BL, BR)
      6 -> intArrayOf(L, R, C, LFE, BL, BR)
      7 -> intArrayOf(L, R, C, LFE, BL, BR, BC)
      8 -> intArrayOf(L, R, C, LFE, BL, BR, SL, SR)
      10 -> intArrayOf(L, R, C, LFE, BL, BR, TL, TR, TL, TR)
      12 -> intArrayOf(L, R, C, LFE, BL, BR, SL, SR, TL, TR, TL, TR)
      else -> IntArray(n) { if (it % 2 == 0) L else R }
    }

  private val cache = HashMap<Int, FloatArray>()

  /** Interleaved [gainL, gainR] per channel, normalised. */
  fun gains(n: Int): FloatArray =
    cache.getOrPut(n) {
      val g = FloatArray(n * 2)
      layout(n).forEachIndexed { i, role ->
        val (l, r) =
          when (role) {
            L -> 1f to 0f
            R -> 0f to 1f
            C -> 0.707f to 0.707f
            LFE -> 0.5f to 0.5f
            BL, SL, TL -> 0.707f to 0f
            BR, SR, TR -> 0f to 0.707f
            else -> 0.5f to 0.5f
          }
        g[2 * i] = l
        g[2 * i + 1] = r
      }
      var sumL = 0f
      var sumR = 0f
      for (i in 0 until n) {
        sumL += g[2 * i]
        sumR += g[2 * i + 1]
      }
      // Uncorrelated channels rarely peak together: allow 1.6× the plain sum's headroom.
      val norm = minOf(1f, 1.6f / maxOf(sumL, sumR, 1f))
      for (i in g.indices) g[i] *= norm
      g
    }

  fun toStereo(input: ByteBuffer, channels: Int, frames: Int, float: Boolean, out: ByteBuffer) {
    val g = gains(channels)
    repeat(frames) {
      var l = 0f
      var r = 0f
      for (c in 0 until channels) {
        val v = if (float) input.getFloat() else input.getShort() / 32768f
        l += v * g[2 * c]
        r += v * g[2 * c + 1]
      }
      if (float) {
        out.putFloat(l)
        out.putFloat(r)
      } else {
        out.putShort((l.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
        out.putShort((r.coerceIn(-1f, 1f) * 32767f).toInt().toShort())
      }
    }
  }
}

/** ExoPlayer audio renderers whose sink runs [SpatialAudioProcessor] before Sonic. */
@OptIn(UnstableApi::class)
class SpatialRenderersFactory(context: Context) : DefaultRenderersFactory(context) {
  override fun buildAudioSink(
    context: Context,
    enableFloatOutput: Boolean,
    enableAudioTrackPlaybackParams: Boolean,
  ): AudioSink =
    DefaultAudioSink
      .Builder(context)
      // 16-bit output: the engine handles both, and 16-bit keeps AudioTrack buffers small.
      .setEnableFloatOutput(false)
      // Chain: [SpatialAudioProcessor] → SilenceSkipping → Sonic (speed, pitch kept).
      .setAudioProcessorChain(DefaultAudioSink.DefaultAudioProcessorChain(SpatialAudioProcessor()))
      .build()
}
