package com.rnboilerplate.systemaudio

import android.annotation.SuppressLint
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.projection.MediaProjection
import android.os.Build
import android.os.Process
import android.os.SystemClock
import android.util.Log
import androidx.annotation.RequiresApi
import com.rnboilerplate.audiostudio.SpatialDsp
import com.rnboilerplate.spatialaudio.SpatialEngine
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min

/**
 * Route 2 of "Other apps": playback capture → 8D engine → our own output.
 *
 * One dedicated URGENT_AUDIO thread: AudioRecord (playback capture, 48 kHz
 * stereo float, 16-bit fallback) is read in 10 ms blocks, processed by
 * [SpatialEngine] in place of direct buffers, and written to a low-latency
 * AudioTrack of the same rate/format. The loop is paced by the capture
 * (blocking read) and the output (blocking write).
 *
 * Only USAGE_MEDIA / GAME / UNKNOWN are captured — never calls, voice
 * communication or the microphone. Our own output is never re-captured: this
 * app's uid is excluded and the track forbids capture
 * (ALLOW_CAPTURE_BY_NONE). Apps that opt out of capture (or play DRM content)
 * deliver silence; that shows as a growing silentMs, nothing is bypassed.
 */
@RequiresApi(Build.VERSION_CODES.Q)
class PlaybackRenderer(
  private val context: Context,
  private val projection: MediaProjection,
  private val onFatal: (String) -> Unit,
) {
  @Volatile private var running = false
  private var thread: Thread? = null

  fun start() {
    if (running) return
    running = true
    thread = Thread({ run() }, "system-audio-8d").also { it.start() }
  }

  /**
   * Stops and waits briefly (a read returns within one block); the thread
   * releases everything on its way out, so nothing is touched from two threads.
   */
  fun stop() {
    running = false
    thread?.let { if (it !== Thread.currentThread()) it.join(JOIN_MS) }
    thread = null
  }

  private fun run() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val opened = openRecord(float = true) ?: openRecord(float = false)
    if (opened == null) return fail("capture_unavailable")
    val (rec, float) = opened
    val sampleBytes = if (float) 4 else 2
    val blockBytes = BLOCK_FRAMES * CHANNELS * sampleBytes
    val input = ByteBuffer.allocateDirect(blockBytes).order(ByteOrder.nativeOrder())
    val output = ByteBuffer.allocateDirect(blockBytes).order(ByteOrder.nativeOrder())
    val meter = Meter(input, output, float)
    val engine =
      try {
        SpatialEngine(RATE)
      } catch (e: Throwable) { // UnsatisfiedLinkError when the native library is missing.
        Log.w(TAG, "engine: ${e.javaClass.simpleName}")
        rec.release()
        return fail("engine_unavailable")
      }
    var track: AudioTrack? = null
    var trackMode = ""
    var appliedParams: FloatArray? = null
    var underruns = 0
    try {
      rec.startRecording()
      if (rec.recordingState != AudioRecord.RECORDSTATE_RECORDING) return fail("capture_unavailable")
      while (running) {
        val mode = CaptureStatus.outputMode
        if (track == null || mode != trackMode) {
          track?.release()
          track = openTrack(mode, float) ?: return fail("output_failed")
          trackMode = mode
          underruns = track.underrunCount
        }
        val n = rec.read(input, blockBytes, AudioRecord.READ_BLOCKING)
        if (!running) break
        if (n < 0) return fail("capture_lost")
        val frames = n / (CHANNELS * sampleBytes)
        if (frames == 0) continue

        val params = SpatialDsp.params ?: SessionEffects.get(context).params
        if (params != null && params !== appliedParams) {
          engine.setParams(params)
          appliedParams = params
        }
        engine.process(input, CHANNELS, output, frames, float)
        meter.add(frames)

        output.position(0)
        val written = track.write(output, frames * CHANNELS * sampleBytes, AudioTrack.WRITE_BLOCKING)
        output.clear()
        if (written < 0) {
          // Dead track (output route change): rebuild it on the next block.
          track.release()
          track = null
          continue
        }
        // Grow the output buffer one block at a time while it underruns.
        val u = track.underrunCount
        if (u > underruns) {
          underruns = u
          val target = min(track.bufferSizeInFrames + BLOCK_FRAMES, track.bufferCapacityInFrames)
          track.setBufferSizeInFrames(target)
        }
        if (meter.due()) meter.publish(rec.bufferSizeInFrames + track.bufferSizeInFrames)
      }
    } catch (e: Exception) {
      Log.w(TAG, "capture loop: ${e.javaClass.simpleName}")
      if (running) fail("capture_lost")
    } finally {
      runCatching { rec.stop() }
      rec.release()
      track?.let {
        runCatching { it.pause() }
        runCatching { it.flush() }
        it.release()
      }
      engine.close()
    }
  }

  private fun fail(code: String) {
    running = false
    onFatal(code)
  }

  @SuppressLint("MissingPermission") // RECORD_AUDIO checked by SystemAudioModule.startCapture.
  private fun openRecord(float: Boolean): Pair<AudioRecord, Boolean>? {
    val encoding = if (float) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT
    val min = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_STEREO, encoding)
    if (min <= 0) return null
    val blockBytes = BLOCK_FRAMES * CHANNELS * (if (float) 4 else 2)
    return try {
      val config =
        AudioPlaybackCaptureConfiguration.Builder(projection)
          .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
          .addMatchingUsage(AudioAttributes.USAGE_GAME)
          .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
          .excludeUid(Process.myUid())
          .build()
      val format =
        AudioFormat.Builder()
          .setEncoding(encoding)
          .setSampleRate(RATE)
          .setChannelMask(AudioFormat.CHANNEL_IN_STEREO)
          .build()
      val r =
        AudioRecord.Builder()
          .setAudioFormat(format)
          .setBufferSizeInBytes(max(min, blockBytes * 2))
          .setAudioPlaybackCaptureConfig(config)
          .build()
      if (r.state == AudioRecord.STATE_INITIALIZED) {
        r to float
      } else {
        r.release()
        null
      }
    } catch (e: Exception) {
      Log.w(TAG, "record (float=$float): ${e.javaClass.simpleName}")
      null
    }
  }

  private fun openTrack(mode: String, float: Boolean): AudioTrack? {
    val encoding = if (float) AudioFormat.ENCODING_PCM_FLOAT else AudioFormat.ENCODING_PCM_16BIT
    val usage = if (mode == CaptureStatus.MODE_ACCESSIBILITY) AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY else AudioAttributes.USAGE_MEDIA
    val min = AudioTrack.getMinBufferSize(RATE, AudioFormat.CHANNEL_OUT_STEREO, encoding)
    if (min <= 0) return null
    val blockBytes = BLOCK_FRAMES * CHANNELS * (if (float) 4 else 2)
    return try {
      val attributes =
        AudioAttributes.Builder()
          .setUsage(usage)
          .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
          .setAllowedCapturePolicy(AudioAttributes.ALLOW_CAPTURE_BY_NONE)
          .build()
      val t =
        AudioTrack.Builder()
          .setAudioAttributes(attributes)
          .setAudioFormat(
            AudioFormat.Builder()
              .setEncoding(encoding)
              .setSampleRate(RATE)
              .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
              .build(),
          ).setTransferMode(AudioTrack.MODE_STREAM)
          .setPerformanceMode(AudioTrack.PERFORMANCE_MODE_LOW_LATENCY)
          .setBufferSizeInBytes(max(min, blockBytes * 4))
          .build()
      if (t.state != AudioTrack.STATE_INITIALIZED) {
        t.release()
        return null
      }
      // Start small (two blocks); the loop grows it on underruns.
      t.setBufferSizeInFrames(min(BLOCK_FRAMES * 2, t.bufferCapacityInFrames))
      t.play()
      t
    } catch (e: Exception) {
      Log.w(TAG, "track: ${e.javaClass.simpleName}")
      null
    }
  }

  /** RMS of input and output over each ~500 ms window, plus the silence run. */
  private class Meter(input: ByteBuffer, output: ByteBuffer, private val float: Boolean) {
    private val inF = if (float) input.asFloatBuffer() else null
    private val outF = if (float) output.asFloatBuffer() else null
    private val inS = if (float) null else input.asShortBuffer()
    private val outS = if (float) null else output.asShortBuffer()
    private var inSum = 0.0
    private var outSum = 0.0
    private var samples = 0L
    private var silentMs = 0.0
    private var lastPublish = SystemClock.elapsedRealtime()

    fun add(frames: Int) {
      val n = frames * CHANNELS
      var a = 0.0
      var b = 0.0
      if (float) {
        for (i in 0 until n) {
          val x = inF!!.get(i).toDouble()
          val y = outF!!.get(i).toDouble()
          a += x * x
          b += y * y
        }
      } else {
        for (i in 0 until n) {
          val x = inS!!.get(i) / 32768.0
          val y = outS!!.get(i) / 32768.0
          a += x * x
          b += y * y
        }
      }
      inSum += a
      outSum += b
      samples += n
      val blockDb = db(a / n)
      silentMs = if (blockDb < SILENCE_DB) silentMs + frames * 1000.0 / RATE else 0.0
    }

    fun due() = SystemClock.elapsedRealtime() - lastPublish >= PUBLISH_MS

    fun publish(bufferedFrames: Int) {
      lastPublish = SystemClock.elapsedRealtime()
      if (samples > 0) {
        CaptureStatus.inputDb = db(inSum / samples)
        CaptureStatus.outputDb = db(outSum / samples)
      }
      CaptureStatus.silentMs = silentMs.toLong()
      CaptureStatus.latencyMs = (bufferedFrames * 1000L / RATE).toInt()
      inSum = 0.0
      outSum = 0.0
      samples = 0
      SystemAudioEvents.changed()
    }

    private fun db(meanSquare: Double) =
      if (meanSquare <= 1e-12) CaptureStatus.FLOOR_DB else max(CaptureStatus.FLOOR_DB, 10 * log10(meanSquare))
  }

  companion object {
    private const val TAG = "PlaybackRenderer"
    const val RATE = 48_000
    private const val CHANNELS = 2
    /** 10 ms. */
    private const val BLOCK_FRAMES = RATE / 100
    private const val SILENCE_DB = -70.0
    private const val PUBLISH_MS = 500L
    private const val JOIN_MS = 1_000L
  }
}
