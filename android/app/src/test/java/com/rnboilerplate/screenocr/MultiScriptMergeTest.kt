package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Test

class MultiScriptMergeTest {
  private fun line(text: String, top: Int, conf: Float = 0.9f) = OcrLine(text, 0, top, 900, top + 40, 0, conf)

  private val A = OcrTextAssembler

  @Test
  fun gujaratiEnglishKeepsMixedGujaratiLinesVerbatim() {
    val sentence = "તમારો Order Successfully Shipped થઈ ગયો છે."
    val merged =
      A.mergeMixed(listOf(line(sentence, 100)), listOf(line("dHIRI Order Successfully Shipped 2 1 9.", 100)), A.GUJARATI)
    assertEquals(sentence, A.assemble(merged))
  }

  @Test
  fun gujaratiEnglishUsesTheLatinReadingForPureEnglishLines() {
    val merged = A.mergeMixed(listOf(line("Track y0ur order", 100)), listOf(line("Track your order", 101)), A.GUJARATI)
    assertEquals("Track your order", A.assemble(merged))
  }

  @Test
  fun gujaratiIsNotAForeignMisreadInGujaratiModes() {
    assertEquals(false, A.hasForeignIndic("નમસ્તે", A.GUJARATI))
    assertEquals(true, A.hasForeignIndic("নমস্তে", A.GUJARATI))
    assertEquals(true, A.hasForeignIndic("નમસ્તે", A.DEVANAGARI))
  }

  @Test
  fun hindiGujaratiPicksTheEngineThatReadItsOwnScript() {
    // Hindi line: the Devanagari model is confident; Tesseract forced it into Gujarati.
    // Gujarati line: the reverse.
    val dev = listOf(line("नमस्ते दुनिया", 100, 0.92f), line("तमारं ओर्डर", 200, 0.41f))
    val guj = listOf(line("નમસ્તે દુનિયા", 100, 0.38f), line("તમારું ઓર્ડર", 200, 0.88f))
    val merged = A.mergeByConfidence(dev, A.DEVANAGARI, guj, A.GUJARATI)
    assertEquals("नमस्ते दुनिया\n\nતમારું ઓર્ડર", A.assemble(merged))
  }

  @Test
  fun hindiGujaratiKeepsLinesOnlyOneEngineFound() {
    val merged =
      A.mergeByConfidence(listOf(line("केवल हिन्दी", 100)), A.DEVANAGARI, listOf(line("માત્ર ગુજરાતી", 300)), A.GUJARATI)
    assertEquals("केवल हिन्दी\n\nમાત્ર ગુજરાતી", A.assemble(merged))
  }

  @Test
  fun everyOcrModeParsesAndLegacyMixedMeansHindiEnglish() {
    assertEquals(7, OcrMode.entries.size)
    assertEquals(OcrMode.HINDI_ENGLISH, OcrMode.from("mixed"))
    assertEquals(OcrMode.ALL, OcrMode.from("all"))
    assertEquals(OcrMode.HINDI_ENGLISH, OcrMode.from("klingon"))
    assertEquals(FloatingAction.SPEAK_SCROLL, FloatingAction.from("speak_scroll"))
    assertEquals(FloatingAction.COPY, FloatingAction.from(null))
  }
}
