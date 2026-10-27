package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Test

/** Paragraph breaks decided from OCR geometry in [OcrTextAssembler.assemble]. */
class ParagraphLayoutTest {
  /** A body line: 40 px tall, 12 px leading. */
  private fun line(text: String, top: Int, block: Int = 0, left: Int = 40, height: Int = 40) =
    OcrLine(text, left, top, 1000, top + height, block)

  @Test
  fun consecutiveLinesOfABlockStayOneParagraph() {
    val lines = listOf(line("Ocean management is an important", 100), line("part of protecting marine ecosystems.", 152))
    assertEquals(
      "Ocean management is an important\npart of protecting marine ecosystems.",
      OcrTextAssembler.assemble(lines),
    )
  }

  @Test
  fun aLargeVerticalGapStartsANewParagraph() {
    val lines =
      listOf(
        line("It helps reduce pollution and", 100),
        line("preserve biodiversity.", 152),
        line("Effective management requires", 260),
        line("planning and monitoring.", 312),
      )
    assertEquals(
      "It helps reduce pollution and\npreserve biodiversity.\n\nEffective management requires\nplanning and monitoring.",
      OcrTextAssembler.assemble(lines),
    )
    assertEquals(2, ParagraphText.paragraphs(OcrTextAssembler.assemble(lines)).size)
  }

  @Test
  fun aHeadingInLargerTextIsItsOwnParagraph() {
    val lines =
      listOf(
        line("Ocean Management", 60, height = 64),
        line("Oceans cover most of the planet and", 136),
        line("need careful protection.", 188),
      )
    assertEquals(
      listOf("Ocean Management", "Oceans cover most of the planet and need careful protection."),
      ParagraphText.paragraphs(OcrTextAssembler.assemble(lines)),
    )
  }

  @Test
  fun separateBlocksAreNeverMergedIntoOneParagraph() {
    // Two columns / cells side by side: separate OCR blocks.
    val lines = listOf(line("Name", 100, block = 0, left = 40), line("Price", 100, block = 1, left = 600))
    assertEquals(listOf("Name", "Price"), ParagraphText.paragraphs(OcrTextAssembler.assemble(lines)))
  }

  @Test
  fun aFirstLineIndentStartsAParagraph() {
    val lines =
      listOf(
        line("The first paragraph ends here.", 100),
        line("The second paragraph is indented", 152, left = 140),
        line("and continues on.", 204),
      )
    assertEquals(
      listOf("The first paragraph ends here.", "The second paragraph is indented and continues on."),
      ParagraphText.paragraphs(OcrTextAssembler.assemble(lines)),
    )
  }

  @Test
  fun thresholdsAdaptToTheTextSize() {
    // Small text (20 px, 6 px leading): a 30 px gap is a paragraph break here…
    val small =
      listOf(line("small one", 100, height = 20), line("small two", 126, height = 20), line("small three", 176, height = 20))
    assertEquals(listOf("small one small two", "small three"), ParagraphText.paragraphs(OcrTextAssembler.assemble(small)))
    // …while large text (80 px, 24 px leading) treats a similar gap as normal line spacing.
    val large = listOf(line("large one", 100, height = 80), line("large two", 204, height = 80))
    assertEquals(listOf("large one large two"), ParagraphText.paragraphs(OcrTextAssembler.assemble(large)))
  }

  @Test
  fun hindiAndGujaratiLinesJoinTheSameWay() {
    val lines = listOf(line("આપનો ઓર્ડર", 100), line("મોકલી દેવામાં આવ્યો છે.", 152), line("धन्यवाद।", 260))
    assertEquals(
      listOf("આપનો ઓર્ડર મોકલી દેવામાં આવ્યો છે.", "धन्यवाद।"),
      ParagraphText.paragraphs(OcrTextAssembler.assemble(lines)),
    )
  }
}
