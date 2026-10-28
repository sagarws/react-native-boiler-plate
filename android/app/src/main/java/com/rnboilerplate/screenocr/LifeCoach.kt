package com.rnboilerplate.screenocr

import org.json.JSONArray
import org.json.JSONObject

/**
 * Manage Life "Get AI recommendations": the instruction and response schema
 * sent to Gemini (through the existing [GeminiClient], key and model). The
 * user's data arrives from JS as a compact JSON summary; the structured
 * reply is validated again in JS before anything is shown. The model can
 * only *suggest* — the app never acts on its output by itself.
 */
object LifeCoach {
  const val MAX_INPUT = 24_000

  private const val INSTRUCTION =
    "You are a supportive, practical personal-progress coach. The user tracks projects with measurable " +
      "tasks. The JSON you receive is their own history: each task's target, recent target periods (start, " +
      "end, target, completed, status), notes and the reasons they gave for missed targets.\n" +
      "Rules:\n" +
      "- Base every statement ONLY on the data provided. Never invent dates, numbers, notes or reasons. " +
      "Cite the evidence (e.g. 'met 4 of the last 7 periods', 'reason \"busy\" given 3 times since 12 Oct').\n" +
      "- Neutral, encouraging wording; never shame the user.\n" +
      "- Use the task names exactly as given in taskName.\n" +
      "- Suggest a target change (proposedTarget) only when the history clearly shows the current target is " +
      "unrealistic or too easy; keep units unchanged.\n" +
      "- Cover, when the data supports it: overall summary, repeated blockers, target realism, actionable " +
      "improvements, target adjustments, prioritized next steps (at most 3), project-level insights, and " +
      "positive progress. Return at most 10 recommendations.\n" +
      "- Output JSON only, matching the schema."

  fun requestBody(config: TranslateConfig, data: String, withThinking: Boolean): JSONObject {
    fun str() = JSONObject().put("type", "STRING")
    fun enumOf(vararg values: String) = JSONObject().put("type", "STRING").put("enum", JSONArray(values.toList()))
    val target =
      JSONObject()
        .put("type", "OBJECT")
        .put(
          "properties",
          JSONObject()
            .put("quantity", JSONObject().put("type", "NUMBER"))
            .put("frequency", enumOf("daily", "weekly", "interval"))
            .put("intervalDays", JSONObject().put("type", "INTEGER")),
        )
        .put("required", JSONArray(listOf("quantity", "frequency", "intervalDays")))
    val item =
      JSONObject()
        .put("type", "OBJECT")
        .put(
          "properties",
          JSONObject()
            .put("category", enumOf("summary", "blocker", "realism", "improvement", "adjustment", "next_step", "project", "positive"))
            .put("title", str())
            .put("explanation", str())
            .put("evidence", str())
            .put("action", str())
            .put("priority", enumOf("high", "medium", "low"))
            .put("taskName", str())
            .put("proposedTarget", target),
        )
        .put("required", JSONArray(listOf("category", "title", "explanation", "evidence", "action", "priority")))
    val schema =
      JSONObject()
        .put("type", "OBJECT")
        .put(
          "properties",
          JSONObject()
            .put("summary", str())
            .put("recommendations", JSONObject().put("type", "ARRAY").put("items", item)),
        )
        .put("required", JSONArray(listOf("summary", "recommendations")))
    val generation =
      JSONObject()
        .put("temperature", 0.3)
        .put("responseMimeType", "application/json")
        .put("responseSchema", schema)
    if (withThinking && config.thinkingLevel in TranslationPrompt.THINKING_LEVELS) {
      generation.put("thinkingConfig", JSONObject().put("thinkingLevel", config.thinkingLevel))
    }
    return JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", INSTRUCTION))))
      .put(
        "contents",
        JSONArray().put(
          JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", data.take(MAX_INPUT)))),
        ),
      )
      .put("generationConfig", generation)
  }

  /** The model's JSON text (code fences stripped), or why there is none. */
  fun parse(body: String): Result<TranslationResult> =
    GeminiResponse.answerText(body).map { TranslationResult(GeminiResponse.stripCodeFence(it), "") }
}
