package com.rnboilerplate.screenocr

import java.text.Normalizer
import kotlin.math.max
import kotlin.math.min

/**
 * Finds the lines of a new screenshot that were not on the previous one.
 *
 * After a scroll, the top of the new screen usually repeats the bottom of the
 * old one, and fixed UI (toolbars, tab bars) repeats on every screen. Both are
 * removed by dropping any line that matches a line of the previous screen.
 * OCR rarely reads the same pixels identically twice, so matching is fuzzy:
 * lines are normalised (Unicode NFC, case, whitespace, punctuation) and
 * compared by edit distance.
 *
 * Only the immediately previous screen is compared, so text that legitimately
 * repeats much further down the page is still read.
 */
object TextDedup {
  /** Lines this similar (0..1) are the same text read twice. */
  private const val SAME_LINE_SIMILARITY = 0.85

  /** Short lines ("OK", "12:30") must match exactly after normalisation. */
  private const val FUZZY_MIN_LENGTH = 6

  private val PUNCTUATION = Regex("[\\p{P}\\p{S}]")
  private val SPACES = Regex("\\s+")

  fun normalize(line: String): String =
    Normalizer.normalize(line, Normalizer.Form.NFC)
      .lowercase()
      .replace(PUNCTUATION, " ")
      .replace(SPACES, " ")
      .trim()

  fun similarity(a: String, b: String): Double {
    if (a == b) return 1.0
    val longest = max(a.length, b.length)
    if (longest == 0) return 1.0
    return 1.0 - levenshtein(a, b).toDouble() / longest
  }

  fun isSameLine(a: String, b: String): Boolean {
    if (a == b) return true
    if (min(a.length, b.length) < FUZZY_MIN_LENGTH) return false
    // "Item 2" and "Item 3", "₹499" and "₹699" are one edit apart but are
    // different lines; numbers must agree for a fuzzy match.
    if (digits(a) != digits(b)) return false
    return similarity(a, b) >= SAME_LINE_SIMILARITY
  }

  private fun digits(s: String): String = s.filter { it.isDigit() }

  /** Lines of [current] (in order) not present on the [previous] screen. */
  fun newLines(current: List<String>, previous: List<String>): List<String> {
    val seen = previous.map(::normalize).filter { it.isNotEmpty() }
    return current.filter { line ->
      val key = normalize(line)
      key.isNotEmpty() && seen.none { isSameLine(it, key) }
    }
  }

  /**
   * [current] text minus the lines already on the [previous] screen, keeping
   * the paragraph breaks between the lines that remain.
   */
  fun newText(current: String, previous: List<String>): String {
    val seen = previous.map(::normalize).filter { it.isNotEmpty() }
    return ParagraphText.keepLines(current) { _, line ->
      val key = normalize(line)
      key.isNotEmpty() && seen.none { isSameLine(it, key) }
    }
  }

  private fun levenshtein(a: String, b: String): Int {
    var prev = IntArray(b.length + 1) { it }
    var curr = IntArray(b.length + 1)
    for (i in 1..a.length) {
      curr[0] = i
      for (j in 1..b.length) {
        val cost = if (a[i - 1] == b[j - 1]) 0 else 1
        curr[j] = minOf(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
      }
      val swap = prev
      prev = curr
      curr = swap
    }
    return prev[b.length]
  }
}
