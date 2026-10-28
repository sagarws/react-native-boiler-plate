package com.rnboilerplate.screenocr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LifeCoachTest {
  @Test
  fun sendsTheUsersSummaryWithAStrictSchemaAndTheSharedGeminiSettings() {
    val body = LifeCoach.requestBody(TranslateConfig(thinkingLevel = "medium"), """{"tasks":[]}""", withThinking = true).toString()
    assertTrue(body.contains("""{\"tasks\":[]}"""))
    assertTrue(body.contains("\"responseMimeType\":\"application/json\""))
    assertTrue(body.contains("\"proposedTarget\""))
    assertTrue(body.contains("\"thinkingLevel\":\"medium\""))
    assertTrue(body.contains("Never invent"))
    assertFalse(LifeCoach.requestBody(TranslateConfig(), "x", withThinking = false).toString().contains("thinkingConfig"))
  }

  @Test
  fun capsTheInputAndStripsCodeFences() {
    val big = "a".repeat(LifeCoach.MAX_INPUT + 500)
    assertFalse(LifeCoach.requestBody(TranslateConfig(), big, false).toString().contains("a".repeat(LifeCoach.MAX_INPUT + 1)))
    val body = """{"candidates":[{"content":{"parts":[{"text":"```json\n{\"summary\":\"ok\",\"recommendations\":[]}\n```"}]}}]}"""
    assertEquals("""{"summary":"ok","recommendations":[]}""", LifeCoach.parse(body).getOrThrow().text)
  }
}
