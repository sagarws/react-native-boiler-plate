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
    assertEquals(listOf(SpeechSegment(text, "gu", paragraphEnd = true)), segments)
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
  fun readsAParagraphAsOneUtteranceInsteadOfLineByLine() {
    val ocr =
      "Ocean management is an important\npart of protecting marine ecosystems.\nIt helps reduce pollution and\npreserve biodiversity.\n\nEffective management requires\nplanning and monitoring."
    val segments = SpeechSegmenter.segment(ocr, "en", switchByScript = true, available = all)
    assertEquals(
      listOf(
        SpeechSegment(
          "Ocean management is an important part of protecting marine ecosystems. It helps reduce pollution and preserve biodiversity.",
          "en",
          paragraphEnd = true,
        ),
        SpeechSegment("Effective management requires planning and monitoring.", "en", paragraphEnd = true),
      ),
      segments,
    )
    // No utterance contains an OCR line break.
    assertTrue(segments.none { '\n' in it.text })
  }

  @Test
  fun aLongParagraphSplitsAtSentenceEndsNotLineBreaks() {
    val sentence = "This sentence is about forty characters."
    // Six sentences wrapped into OCR lines of ~30 characters at word boundaries.
    val words = List(6) { sentence }.joinToString(" ").split(" ")
    val ocr =
      words
        .fold(mutableListOf("")) { lines, word ->
          if (lines.last().length + word.length > 30) lines += word
          else lines[lines.size - 1] = (lines.last() + " " + word).trim()
          lines
        }
        .joinToString("\n")
    val segments = SpeechSegmenter.segment(ocr, "en", false, all, maxLength = 100)
    assertTrue(segments.size > 1)
    assertTrue(segments.all { it.text.length <= 100 && it.text.endsWith(".") })
    assertEquals(listOf(false, true), listOf(segments.first().paragraphEnd, segments.last().paragraphEnd))
  }

  @Test
  fun hindiAndGujaratiParagraphsSplitAtTheirOwnSentenceMarks() {
    val ocr = "पहला वाक्य है। दूसरा\nवाक्य है।\n\nપહેલું વાક્ય. બીજું\nવાક્ય."
    val segments = SpeechSegmenter.segment(ocr, "hi", switchByScript = true, available = all)
    assertEquals(
      listOf(
        SpeechSegment("पहला वाक्य है। दूसरा वाक्य है।", "hi", paragraphEnd = true),
        SpeechSegment("પહેલું વાક્ય. બીજું વાક્ય.", "gu", paragraphEnd = true),
      ),
      segments,
    )
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
