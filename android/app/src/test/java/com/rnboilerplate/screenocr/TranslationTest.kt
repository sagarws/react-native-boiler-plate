package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TranslationTest {
  private val config = TranslateConfig(consent = true, target = "hi", source = "auto")

  @Test
  fun fillsPromptPlaceholders() {
    val instruction =
      TranslationPrompt.systemInstruction(config.copy(prompt = "Translate from {source} to {target} formally.", source = "gu"))
    assertTrue(instruction.startsWith("Translate from Gujarati to Hindi formally."))
    assertTrue(TranslationPrompt.systemInstruction(config).contains("into Hindi"))
    assertTrue(
      TranslationPrompt.systemInstruction(config.copy(prompt = "{source} → {target}")).startsWith("the detected language → Hindi"),
    )
  }

  @Test
  fun blankPromptFallsBackToTheDefaultAndLongPromptsAreCapped() {
    assertTrue(TranslationPrompt.systemInstruction(config.copy(prompt = "  ")).contains("Keep names, numbers"))
    val long = "x".repeat(5000)
    assertTrue(TranslationPrompt.systemInstruction(config.copy(prompt = long)).length < 1500)
  }

  @Test
  fun requestBodyCarriesTextAndInstructionButNeverAKey() {
    val body = TranslationPrompt.requestBody(config, "Hello world").toString()
    assertTrue(body.contains("Hello world"))
    assertTrue(body.contains("systemInstruction"))
    assertTrue(body.contains("\"responseMimeType\":\"application/json\""))
    assertFalse(body.contains("key", ignoreCase = false) && body.contains("AIza"))
  }

  @Test
  fun chunksKeepParagraphOrderAndStayUnderTheLimit() {
    val paragraphs = (1..30).map { "Paragraph $it " + "word ".repeat(30).trim() + "." }
    val chunks = TranslationPrompt.chunks(paragraphs.joinToString("\n\n"), maxChars = 600)
    assertTrue(chunks.size > 1)
    assertTrue(chunks.all { it.length <= 600 })
    val rejoined = chunks.flatMap { it.split("\n\n") }
    assertEquals(paragraphs, rejoined)
  }

  @Test
  fun parsesStructuredTranslationWithDetectedLanguage() {
    val body =
      """{"candidates":[{"content":{"parts":[{"text":"{\"detectedLanguage\":\"GU\",\"translation\":\"आपका ऑर्डर भेज दिया गया है।\"}"}]},"finishReason":"STOP"}]}"""
    val result = GeminiResponse.parse(body).getOrThrow()
    assertEquals("आपका ऑर्डर भेज दिया गया है।", result.text)
    assertEquals("gu", result.detectedLanguage)
  }

  @Test
  fun fallsBackToPlainTextWhenTheModelIgnoresTheSchema() {
    val body = """{"candidates":[{"content":{"parts":[{"text":"नमस्ते दुनिया"}]}}]}"""
    assertEquals(TranslationResult("नमस्ते दुनिया", ""), GeminiResponse.parse(body).getOrThrow())
  }

  @Test
  fun reportsBlockedAndMalformedResponses() {
    fun error(body: String) = (GeminiResponse.parse(body).exceptionOrNull() as TranslateException).error
    assertEquals(TranslateError.SAFETY_BLOCKED, error("""{"promptFeedback":{"blockReason":"SAFETY"}}"""))
    assertEquals(TranslateError.SAFETY_BLOCKED, error("""{"candidates":[{"finishReason":"SAFETY"}]}"""))
    assertEquals(TranslateError.BAD_RESPONSE, error("not json"))
    assertEquals(TranslateError.BAD_RESPONSE, error("""{"candidates":[]}"""))
    assertEquals(TranslateError.BAD_RESPONSE, error("""{"candidates":[{"content":{"parts":[{"text":"{\"translation\":\"\"}"}]}}]}"""))
  }

  @Test
  fun mapsHttpErrorsToActionableCategories() {
    assertEquals(TranslateError.QUOTA, GeminiResponse.errorFor(429, "{}"))
    assertEquals(TranslateError.INVALID_KEY, GeminiResponse.errorFor(400, """{"error":{"message":"API key not valid."}}"""))
    assertEquals(TranslateError.INVALID_KEY, GeminiResponse.errorFor(403, """{"error":{"status":"PERMISSION_DENIED"}}"""))
    assertEquals(TranslateError.API_DISABLED, GeminiResponse.errorFor(403, """{"error":{"reason":"SERVICE_DISABLED"}}"""))
    assertEquals(TranslateError.SERVER, GeminiResponse.errorFor(503, ""))
    assertEquals(TranslateError.BAD_RESPONSE, GeminiResponse.errorFor(404, ""))
  }

  @Test
  fun redactsKeysFromText() {
    val key = "AIzaSyDummyKey1234567890"
    assertEquals("bad key ••• here", GeminiResponse.redact("bad key $key here", key))
    assertEquals("token •••", GeminiResponse.redact("token AQ.Ab8RN6L3zExampleExample", ""))
  }
}
