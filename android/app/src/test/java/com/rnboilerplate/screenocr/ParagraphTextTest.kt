package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParagraphTextTest {
  @Test
  fun joinsTheLinesOfEachParagraphAndKeepsGenuineBreaks() {
    val ocr =
      "Ocean management is an important\npart of protecting marine ecosystems.\nIt helps reduce pollution and\npreserve biodiversity.\n\nEffective management requires\nplanning and monitoring."
    assertEquals(
      listOf(
        "Ocean management is an important part of protecting marine ecosystems. It helps reduce pollution and preserve biodiversity.",
        "Effective management requires planning and monitoring.",
      ),
      ParagraphText.paragraphs(ocr),
    )
  }

  @Test
  fun keepsBulletAndNumberedItemsSeparate() {
    val ocr = "Steps:\n1. Open the app\n2. Tap the button and\nwait\n• Copy text\n- Share it\n૧) પહેલું પગલું\n२) दूसरा कदम"
    assertEquals(
      listOf(
        "Steps:",
        "1. Open the app",
        "2. Tap the button and wait",
        "• Copy text",
        "- Share it",
        "૧) પહેલું પગલું",
        "२) दूसरा कदम",
      ),
      ParagraphText.paragraphs(ocr),
    )
  }

  @Test
  fun preservesHindiGujaratiAndMixedTextExactly() {
    val hindi = "आपका ऑर्डर सफलतापूर्वक\nभेज दिया गया है।"
    val gujarati = "તમારું ઓર્ડર સફળતાપૂર્વક\nમોકલી દેવામાં આવ્યું છે."
    val mixed = "તમારો Order Successfully\nShipped થઈ ગયો છે."
    assertEquals(listOf("आपका ऑर्डर सफलतापूर्वक भेज दिया गया है।"), ParagraphText.paragraphs(hindi))
    assertEquals(listOf("તમારું ઓર્ડર સફળતાપૂર્વક મોકલી દેવામાં આવ્યું છે."), ParagraphText.paragraphs(gujarati))
    assertEquals(listOf("તમારો Order Successfully Shipped થઈ ગયો છે."), ParagraphText.paragraphs(mixed))
  }

  @Test
  fun keepsPunctuationNumbersAndSymbols() {
    val ocr = "Price: ₹1,299.00 (incl. 18% GST)\n— offer ends 31/12!"
    assertEquals(listOf("Price: ₹1,299.00 (incl. 18% GST) — offer ends 31/12!"), ParagraphText.paragraphs(ocr))
  }

  @Test
  fun normalisesWhitespaceAndEmptyLines() {
    val ocr = "  first   line  \n\n\n\n   second\t\tline \n   \n"
    assertEquals(listOf("first line", "second line"), ParagraphText.paragraphs(ocr))
    assertEquals(emptyList<String>(), ParagraphText.paragraphs(" \n\n \t "))
  }

  @Test
  fun rejoinsAWordHyphenatedAcrossLines() {
    assertEquals(listOf("Effective management matters."), ParagraphText.paragraphs("Effective manage-\nment matters."))
    // A real hyphenated compound before a capital stays as written.
    assertEquals(listOf("Hindi- English"), ParagraphText.paragraphs("Hindi-\nEnglish"))
  }

  @Test
  fun neverLosesWords() {
    val ocr = (1..40).joinToString("\n") { i -> if (i % 7 == 0) "" else "line $i has words" }
    val before = ocr.split(Regex("\\s+")).filter { it.isNotBlank() }
    val after = ParagraphText.paragraphs(ocr).flatMap { it.split(" ") }
    assertEquals(before, after)
  }

  @Test
  fun keepLinesPreservesParagraphBreaksBetweenSurvivors() {
    val text = "Header\nKeep one\nkeep two\n\nDrop me\n\nKeep three"
    val kept = ParagraphText.keepLines(text) { _, line -> line != "Header" && line != "Drop me" }
    assertEquals("Keep one\nkeep two\n\nKeep three", kept)
    assertTrue(ParagraphText.paragraphs(kept).size == 2)
  }
}
