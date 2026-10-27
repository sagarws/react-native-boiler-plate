package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Drives [ReadingSession] with scripted screens; speech completes only when the test says so. */
class ReadingSessionTest {
  private class FakePorts(screens: List<String>, var scrollable: Boolean = true) : ReadingPorts {
    val screens = ArrayDeque(screens)
    val log = ArrayList<String>()
    val spoken = ArrayList<String>()
    var speechDone: (() -> Unit)? = null
    var lastInfo: ReadingInfo? = null
    var speaking = false
    var fromSegment = -1

    override fun captureText(onOcr: () -> Unit, onResult: (Result<String>) -> Unit) {
      log += "capture"
      assertFalse("captured while speaking", speaking)
      onOcr()
      val next = if (screens.size > 1) screens.removeFirst() else screens.firstOrNull() ?: ""
      onResult(Result.success(next))
    }

    override fun speak(
      text: String,
      fromSegment: Int,
      onProgress: (Int, Int) -> Unit,
      onDone: () -> Unit,
      onError: (ReadingReason) -> Unit,
    ) {
      log += "speak"
      spoken += text
      speaking = true
      this.fromSegment = fromSegment
      onProgress(fromSegment, 3)
      speechDone = {
        speaking = false
        onDone()
      }
    }

    override fun stopSpeech() {
      speaking = false
      log += "stopSpeech"
    }

    override fun canScroll() = scrollable

    override fun scroll(onResult: (Boolean) -> Unit) {
      log += "scroll"
      assertFalse("scrolled while speaking", speaking)
      onResult(true)
    }

    override fun schedule(delayMs: Long, block: () -> Unit) = block()

    override fun onStateChanged(state: ReadingState, info: ReadingInfo) {
      lastInfo = info
    }

    fun finishSpeech() = speechDone!!.invoke()
  }

  private val config = ReadingConfig(autoScroll = true, maxSections = 10, maxNoNewText = 2, manualFallback = true)

  @Test
  fun speakOnlyModeReadsOnceAndNeverScrolls() {
    val ports = FakePorts(listOf("Line A\nLine B"))
    val session = ReadingSession(autoScrollMode = false, config = config, ports = ports)
    session.start()
    assertEquals(ReadingState.SPEAKING, session.state)
    ports.finishSpeech()
    assertEquals(ReadingState.COMPLETE, session.state)
    assertFalse(ports.log.contains("scroll"))
  }

  @Test
  fun scrollsOnlyAfterSpeechFinishesAndSkipsRepeatedText() {
    val ports =
      FakePorts(
        listOf(
          "Header\nPara 1 is long enough\nPara 2 is long enough",
          "Header\nPara 2 is long enough\nPara 3 is long enough",
          "Header\nPara 3 is long enough",
        ),
      )
    val session = ReadingSession(true, config, ports)
    session.start()
    assertEquals(listOf("capture", "speak"), ports.log)

    ports.finishSpeech()
    assertEquals("Para 3 is long enough", ports.spoken[1])
    assertEquals(listOf("capture", "speak", "scroll", "capture", "speak"), ports.log)

    // Screens with nothing new, twice in a row → end of page, no endless scrolling.
    ports.finishSpeech()
    assertEquals(ReadingState.COMPLETE, session.state)
    assertEquals(ReadingReason.END_OF_PAGE, ports.lastInfo?.reason)
    assertEquals(2, ports.spoken.size)
  }

  @Test
  fun pauseAndResumeContinueFromTheCurrentSegment() {
    val ports = FakePorts(listOf("One. Two. Three."))
    val session = ReadingSession(false, config, ports)
    session.start()
    session.pause()
    assertEquals(ReadingState.PAUSED, session.state)
    assertTrue(ports.log.contains("stopSpeech"))
    session.resume()
    assertEquals(ReadingState.SPEAKING, session.state)
    assertEquals(0, ports.fromSegment)
  }

  @Test
  fun stopIgnoresLateCallbacks() {
    val ports = FakePorts(listOf("Text here"))
    val session = ReadingSession(true, config, ports)
    session.start()
    val late = ports.speechDone!!
    session.stop()
    late()
    assertEquals(ReadingState.STOPPED, session.state)
    assertFalse(ports.log.contains("scroll"))
  }

  @Test
  fun pausedSpeechCannotTriggerAScroll() {
    val ports = FakePorts(listOf("Some text", "More text"))
    val session = ReadingSession(true, config, ports)
    session.start()
    val stale = ports.speechDone!!
    session.pause()
    stale()
    assertEquals(ReadingState.PAUSED, session.state)
    assertFalse(ports.log.contains("scroll"))
  }

  @Test
  fun withoutAutoScrollItWaitsForTheUserThenContinues() {
    val ports = FakePorts(listOf("First screen text", "Second screen text"), scrollable = false)
    val session = ReadingSession(true, config, ports)
    session.start()
    ports.finishSpeech()
    assertEquals(ReadingState.WAITING_FOR_SCROLL, session.state)
    assertEquals(true, ports.lastInfo?.manual)
    session.next()
    assertEquals("Second screen text", ports.spoken.last())
  }

  @Test
  fun sectionLimitStopsTheSession() {
    val ports = FakePorts((1..5).map { "Unique screen number $it" })
    val session = ReadingSession(true, config.copy(maxSections = 2), ports)
    session.start()
    ports.finishSpeech()
    ports.finishSpeech()
    assertEquals(ReadingState.COMPLETE, session.state)
    assertEquals(ReadingReason.SECTION_LIMIT, ports.lastInfo?.reason)
  }

  @Test
  fun emptyFirstScreenEndsWithNoText() {
    val ports = FakePorts(listOf(""))
    val session = ReadingSession(true, config, ports)
    session.start()
    assertEquals(ReadingState.COMPLETE, session.state)
    assertEquals(ReadingReason.NO_TEXT, ports.lastInfo?.reason)
  }

  @Test
  fun nextSkipsTheRestOfTheSection() {
    val ports = FakePorts(listOf("Screen one text", "Screen two text"))
    val session = ReadingSession(true, config, ports)
    session.start()
    session.next()
    assertEquals("Screen two text", ports.spoken.last())
  }

  @Test
  fun newTextAfterAScrollKeepsItsParagraphBreaks() {
    val ports =
      FakePorts(
        listOf(
          "Old paragraph line one\nold paragraph line two",
          "old paragraph line two\n\nNew paragraph starts here\nand continues\n\nAnother new paragraph",
        ),
      )
    val session = ReadingSession(true, config, ports)
    session.start()
    ports.finishSpeech()
    assertEquals("New paragraph starts here\nand continues\n\nAnother new paragraph", ports.spoken[1])
    assertEquals(
      listOf("New paragraph starts here and continues", "Another new paragraph"),
      ParagraphText.paragraphs(ports.spoken[1]),
    )
  }

  @Test
  fun restartReadsTheSectionAgainFromTheStart() {
    val ports = FakePorts(listOf("Section text"))
    val session = ReadingSession(true, config, ports)
    session.start()
    session.restartSection()
    assertEquals(listOf("Section text", "Section text"), ports.spoken)
    assertEquals(0, ports.fromSegment)
  }
}
