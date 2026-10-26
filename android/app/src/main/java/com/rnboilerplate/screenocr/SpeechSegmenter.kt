package com.rnboilerplate.screenocr

/** One utterance: text and the speech language ("en", "hi", "gu") to read it in. */
data class SpeechSegment(val text: String, val language: String)

/**
 * Splits extracted text into utterances.
 *
 * Text is cut at line breaks and sentence ends (. ! ? । ॥), then long
 * sentences at commas/spaces, so no utterance exceeds the engine's input
 * limit and pause/resume can restart from a nearby point.
 *
 * Language: Android voices are per-language, and switching voices mid
 * sentence sounds broken, so the choice is made **per sentence**: a sentence
 * containing Gujarati is read by a Gujarati voice, Devanagari by a Hindi
 * voice, otherwise English — but only when [switchByScript] is on and a voice
 * for that language is in [available]. Otherwise the user's [primary]
 * language is used. Hindi and Gujarati voices read embedded English words
 * themselves, so mixed sentences keep a single voice.
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
    val sentences =
      text.lines()
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .flatMap { it.split(SENTENCE_END) }
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .flatMap { split(it, maxLength) }
    // Adjacent sentences in the same language are joined (up to the limit)
    // so the engine gets natural phrasing, not one request per line.
    val segments = ArrayList<SpeechSegment>()
    for (sentence in sentences) {
      val language = languageFor(sentence, primary, switchByScript, available)
      val last = segments.lastOrNull()
      if (last != null && last.language == language && last.text.length + sentence.length + 1 <= maxLength) {
        segments[segments.size - 1] = last.copy(text = "${last.text}\n$sentence")
      } else {
        segments += SpeechSegment(sentence, language)
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
