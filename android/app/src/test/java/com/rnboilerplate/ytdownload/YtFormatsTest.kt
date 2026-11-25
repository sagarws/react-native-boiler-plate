package com.rnboilerplate.ytdownload

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class YtFormatsTest {
  private fun video(itag: Int, height: Int, container: String, codec: String, fps: Int = 30, bitrate: Int = 1_000_000, size: Long = -1) =
    StreamCandidate(itag, "u$itag", container, codec, bitrate, size, height, fps)

  private fun audio(itag: Int, container: String, codec: String, bitrate: Int) = StreamCandidate(itag, "u$itag", container, codec, bitrate, -1)

  // Same shape as the captured X7pNbK8ATiE player response.
  private val videos =
    listOf(
      video(313, 2160, "webm", "vp9"),
      video(401, 2160, "mp4", "av01.0.12m.08"),
      video(137, 1080, "mp4", "avc1.640028", size = 270_000_000),
      video(248, 1080, "webm", "vp9"),
      video(399, 1080, "mp4", "av01.0.08m.08"),
      video(136, 720, "mp4", "avc1.4d401f"),
    )
  private val audios = listOf(audio(140, "mp4", "mp4a.40.2", 130_000), audio(251, "webm", "opus", 140_000), audio(250, "webm", "opus", 80_000))

  @Test
  fun `prefers H264 mp4, falls back to VP9 webm for 4K`() {
    val options = YtFormats.videoOptions(videos, audios, 1000, sdk = 33)
    assertEquals(listOf("2160p", "1080p", "720p"), options.map { it.label })
    assertEquals("v313_a251", options[0].id)
    assertEquals(OutputFormat.WEBM, options[0].output)
    assertEquals("v137_a140", options[1].id)
    assertEquals(OutputFormat.MP4, options[1].output)
  }

  @Test
  fun `AV1 only when MediaMuxer supports it`() {
    val av1Only = listOf(video(401, 2160, "mp4", "av01.0.12m.08"))
    assertTrue(YtFormats.videoOptions(av1Only, audios, 1000, sdk = 33).isEmpty())
    assertEquals("v401_a140", YtFormats.videoOptions(av1Only, audios, 1000, sdk = 34).single().id)
  }

  @Test
  fun `size uses content length, else bitrate times duration`() {
    val hd = YtFormats.videoOptions(videos, audios, 1000, sdk = 33).first { it.label == "1080p" }
    assertEquals(270_000_000L + 130_000L * 1000 / 8, hd.sizeBytes)
  }

  @Test
  fun `high frame rate shows in the label`() {
    val options = YtFormats.videoOptions(listOf(video(299, 1080, "mp4", "avc1.64002a", fps = 60)), audios, 10, sdk = 33)
    assertEquals("1080p60", options.single().label)
  }

  @Test
  fun `audio options - best AAC and best Opus`() {
    val options = YtFormats.audioOptions(audios, 1000, sdk = 33)
    assertEquals(listOf("a251", "a140"), options.map { it.id })
    assertEquals(OutputFormat.OGG, options[0].output)
    assertEquals(OutputFormat.M4A, options[1].output)
    assertEquals(OutputFormat.WEBM_AUDIO, YtFormats.audioOptions(audios, 1000, sdk = 28)[0].output)
  }

  @Test
  fun `file names are safe`() {
    assertEquals("a_b_ c (1080p).mp4", YtFormats.fileName("a/b: c", "1080p", "mp4"))
    assertEquals("video (128 kbps).m4a", YtFormats.fileName("  ...  ", "128 kbps", "m4a"))
  }
}
