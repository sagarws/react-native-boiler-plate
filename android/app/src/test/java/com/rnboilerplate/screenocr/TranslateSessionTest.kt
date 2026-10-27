package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TranslateSessionTest {
  private class Fake(var screen: String = "Your order has shipped.") : TranslatePorts {
    val log = ArrayList<String>()
    var translationDone: ((Result<TranslationResult>) -> Unit)? = null
    var speechDone: (() -> Unit)? = null
    var spoken = ArrayList<String>()
    var lastInfo: TranslateInfo? = null

    override fun capture(onOcr: () -> Unit, onResult: (Result<String>) -> Unit) {
      log += "capture"
      onOcr()
      onResult(Result.success(screen))
    }

    override fun translate(text: String, onResult: (Result<TranslationResult>) -> Unit) {
      log += "translate"
      translationDone = onResult
    }

    override fun cancelTranslation() {
      log += "cancel"
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
      speechDone = onDone
    }

    override fun stopSpeech() {
      log += "stopSpeech"
    }

    override fun onStateChanged(state: TranslateState, info: TranslateInfo) {
      lastInfo = info
    }

    fun translated(text: String, language: String = "en") =
      translationDone!!.invoke(Result.success(TranslationResult(text, language)))
  }

  @Test
  fun speaksOnlyAfterTheTranslationArrives() {
    val fake = Fake()
    val session = TranslateSession(fake)
    session.start()
    assertEquals(TranslateState.TRANSLATING, session.state)
    assertFalse(fake.log.contains("speak"))
    fake.translated("आपका ऑर्डर भेज दिया गया है।")
    assertEquals(TranslateState.SPEAKING, session.state)
    assertEquals(listOf("आपका ऑर्डर भेज दिया गया है।"), fake.spoken)
    assertEquals("en", fake.lastInfo?.detectedLanguage)
    fake.speechDone!!.invoke()
    assertEquals(TranslateState.COMPLETE, session.state)
  }

  @Test
  fun stopCancelsTheRequestAndIgnoresALateResult() {
    val fake = Fake()
    val session = TranslateSession(fake)
    session.start()
    session.stop()
    assertTrue(fake.log.contains("cancel"))
    fake.translated("late")
    assertEquals(TranslateState.STOPPED, session.state)
    assertTrue(fake.spoken.isEmpty())
  }

  @Test
  fun aTranslationErrorIsReportedNotSpoken() {
    val fake = Fake()
    val session = TranslateSession(fake)
    session.start()
    fake.translationDone!!.invoke(Result.failure(TranslateException(TranslateError.INVALID_KEY)))
    assertEquals(TranslateState.ERROR, session.state)
    assertEquals(TranslateError.INVALID_KEY, fake.lastInfo?.error)
    assertTrue(fake.spoken.isEmpty())
  }

  @Test
  fun pauseWhileTranslatingHoldsBeforeSpeaking() {
    val fake = Fake()
    val session = TranslateSession(fake)
    session.start()
    session.pause()
    fake.translated("translated text")
    assertEquals(TranslateState.PAUSED, session.state)
    assertTrue(fake.spoken.isEmpty())
    session.resume()
    assertEquals(listOf("translated text"), fake.spoken)
  }

  @Test
  fun pauseAndResumeDuringSpeech() {
    val fake = Fake()
    val session = TranslateSession(fake)
    session.start()
    fake.translated("one. two.")
    val stale = fake.speechDone!!
    session.pause()
    stale()
    assertEquals(TranslateState.PAUSED, session.state)
    session.resume()
    assertEquals(TranslateState.SPEAKING, session.state)
  }

  @Test
  fun emptyScreenEndsWithoutCallingGemini() {
    val fake = Fake(screen = "  ")
    val session = TranslateSession(fake)
    session.start()
    assertEquals(TranslateState.COMPLETE, session.state)
    assertEquals(TranslateIssue.NO_TEXT, fake.lastInfo?.issue)
    assertFalse(fake.log.contains("translate"))
  }
}
