package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechSegmenterTest {
  private val all = setOf("en", "hi", "gu")

  @Test
  fun picksAVoicePerSentenceByScript() {
    val text = "Hello there. नमस्ते दोस्तों। નમસ્તે મિત્રો."
    val segments = SpeechSegmenter.segment(text, "en", switchByScript = true, available = all)
    assertEquals(listOf("en", "hi", "gu"), segments.map { it.language })
  }

  @Test
  fun mixedSentencesKeepOneVoice() {
    val text = "તમારો Order Successfully Shipped થઈ ગયો છે."
    val segments = SpeechSegmenter.segment(text, "en", switchByScript = true, available = all)
    assertEquals(listOf(SpeechSegment(text, "gu")), segments)
  }

  @Test
  fun fallsBackToThePrimaryLanguageWhenTheScriptVoiceIsMissing() {
    val segments = SpeechSegmenter.segment("નમસ્તે.", "en", switchByScript = true, available = setOf("en"))
    assertEquals("en", segments.single().language)
  }

  @Test
  fun noSwitchingUsesThePrimaryLanguageThroughout() {
    val segments = SpeechSegmenter.segment("Hi. नमस्ते।", "hi", switchByScript = false, available = all)
    assertTrue(segments.all { it.language == "hi" })
  }

  @Test
  fun longTextIsSplitUnderTheLimitWithoutLosingWords() {
    val text = (1..200).joinToString(" ") { "word$it" }
    val segments = SpeechSegmenter.segment(text, "en", false, all, maxLength = 100)
    assertTrue(segments.size > 1)
    assertTrue(segments.all { it.text.length <= 100 })
    val words = segments.flatMap { it.text.split(Regex("\\s+")) }
    assertEquals(200, words.size)
  }
}
