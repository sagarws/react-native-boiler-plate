package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PageChangeTest {
  private val page1 =
    "Chapter 1\nThe river runs past the old temple.\nPilgrims gather every morning.\nThe bells ring at dawn.\nPage 1 of 20"
  private val page2 =
    "Chapter 1\nBoats carry flowers across the water.\nChildren play on the steps.\nEvening lamps are lit.\nPage 2 of 20"

  @Test
  fun differentTextIsANewPage() {
    assertTrue(PageChangeDetector.isNewPage(PageSnapshot(page1, 0), PageSnapshot(page2, 0)))
  }

  @Test
  fun transientChangesDoNotCountAsANewPage() {
    // Same page, re-captured: one OCR wobble and a clock-like line changed.
    val again = page1.replace("Pilgrims gather", "Pilgrims gathér").replace("Page 1 of 20", "Page 1 of 20 12:31")
    assertFalse(PageChangeDetector.isNewPage(PageSnapshot(page1, 0), PageSnapshot(again, 0)))
  }

  @Test
  fun imageOnlyPagesUseTheImageFingerprint() {
    val a = PageSnapshot("", 0L)
    assertFalse(PageChangeDetector.isNewPage(a, PageSnapshot("", 0b111L)))
    assertTrue(PageChangeDetector.isNewPage(a, PageSnapshot("", 0xFFFFL)))
  }

  @Test
  fun recognisesARepeatOfAPageAlreadyRead() {
    val seen = listOf(PageSnapshot(page1, 0), PageSnapshot(page2, 0))
    assertTrue(PageChangeDetector.isRepeatOf(PageSnapshot(page1, 0), seen))
    assertFalse(PageChangeDetector.isRepeatOf(PageSnapshot("A brand new page\nwith other sentences\nand more text here", 0), seen))
  }

  @Test
  fun dHashIsStableAndSensitive() {
    val flat = IntArray(72) { 128 }
    val gradient = IntArray(72) { 255 - (it % 9) * 25 }
    assertEquals(0L, PageChangeDetector.dHash(flat))
    assertEquals(64, PageChangeDetector.hammingDistance(PageChangeDetector.dHash(flat), PageChangeDetector.dHash(gradient)))
  }

  @Test
  fun stripsRepeatedHeadersFootersAndPageNumbersOnly() {
    val stripped = PageText.stripChrome(page2, previous = page1)
    assertEquals("Boats carry flowers across the water.\nChildren play on the steps.\nEvening lamps are lit.", stripped)
  }

  @Test
  fun keepsRepeatedSentencesInTheBody() {
    val previous = "Header\nRepeat after me.\nSomething\nFooter"
    val current = "Intro line\nRepeat after me.\nMore body\nClosing words"
    assertEquals(current, PageText.stripChrome(current, previous))
  }

  @Test
  fun recognisesPageNumberFormats() {
    for (s in listOf("12", "Page 3", "3 / 10", "page 4 of 9", "- 7 -", "पृष्ठ ५", "પાનું ૩")) {
      assertTrue(s, PageText.isPageNumber(s))
    }
    assertFalse(PageText.isPageNumber("Chapter 12 begins"))
  }
}
