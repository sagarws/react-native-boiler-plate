package com.rnboilerplate.audiostudio

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DownmixTest {
  private fun mix(channels: Int, frame: FloatArray): FloatArray {
    val input = ByteBuffer.allocate(channels * 4).order(ByteOrder.nativeOrder())
    frame.forEach { input.putFloat(it) }
    input.flip()
    val out = ByteBuffer.allocate(8).order(ByteOrder.nativeOrder())
    Downmix.toStereo(input, channels, 1, true, out)
    out.flip()
    return floatArrayOf(out.getFloat(), out.getFloat())
  }

  @Test fun `5_1 keeps left on the left and centre in both`() {
    val left = mix(6, floatArrayOf(1f, 0f, 0f, 0f, 0f, 0f))
    assertTrue(left[0] > 0f)
    assertEquals(0f, left[1], 0f)
    val centre = mix(6, floatArrayOf(0f, 0f, 1f, 0f, 0f, 0f))
    assertEquals(centre[0], centre[1], 1e-6f)
  }

  @Test fun `7_1_4 rear right goes right only and full-scale input cannot pass 1_6`() {
    val rearRight = mix(12, FloatArray(12).also { it[5] = 1f })
    assertEquals(0f, rearRight[0], 0f)
    assertTrue(rearRight[1] > 0f)
    val all = mix(12, FloatArray(12) { 1f })
    assertTrue(all[0] <= 1.6001f && all[1] <= 1.6001f)
  }

  @Test fun `16-bit path clamps`() {
    val input = ByteBuffer.allocate(12 * 2).order(ByteOrder.nativeOrder())
    repeat(12) { input.putShort(Short.MAX_VALUE) }
    input.flip()
    val out = ByteBuffer.allocate(4).order(ByteOrder.nativeOrder())
    Downmix.toStereo(input, 12, 1, false, out)
    out.flip()
    assertEquals(Short.MAX_VALUE, out.getShort())
  }
}
