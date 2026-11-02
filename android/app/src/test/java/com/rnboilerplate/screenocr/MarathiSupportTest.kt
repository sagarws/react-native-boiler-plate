package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Marathi: same Devanagari recogniser as Hindi, Marathi voice and translation. */
class MarathiSupportTest {
  private val all = setOf("en", "hi", "mr", "gu")
  private val marathi = "तुमची ऑर्डर यशस्वीरित्या पाठवली आहे."

  @Test
  fun marathiModesUseTheDevanagariRecogniser() {
    val mr = OcrMode.from("marathi")
    assertEquals(OcrMode.MARATHI, mr)
    assertTrue(mr.devanagari && mr.marathi && !mr.latin && !mr.gujarati)
    val mixed = OcrMode.from("marathi_english")
    assertTrue(mixed.devanagari && mixed.latin && mixed.marathi)
    assertFalse(OcrMode.HINDI.marathi)
  }

  @Test
  fun devanagariIsReadInMarathiForMarathiSpeechOrMode() {
    assertEquals("mr", SpeechSegmenter.devanagariLanguage("mr", marathiMode = false))
    assertEquals("mr", SpeechSegmenter.devanagariLanguage("en", marathiMode = true))
    assertEquals("hi", SpeechSegmenter.devanagariLanguage("en", marathiMode = false))
    assertEquals("hi", SpeechSegmenter.devanagariLanguage("hi", marathiMode = false))
  }

  @Test
  fun marathiTextGetsAMarathiVoice() {
    val text = "Order update. $marathi"
    val segments = SpeechSegmenter.segment(text, "en", true, all, devanagari = "mr")
    assertEquals(listOf("en", "mr"), segments.map { it.language })
  }

  @Test
  fun fallsBackToPrimaryWhenNoMarathiVoiceIsInstalled() {
    val segments = SpeechSegmenter.segment(marathi, "en", true, setOf("en", "hi"), devanagari = "mr")
    assertEquals("en", segments.single().language)
  }

  @Test
  fun hindiStaysTheDefaultForDevanagari() {
    val segments = SpeechSegmenter.segment("नमस्ते दोस्तों।", "en", true, all)
    assertEquals("hi", segments.single().language)
  }

  @Test
  fun marathiIsASpeechAndTranslationLanguage() {
    assertTrue("mr" in OcrConfig.SPEECH_LANGUAGES)
    assertEquals("Marathi", TranslationPrompt.languageName("mr"))
  }
}
