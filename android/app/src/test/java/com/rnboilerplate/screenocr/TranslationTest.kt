package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TranslationTest {
  private val config = TranslateConfig(enabled = true, target = "hi", source = "auto")

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
    // A retired or unknown model: the cause of the old "unexpected answer".
    assertEquals(TranslateError.MODEL_NOT_FOUND, GeminiResponse.errorFor(404, ""))
    assertEquals(
      TranslateError.MODEL_NOT_FOUND,
      GeminiResponse.errorFor(400, """{"error":{"message":"models/x is not found for API version v1beta"}}"""),
    )
    assertEquals(TranslateError.BAD_RESPONSE, GeminiResponse.errorFor(400, """{"error":{"message":"Invalid JSON payload"}}"""))
  }

  @Test
  fun extractsGooglesErrorMessageForDisplay() {
    val body = """{"error":{"code":404,"message":"models/gemini-2.5-flash is not found","status":"NOT_FOUND"}}"""
    assertEquals("models/gemini-2.5-flash is not found", GeminiResponse.errorMessage(body))
    assertEquals("", GeminiResponse.errorMessage("<html>"))
  }

  @Test
  fun defaultsToTheAlwaysCurrentFlashModelWithLowThinking() {
    assertEquals("gemini-flash-latest", TranslateConfig().model)
    assertEquals("low", TranslateConfig().thinkingLevel)
    assertEquals(false, TranslateConfig().enabled)
  }

  @Test
  fun sendsTheThinkingLevelAndCanLeaveItOutForOlderModels() {
    val withThinking = TranslationPrompt.requestBody(config.copy(thinkingLevel = "medium"), "x").toString()
    assertTrue(withThinking.contains("\"thinkingConfig\":{\"thinkingLevel\":\"medium\"}"))
    val without = TranslationPrompt.requestBody(config, "x", withThinking = false).toString()
    assertFalse(without.contains("thinkingConfig"))
    assertTrue(GeminiResponse.isThinkingRejected(400, """{"error":{"message":"Thinking level is not supported for this model."}}"""))
    assertFalse(GeminiResponse.isThinkingRejected(400, """{"error":{"message":"API key not valid."}}"""))
  }

  @Test
  fun ignoresThoughtPartsFromThinkingModels() {
    val body =
      """{"candidates":[{"content":{"parts":[{"text":"Let me think…","thought":true},{"text":"{\"detectedLanguage\":\"en\",\"translation\":\"नमस्ते\"}"}]}}]}"""
    assertEquals(TranslationResult("नमस्ते", "en"), GeminiResponse.parse(body).getOrThrow())
  }

  @Test
  fun listsOnlyTextGenerationGeminiModels() {
    val body =
      """{"models":[
        {"name":"models/gemini-3-flash","displayName":"Gemini 3 Flash","supportedGenerationMethods":["generateContent","countTokens"]},
        {"name":"models/gemini-flash-latest","displayName":"Gemini Flash Latest","supportedGenerationMethods":["generateContent"]},
        {"name":"models/text-embedding-004","displayName":"Embedding","supportedGenerationMethods":["embedContent"]},
        {"name":"models/gemini-3-pro-image","displayName":"Image","supportedGenerationMethods":["generateContent"]},
        {"name":"models/gemini-2.5-flash-preview-tts","displayName":"TTS","supportedGenerationMethods":["generateContent"]}
      ]}"""
    assertEquals(listOf("gemini-flash-latest", "gemini-3-flash"), GeminiResponse.parseModels(body).map { it.id })
  }

  @Test
  fun migratesEarlierSettings() {
    val config = OcrConfig.fromJson(org.json.JSONObject("""{"action":"speak_translate","translate":{"consent":true}}"""))
    assertEquals(FloatingAction.SPEAK, config.action)
    assertTrue(config.translate.enabled)
    assertEquals("low", config.translate.thinkingLevel)
  }

  @Test
  fun redactsKeysFromText() {
    val key = "AIzaSyDummyKey1234567890"
    assertEquals("bad key ••• here", GeminiResponse.redact("bad key $key here", key))
    assertEquals("token •••", GeminiResponse.redact("token AQ.Ab8RN6L3zExampleExample", ""))
  }
}
