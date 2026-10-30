package com.rnboilerplate.recorder

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar

class RecordingStateMachineTest {
  @Test
  fun `a normal segmented session`() {
    val m = RecordingStateMachine()
    assertTrue(m.move(RecordingState.REQUESTING_PERMISSION))
    assertTrue(m.move(RecordingState.PREPARING))
    assertTrue(m.move(RecordingState.RECORDING))
    assertTrue(m.move(RecordingState.FINALIZING_SEGMENT))
    assertTrue(m.move(RecordingState.STARTING_NEXT_SEGMENT))
    assertTrue(m.move(RecordingState.RECORDING))
    assertTrue(m.move(RecordingState.PAUSED))
    assertTrue(m.move(RecordingState.RECORDING))
    assertTrue(m.move(RecordingState.STOPPING))
    assertTrue(m.move(RecordingState.MERGING))
    assertTrue(m.move(RecordingState.VERIFYING_OUTPUT))
    assertTrue(m.move(RecordingState.COMPLETED))
    assertTrue(m.canStart())
  }

  @Test
  fun `refuses a second start and unsafe moves`() {
    val m = RecordingStateMachine(RecordingState.RECORDING)
    assertFalse(m.canStart())
    assertFalse(m.move(RecordingState.PREPARING))
    assertFalse(m.move(RecordingState.MERGING)) // still writing
    assertTrue(m.move(RecordingState.STOPPING))
    // Stop is idempotent: a second Stop is refused, state unchanged.
    assertFalse(m.move(RecordingState.STOPPING))
    assertEquals(RecordingState.STOPPING, m.state)
  }

  @Test
  fun `no stop in the middle of a segment switch`() {
    val m = RecordingStateMachine(RecordingState.FINALIZING_SEGMENT)
    assertFalse(m.move(RecordingState.STOPPING))
    assertFalse(m.move(RecordingState.IDLE))
  }

  @Test
  fun `stored sessions can be merged from idle or after a failure`() {
    assertTrue(RecordingStateMachine(RecordingState.IDLE).move(RecordingState.MERGING))
    assertTrue(RecordingStateMachine(RecordingState.INTERRUPTED).move(RecordingState.MERGING))
    assertTrue(RecordingStateMachine(RecordingState.FAILED).move(RecordingState.MERGING))
    assertFalse(RecordingStateMachine(RecordingState.MERGING).move(RecordingState.MERGING))
  }
}

class RecordingNamesTest {
  private val at = Calendar.getInstance().apply { set(2026, Calendar.OCTOBER, 30, 10, 30, 15) }.time

  @Test
  fun `names follow the documented pattern`() {
    assertEquals("Screenshot_2026-10-30_10-30-15.png", RecordingNames.screenshot(at))
    assertEquals("ScreenRecording_2026-10-30_10-30-15.mp4", RecordingNames.screen(at, merged = false))
    assertEquals("ScreenRecording_2026-10-30_10-30-15_Final.mp4", RecordingNames.screen(at, merged = true))
    assertEquals("VoiceRecording_2026-10-30_10-30-15.m4a", RecordingNames.voice(at, merged = false))
    val session = RecordingNames.sessionId(at)
    assertEquals("Session_20261030_103015", session)
    assertEquals("Session_20261030_103015_Segment_001.mp4", RecordingNames.segment(session, 0, audioOnly = false))
    assertEquals("Session_20261030_103015_Segment_012.m4a", RecordingNames.segment(session, 11, audioOnly = true))
  }

  @Test
  fun `collisions get a number instead of overwriting`() {
    val taken = setOf("a.png", "a (2).png")
    assertEquals("b.png", RecordingNames.unique("b.png") { it in taken })
    assertEquals("a (3).png", RecordingNames.unique("a.png") { it in taken })
  }

  @Test
  fun `renames are sanitised and keep the extension`() {
    assertEquals("Demo.mp4", RecordingNames.sanitizeRename("Demo", "mp4"))
    assertEquals("Demo.mp4", RecordingNames.sanitizeRename("Demo.mp4", "mp4"))
    assertEquals("evil.png", RecordingNames.sanitizeRename("../e/v:i*l", "png"))
    assertNull(RecordingNames.sanitizeRename("  ", "mp4"))
    assertNull(RecordingNames.sanitizeRename("//", "mp4"))
  }
}

class RecorderConfigTest {
  @Test
  fun `round-trips through JSON`() {
    val config =
      RecorderConfig(
        mode = RecorderMode.SCREEN_VOICE,
        audioSource = AudioSource.SYSTEM_MIC,
        segmentMinutes = 1,
        keepSegments = true,
        videoPreset = "custom",
        customVideo = VideoQuality(1080, 60, 9_000_000),
        dirs = mapOf(OutputKind.SCREENSHOT to "content://tree/x"),
      )
    assertEquals(config, RecorderConfig.fromJson(config.toJson()))
  }

  @Test
  fun `a patch changes only what it names and rejects bad values`() {
    val base = RecorderConfig(mode = RecorderMode.VOICE, segmentMinutes = 10)
    val next = RecorderConfig.fromJson(JSONObject("""{"segmentMinutes": 0, "previewSeconds": 8, "videoPreset": "8k"}"""), base)
    assertEquals(RecorderMode.VOICE, next.mode)
    assertEquals(10, next.segmentMinutes) // 0 is out of range
    assertEquals(8, next.previewSeconds)
    assertEquals("medium", next.videoPreset)
  }

  @Test
  fun `segment duration follows the setting`() {
    assertEquals(5 * 60_000_000L, RecorderConfig().segmentDurationUs)
    assertEquals(0L, RecorderConfig(segmentEnabled = false).segmentDurationUs)
  }

  @Test
  fun `defaults match the spec`() {
    val d = RecorderConfig()
    assertTrue(d.segmentEnabled)
    assertEquals(5, d.segmentMinutes)
    assertTrue(d.autoMerge)
    assertFalse(d.autoSaveScreenshot)
    assertEquals(VideoQuality.MEDIUM, d.video)
  }
}

class EncoderSizingTest {
  @Test
  fun `scales the short side to the preset and aligns to 16`() {
    assertEquals(720 to 1600, EncoderSetup.scaledSize(1080, 2400, 720))
    assertEquals(480 to 1072, EncoderSetup.scaledSize(1080, 2400, 480))
    // Landscape keeps its orientation.
    assertEquals(1600 to 720, EncoderSetup.scaledSize(2400, 1080, 720))
  }

  @Test
  fun `never upscales past the screen`() {
    assertEquals(720 to 1280, EncoderSetup.scaledSize(720, 1280, 1080))
  }

  @Test
  fun `storage estimate`() {
    assertEquals(30.96, EncoderSetup.estimateMbPerMinute(4_000_000, 128_000), 0.01)
  }
}
