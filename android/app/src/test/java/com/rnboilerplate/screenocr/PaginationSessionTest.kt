package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Scripted pages; speech and timers complete only when the test says so, so
 * the ordering guarantees (no click while speaking, one click per turn, no
 * click after stop) are checked step by step.
 */
class PaginationSessionTest {
  private class Fake(pages: List<String>) : PaginationPorts {
    /** What the screen shows; a successful click advances it. */
    val pages = pages.toMutableList()
    var shown = 0
    var clickTurnsPage = true
    var clickOutcome = ClickOutcome.GESTURE
    val log = ArrayList<String>()
    val spoken = ArrayList<String>()
    var speaking = false
    var speechDone: (() -> Unit)? = null
    val timers = ArrayDeque<() -> Unit>()
    var lastInfo: PaginationInfo? = null

    override fun capture(onOcr: () -> Unit, onResult: (Result<PageSnapshot>) -> Unit) {
      log += "capture"
      onOcr()
      onResult(Result.success(PageSnapshot(pages[shown], shown.toLong())))
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
      speechDone = {
        speaking = false
        onDone()
      }
    }

    override fun stopSpeech() {
      speaking = false
      log += "stopSpeech"
    }

    override fun clickNext(onResult: (ClickOutcome) -> Unit) {
      assertFalse("clicked while speaking", speaking)
      log += "click"
      if (clickOutcome.clicked && clickTurnsPage && shown < pages.size - 1) shown++
      onResult(clickOutcome)
    }

    override fun schedule(delayMs: Long, block: () -> Unit) {
      timers += block
    }

    override fun onStateChanged(state: PaginationState, info: PaginationInfo) {
      lastInfo = info
    }

    fun finishSpeech() = speechDone!!.invoke()

    fun runTimers() {
      while (timers.isNotEmpty()) timers.removeFirst().invoke()
    }

    fun clicks() = log.count { it == "click" }
  }

  private fun page(n: Int) =
    "Page body $n first sentence is here.\nSecond sentence of page $n continues.\nThird line for page $n ends.\n$n"

  private val config = PaginationConfig(pageLoadDelayMs = 100, verifyTimeoutMs = 300, verifyIntervalMs = 100, maxPages = 10)

  @Test
  fun readsAPageCompletelyBeforeClickingNext() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    assertEquals(PaginationState.SPEAKING_PAGE, session.state)
    assertEquals(0, fake.clicks())
    fake.finishSpeech()
    assertEquals(1, fake.clicks())
  }

  @Test
  fun readsPagesInSequenceWithOneClickPerTurn() {
    val fake = Fake(listOf(page(1), page(2), page(3)))
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    fake.runTimers()
    assertEquals(2, session.page)
    fake.finishSpeech()
    fake.runTimers()
    assertEquals(3, session.page)
    assertEquals(2, fake.clicks())
    assertTrue(fake.spoken[1].startsWith("Page body 2"))
    // Bare page numbers are not read aloud.
    assertFalse(fake.spoken[1].lines().contains("2"))
  }

  @Test
  fun aClickThatDoesNotTurnThePageIsNotRepeatedAutomatically() {
    val fake = Fake(listOf(page(1), page(2)))
    fake.clickTurnsPage = false
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    fake.runTimers()
    assertEquals(PaginationState.NEEDS_ATTENTION, session.state)
    assertEquals(PaginationIssue.PAGE_NOT_CHANGED, fake.lastInfo?.issue)
    assertEquals(1, fake.clicks())
    // Several verification captures, but the same page was never spoken twice.
    assertTrue(fake.log.count { it == "capture" } > 2)
    assertEquals(1, fake.spoken.size)
  }

  @Test
  fun retryOnceIsAllowedExactlyOnce() {
    val fake = Fake(listOf(page(1), page(2)))
    fake.clickTurnsPage = false
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    fake.runTimers()
    assertEquals(true, fake.lastInfo?.canRetry)
    session.next()
    fake.runTimers()
    assertEquals(2, fake.clicks())
    assertEquals(false, fake.lastInfo?.canRetry)
    session.next()
    fake.runTimers()
    assertEquals(2, fake.clicks())
  }

  @Test
  fun stopDuringSpeechPreventsAnyLaterClick() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    val late = fake.speechDone!!
    session.stop()
    late()
    fake.runTimers()
    assertEquals(PaginationState.STOPPED, session.state)
    assertEquals(0, fake.clicks())
  }

  @Test
  fun stopWhileWaitingForThePageCancelsVerification() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    val capturesBefore = fake.log.count { it == "capture" }
    session.stop()
    fake.runTimers()
    assertEquals(capturesBefore, fake.log.count { it == "capture" })
    assertEquals(1, fake.spoken.size)
  }

  @Test
  fun pauseNeverClicksAndResumeContinuesThePage() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    val stale = fake.speechDone!!
    session.pause()
    stale()
    assertEquals(PaginationState.PAUSED, session.state)
    assertEquals(0, fake.clicks())
    session.resume()
    assertEquals(PaginationState.SPEAKING_PAGE, session.state)
  }

  @Test
  fun pauseDuringAPageTurnHoldsBeforeReadingTheNewPage() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    session.pause()
    fake.runTimers()
    assertEquals(PaginationState.PAUSED, session.state)
    assertEquals(1, fake.spoken.size)
    session.resume()
    assertEquals(2, fake.spoken.size)
  }

  @Test
  fun aFailedClickStopsAndExplainsWhy() {
    val fake = Fake(listOf(page(1), page(2)))
    fake.clickOutcome = ClickOutcome.NO_PERMISSION
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    assertEquals(PaginationState.NEEDS_ATTENTION, session.state)
    assertEquals(PaginationIssue.NO_PERMISSION, fake.lastInfo?.issue)
    assertEquals(false, fake.lastInfo?.canRetry)
  }

  @Test
  fun returningToAnEarlierPageEndsTheSession() {
    // A viewer that wraps from the last page back to the first.
    val fake = Fake(listOf(page(1), page(2), page(1)))
    val session = PaginationSession(config, fake)
    session.start()
    fake.finishSpeech()
    fake.runTimers()
    fake.finishSpeech()
    fake.runTimers()
    assertEquals(PaginationState.COMPLETED, session.state)
    assertEquals(PaginationIssue.LAST_PAGE, fake.lastInfo?.issue)
    assertEquals(2, fake.spoken.size)
  }

  @Test
  fun stopsAtThePageLimit() {
    val fake = Fake((1..5).map(::page))
    val session = PaginationSession(config.copy(maxPages = 2), fake)
    session.start()
    fake.finishSpeech()
    fake.runTimers()
    fake.finishSpeech()
    assertEquals(PaginationState.COMPLETED, session.state)
    assertEquals(PaginationIssue.PAGE_LIMIT, fake.lastInfo?.issue)
    assertEquals(1, fake.clicks())
  }

  @Test
  fun anEmptyFirstPageIsAnError() {
    val fake = Fake(listOf(""))
    val session = PaginationSession(config, fake)
    session.start()
    assertEquals(PaginationState.ERROR, session.state)
    assertEquals(PaginationIssue.EMPTY_PAGE, fake.lastInfo?.issue)
  }

  @Test
  fun skippingTheRestOfAPageTurnsImmediately() {
    val fake = Fake(listOf(page(1), page(2)))
    val session = PaginationSession(config, fake)
    session.start()
    session.next()
    assertEquals(1, fake.clicks())
    fake.runTimers()
    assertEquals(2, session.page)
  }
}
