package com.rnboilerplate.spatialaudio

import java.nio.ByteBuffer

/**
 * The native spatial audio engine (libspatialaudio). One instance per audio
 * stream: create it for the stream's sample rate, feed interleaved stereo
 * blocks to [process], change settings from any thread with [setParams]
 * (applied smoothly at the next block), and [close] it when done.
 *
 * Buffers must be direct ByteBuffers (no copies across JNI). Input and output
 * may be the same buffer. Mono input is accepted (channels = 1) and rendered
 * to stereo.
 */
class SpatialEngine(val sampleRate: Int) : AutoCloseable {
  private var handle: Long = nativeCreate(sampleRate)

  /** Full parameter array (see [SpatialParams]); safe from any thread. */
  fun setParams(params: FloatArray) {
    require(params.size >= SpatialParams.COUNT) { "params" }
    if (handle != 0L) nativeSetParams(handle, params)
  }

  /**
   * Processes [frames] frames. [inChannels] 1 or 2; output is always
   * stereo. [float] true = 32-bit float samples, false = 16-bit PCM.
   */
  fun process(input: ByteBuffer, inChannels: Int, output: ByteBuffer, frames: Int, float: Boolean) {
    if (handle != 0L) nativeProcess(handle, input, inChannels, output, frames, float)
  }

  /** Clears delay lines and reverb tails (seek / new track). */
  fun reset() {
    if (handle != 0L) nativeReset(handle)
  }

  /** Current source position and output meters, see SpatialParams.STATE_*. */
  fun state(): FloatArray {
    val out = FloatArray(SpatialParams.STATE_COUNT)
    if (handle != 0L) nativeState(handle, out)
    return out
  }

  override fun close() {
    val h = handle
    handle = 0L
    if (h != 0L) nativeDestroy(h)
  }

  private external fun nativeCreate(sampleRate: Int): Long
  private external fun nativeDestroy(handle: Long)
  private external fun nativeSetParams(handle: Long, params: FloatArray)
  private external fun nativeProcess(handle: Long, input: ByteBuffer, inChannels: Int, output: ByteBuffer, frames: Int, float: Boolean)
  private external fun nativeReset(handle: Long)
  private external fun nativeState(handle: Long, out: FloatArray)

  companion object {
    init {
      System.loadLibrary("spatialaudio")
    }
  }
}
