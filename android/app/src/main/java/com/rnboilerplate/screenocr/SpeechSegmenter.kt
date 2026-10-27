package com.rnboilerplate.screenocr

/**
 * One utterance: text, the speech language ("en", "hi", "gu") to read it in,
 * and whether a paragraph ends after it (a short pause follows).
 */
data class SpeechSegment(val text: String, val language: String, val paragraphEnd: Boolean = false)

/**
 * Turns extracted text into utterances, **paragraph by paragraph**.
 *
 * OCR lines are first joined into paragraphs ([ParagraphText]) so the engine
 * reads running text instead of pausing at every screen line. Each paragraph
 * is one utterance while it fits the engine's input limit; a longer one is
 * split at sentence ends (. ! ? । ॥), then at commas/spaces as a last resort —
 * never at the original line breaks. Paragraph ends are marked so the player
 * can leave a natural pause between paragraphs.
 *
 * Language: Android voices are per-language, and switching voices mid
 * sentence sounds broken, so the choice is made **per sentence**: a sentence
 * containing Gujarati is read by a Gujarati voice, Devanagari by a Hindi
 * voice, otherwise English — but only when [switchByScript] is on and a voice
 * for that language is in `available`. Otherwise the user's `primary`
 * language is used. Consecutive sentences in the same language within a
 * paragraph stay in one utterance; Hindi and Gujarati voices read embedded
 * English words themselves, so mixed sentences keep a single voice.
 */
object SpeechSegmenter {
  private val SENTENCE_END = Regex("(?<=[.!?।॥])\\s+")
  private val DEVANAGARI = Regex("[\\u0900-\\u097F]")
  private val GUJARATI = Regex("[\\u0A80-\\u0AFF]")
  private val LATIN_LETTER = Regex("[A-Za-z]")

  fun languageFor(sentence: String, primary: String, switchByScript: Boolean, available: Set<String>): String {
    if (!switchByScript) return primary
    val wanted =
      when {
        GUJARATI.containsMatchIn(sentence) -> "gu"
        DEVANAGARI.containsMatchIn(sentence) -> "hi"
        LATIN_LETTER.containsMatchIn(sentence) -> "en"
        else -> primary
      }
    return if (wanted in available) wanted else primary
  }

  fun segment(
    text: String,
    primary: String,
    switchByScript: Boolean,
    available: Set<String>,
    maxLength: Int = 500,
  ): List<SpeechSegment> {
    val segments = ArrayList<SpeechSegment>()
    for (paragraph in ParagraphText.paragraphs(text)) {
      val start = segments.size
      val sentences =
        paragraph.split(SENTENCE_END).map { it.trim() }.filter { it.isNotEmpty() }.flatMap { split(it, maxLength) }
      for (sentence in sentences) {
        val language = languageFor(sentence, primary, switchByScript, available)
        val last = segments.lastOrNull()
        // Join within the paragraph only — paragraphs always start a new utterance.
        if (segments.size > start && last != null && last.language == language &&
          last.text.length + sentence.length + 1 <= maxLength
        ) {
          segments[segments.size - 1] = last.copy(text = "${last.text} $sentence")
        } else {
          segments += SpeechSegment(sentence, language)
        }
      }
      if (segments.size > start) {
        segments[segments.size - 1] = segments.last().copy(paragraphEnd = true)
      }
    }
    return segments
  }

  /** Splits one over-long sentence at commas, then spaces, then hard. */
  private fun split(sentence: String, maxLength: Int): List<String> {
    if (sentence.length <= maxLength) return listOf(sentence)
    val parts = ArrayList<String>()
    var rest = sentence
    while (rest.length > maxLength) {
      val window = rest.substring(0, maxLength)
      val cut =
        window.lastIndexOf(',').takeIf { it > maxLength / 2 }
          ?: window.lastIndexOf(' ').takeIf { it > maxLength / 2 }
          ?: maxLength
      parts += rest.substring(0, cut + if (cut < maxLength) 1 else 0).trim()
      rest = rest.substring(cut + if (cut < maxLength) 1 else 0).trim()
    }
    if (rest.isNotEmpty()) parts += rest
    return parts
  }
}
