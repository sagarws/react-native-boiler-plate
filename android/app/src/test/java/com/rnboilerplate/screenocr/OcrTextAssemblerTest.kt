package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OcrTextAssemblerTest {
  private fun line(text: String, left: Int, top: Int, right: Int, bottom: Int, block: Int = 0) =
    OcrLine(text, left, top, right, bottom, block)

  @Test
  fun detectsDevanagari() {
    assertTrue(OcrTextAssembler.containsDevanagari("आपका Order"))
    assertTrue(OcrTextAssembler.containsDevanagari("हो गया है।"))
    assertFalse(OcrTextAssembler.containsDevanagari("Order Successfully Shipped 123"))
  }

  @Test
  fun mixedLineFromDevanagariModelIsKeptVerbatim() {
    val sentence = "आपका Order Successfully Shipped हो गया है।"
    val dev = listOf(line(sentence, 10, 100, 900, 140))
    // The Latin model mangles the Hindi words of the same box.
    val latin = listOf(line("3TTCPT Order Successfully Shipped gt 7", 10, 100, 900, 140))

    val merged = OcrTextAssembler.mergeMixed(dev, latin)

    assertEquals(sentence, OcrTextAssembler.assemble(merged))
  }

  @Test
  fun pureLatinLineUsesTheLatinReadingOfTheSameBox() {
    val dev = listOf(line("Order 5uccessfully Shipped", 10, 100, 600, 140))
    val latin = listOf(line("Order Successfully Shipped", 12, 101, 598, 139))

    val merged = OcrTextAssembler.mergeMixed(dev, latin)

    assertEquals("Order Successfully Shipped", OcrTextAssembler.assemble(merged))
  }

  @Test
  fun latinLinesTheDevanagariPassMissedAreAppended() {
    val dev = listOf(line("नमस्ते", 10, 100, 200, 140))
    val latin =
      listOf(line("garbage", 10, 100, 200, 140), line("Track order #4521", 10, 300, 400, 340))

    val text = OcrTextAssembler.assemble(OcrTextAssembler.mergeMixed(dev, latin))

    assertEquals("नमस्ते\nTrack order #4521", text)
  }

  @Test
  fun splitLatinLinesDoNotReplaceALongerLine() {
    // The Latin model split one line into two; neither matches the whole box.
    val dev = listOf(line("Price 499 only", 0, 0, 600, 40))
    val latin = listOf(line("Price", 0, 0, 150, 40), line("499 only", 200, 0, 600, 40))

    val text = OcrTextAssembler.assemble(OcrTextAssembler.mergeMixed(dev, latin))

    assertEquals("Price 499 only", text)
  }

  @Test
  fun assemblesBlocksInReadingOrder() {
    val lines =
      listOf(
        line("Second paragraph", 10, 300, 400, 330, block = 1),
        line("Right column", 500, 100, 800, 130, block = 2),
        line("First line", 10, 100, 300, 130, block = 0),
        line("Next line", 10, 140, 300, 170, block = 0),
      )

    assertEquals(
      "First line\nNext line\nRight column\nSecond paragraph",
      OcrTextAssembler.assemble(lines),
    )
  }

  @Test
  fun emptyAndBlankInputGiveEmptyText() {
    assertEquals("", OcrTextAssembler.assemble(emptyList()))
    assertEquals("", OcrTextAssembler.assemble(listOf(line("   ", 0, 0, 10, 10))))
  }

  @Test
  fun keepsNumbersAndPunctuation() {
    val lines = listOf(line("₹1,299.00 — 50% off!", 0, 0, 500, 40))
    assertEquals("₹1,299.00 — 50% off!", OcrTextAssembler.assemble(lines))
  }

  @Test
  fun misreadInAnotherIndicScriptPrefersTheLatinReading() {
    // Seen on device: the site icon in Chrome's URL bar read as Bengali "ক",
    // widening the box enough to miss the strict match.
    val dev = listOf(line("কhi.wikipedia.orghwiki/", 40, 200, 700, 250))
    val latin = listOf(line("hi.wikipedia.org/wiki/", 190, 202, 700, 248))

    val text = OcrTextAssembler.assemble(OcrTextAssembler.mergeMixed(dev, latin))

    assertEquals("hi.wikipedia.org/wiki/", text)
  }
}
