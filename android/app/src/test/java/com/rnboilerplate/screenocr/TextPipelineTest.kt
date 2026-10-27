package com.rnboilerplate.screenocr

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TextPipelineTest {
  /** Records calls; each step completes only when the test says so. */
  private class Fake : PipelinePorts {
    val calls = ArrayList<String>()
    var refineDone: ((Result<TranslationResult>) -> Unit)? = null
    var translateDone: ((Result<TranslationResult>) -> Unit)? = null

    override fun refine(text: String, onResult: (Result<TranslationResult>) -> Unit) {
      calls += "refine:$text"
      refineDone = onResult
    }

    override fun translate(text: String, onResult: (Result<TranslationResult>) -> Unit) {
      calls += "translate:$text"
      translateDone = onResult
    }
  }

  private fun ok(text: String, lang: String = "") = Result.success(TranslationResult(text, lang))

  @Test
  fun refinesFirstThenTranslatesTheRefinedText() {
    val fake = Fake()
    val stages = ArrayList<PipelineStage>()
    var result: ProcessedText? = null
    TextPipeline(fake).process("Th e qu ick fox", refine = true, translate = true, onStage = { stages += it }) {
      result = it.getOrThrow()
    }
    assertEquals(listOf("refine:Th e qu ick fox"), fake.calls)
    fake.refineDone!!.invoke(ok("The quick fox"))
    // Translation receives the refined text, not the raw OCR.
    assertEquals("translate:The quick fox", fake.calls.last())
    fake.translateDone!!.invoke(ok("तेज़ लोमड़ी", "en"))
    assertEquals(listOf(PipelineStage.REFINING, PipelineStage.TRANSLATING), stages)
    assertEquals(ProcessedText("Th e qu ick fox", "The quick fox", TranslationResult("तेज़ लोमड़ी", "en")), result)
    assertEquals("तेज़ लोमड़ी", result!!.finalText)
  }

  @Test
  fun refineOnlyUsesTheRefinedTextForCopyAndSpeech() {
    val fake = Fake()
    var result: ProcessedText? = null
    TextPipeline(fake).process("brok-\nen", refine = true, translate = false, onStage = {}) { result = it.getOrThrow() }
    fake.refineDone!!.invoke(ok("broken"))
    assertEquals("broken", result!!.finalText)
    assertNull(result!!.translation)
    assertFalse(fake.calls.any { it.startsWith("translate") })
  }

  @Test
  fun translateOnlySkipsRefinement() {
    val fake = Fake()
    TextPipeline(fake).process("Hello", refine = false, translate = true, onStage = {}) {}
    assertEquals(listOf("translate:Hello"), fake.calls)
  }

  @Test
  fun aFailedRefinementStopsTheRunAndIsReported() {
    val fake = Fake()
    var failure: Throwable? = null
    TextPipeline(fake).process("x", refine = true, translate = true, onStage = {}) { failure = it.exceptionOrNull() }
    fake.refineDone!!.invoke(Result.failure(TranslateException(TranslateError.QUOTA)))
    assertEquals(TranslateError.QUOTA, (failure as TranslateException).error)
    assertFalse(fake.calls.any { it.startsWith("translate") })
  }

  @Test
  fun cancelDropsLateResults() {
    val fake = Fake()
    var delivered = false
    val pipeline = TextPipeline(fake)
    pipeline.process("x", refine = true, translate = false, onStage = {}) { delivered = true }
    pipeline.cancel()
    fake.refineDone!!.invoke(ok("late"))
    assertFalse(delivered)
  }

  @Test
  fun refineRequestCarriesThePromptAndSharedGeminiSettings() {
    val body =
      RefinePrompt.requestBody(
        RefineConfig(enabled = true, prompt = "Fix old-book OCR."),
        TranslateConfig(thinkingLevel = "medium"),
        "Tbe olcl book",
        withThinking = true,
      ).toString()
    assertTrue(body.contains("Fix old-book OCR."))
    assertTrue(body.contains("Tbe olcl book"))
    assertTrue(body.contains("\"thinkingLevel\":\"medium\""))
    assertTrue(body.contains("\"refined\""))
    assertTrue(RefinePrompt.systemInstruction(RefineConfig(prompt = " ")).contains("Do not add, remove, summarise"))
  }

  @Test
  fun parsesRefinedTextAndFallsBackToPlainText() {
    val structured = """{"candidates":[{"content":{"parts":[{"text":"{\"refined\":\"The old book\"}"}]}}]}"""
    assertEquals("The old book", RefinePrompt.parse(structured).getOrThrow().text)
    val plain = """{"candidates":[{"content":{"parts":[{"text":"The old book"}]}}]}"""
    assertEquals("The old book", RefinePrompt.parse(plain).getOrThrow().text)
    val empty = """{"candidates":[{"content":{"parts":[{"text":"{\"refined\":\"\"}"}]}}]}"""
    assertEquals(TranslateError.BAD_RESPONSE, (RefinePrompt.parse(empty).exceptionOrNull() as TranslateException).error)
  }

  @Test
  fun refineSettingsParseWithDefaults() {
    val config = OcrConfig.fromJson(JSONObject("""{"refine":{"enabled":true}}"""))
    assertTrue(config.refine.enabled)
    assertEquals(RefinePrompt.DEFAULT_PROMPT, config.refine.prompt)
    assertFalse(OcrConfig.fromJson(JSONObject("{}")).refine.enabled)
  }
}
