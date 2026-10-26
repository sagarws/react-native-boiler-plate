package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TextDedupTest {
  @Test
  fun dropsTheOverlapLeftOnScreenAfterAScroll() {
    val previous = listOf("Title", "Paragraph one is here.", "Paragraph two continues.", "Paragraph three")
    val current = listOf("Title", "Paragraph two continues.", "Paragraph three", "Paragraph four is new.")
    assertEquals(listOf("Paragraph four is new."), TextDedup.newLines(current, previous))
  }

  @Test
  fun toleratesSmallOcrDifferencesBetweenScreenshots() {
    val previous = listOf("તમારો Order Successfully Shipped થઈ ગયો છે.")
    val current = listOf("તમારો Order Successfuly Shipped થઈ ગયો છે", "નવી લાઇન આવી")
    assertEquals(listOf("નવી લાઇન આવી"), TextDedup.newLines(current, previous))
  }

  @Test
  fun keepsGujaratiUnicodeIntact() {
    val line = "તમારું ઓર્ડર સફળતાપૂર્વક મોકલી દેવામાં આવ્યું છે."
    assertEquals(listOf(line), TextDedup.newLines(listOf(line), emptyList()))
  }

  @Test
  fun shortLinesMustMatchExactly() {
    // "12:30" vs "12:31" are different, not fuzzy duplicates.
    assertEquals(listOf("12:31"), TextDedup.newLines(listOf("12:31"), listOf("12:30")))
  }

  @Test
  fun linesThatDifferOnlyInANumberAreDifferent() {
    val previous = listOf("Step 2 of the guide is here", "Price ₹499 only today")
    val current = listOf("Step 3 of the guide is here", "Price ₹699 only today")
    assertEquals(current, TextDedup.newLines(current, previous))
  }

  @Test
  fun sameScreenTwiceHasNothingNew() {
    val screen = listOf("Reply", "Like", "A long comment about the article")
    assertTrue(TextDedup.newLines(screen, screen).isEmpty())
  }
}
