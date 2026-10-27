package com.rnboilerplate.screenocr

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * "Refine text" settings: when [enabled], OCR text is repaired with Gemini
 * (same key, model and thinking level as translation) before it is copied,
 * translated or spoken.
 */
data class RefineConfig(
  val enabled: Boolean = false,
  val prompt: String = RefinePrompt.DEFAULT_PROMPT,
)

/** Builds and parses the refinement request. Pure. */
object RefinePrompt {
  const val DEFAULT_PROMPT =
    "This text was extracted by OCR from a screen or a scanned page, possibly an old book. Repair OCR " +
      "damage: fix misrecognised characters, broken or split words, missing spaces and stray symbols; " +
      "rejoin words hyphenated across lines; restore a cut-off letter or word only when it is unambiguous " +
      "from the surrounding text. Do not add, remove, summarise, translate or rephrase content. Keep the " +
      "original language, names, numbers and paragraph breaks. Leave anything you cannot repair with " +
      "confidence exactly as it is."

  fun systemInstruction(config: RefineConfig): String =
    config.prompt.ifBlank { DEFAULT_PROMPT }.take(TranslationPrompt.MAX_PROMPT) +
      "\n\nRules: Return JSON with \"refined\" (the repaired text only, paragraphs separated by a blank line). " +
      "Do not add explanations or notes."

  fun requestBody(config: RefineConfig, gemini: TranslateConfig, text: String, withThinking: Boolean): JSONObject {
    val generation =
      JSONObject()
        .put("temperature", 0.1)
        .put("responseMimeType", "application/json")
        .put(
          "responseSchema",
          JSONObject()
            .put("type", "OBJECT")
            .put("properties", JSONObject().put("refined", JSONObject().put("type", "STRING")))
            .put("required", JSONArray().put("refined")),
        )
    if (withThinking && gemini.thinkingLevel in TranslationPrompt.THINKING_LEVELS) {
      generation.put("thinkingConfig", JSONObject().put("thinkingLevel", gemini.thinkingLevel))
    }
    return JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemInstruction(config)))))
      .put(
        "contents",
        JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text)))),
      )
      .put("generationConfig", generation)
  }

  /** `generateContent` body → refined text. Falls back to plain text if the schema is ignored. */
  fun parse(body: String): Result<TranslationResult> =
    GeminiResponse.answerText(body).mapCatching { raw ->
      try {
        val refined = JSONObject(GeminiResponse.stripCodeFence(raw)).optString("refined").trim()
        if (refined.isEmpty()) throw TranslateException(TranslateError.BAD_RESPONSE, detail = "Empty refinement")
        TranslationResult(refined, "")
      } catch (_: JSONException) {
        TranslationResult(raw, "")
      }
    }
}

/** What a capture became after the optional Gemini steps. */
data class ProcessedText(
  val original: String,
  val refined: String? = null,
  val translation: TranslationResult? = null,
) {
  /** The text later steps (copy, speech) use: translation, else refinement, else the original. */
  val finalText: String
    get() = translation?.text ?: refined ?: original
}

enum class PipelineStage { REFINING, TRANSLATING }

/** The two Gemini steps, behind an interface so the order is unit-tested. */
interface PipelinePorts {
  fun refine(text: String, onResult: (Result<TranslationResult>) -> Unit)

  fun translate(text: String, onResult: (Result<TranslationResult>) -> Unit)
}

/**
 * OCR text → refine (if on) → translate the refined text (if on). A failed
 * step fails the whole run (the user is told why) rather than silently
 * using unprocessed text. [cancel] drops any late result.
 */
class TextPipeline(private val ports: PipelinePorts) {
  private var generation = 0

  fun process(
    text: String,
    refine: Boolean,
    translate: Boolean,
    onStage: (PipelineStage) -> Unit,
    onResult: (Result<ProcessedText>) -> Unit,
  ) {
    val gen = ++generation
    fun translateStep(current: ProcessedText) {
      if (!translate) {
        onResult(Result.success(current))
        return
      }
      onStage(PipelineStage.TRANSLATING)
      ports.translate(current.finalText) { result ->
        if (gen != generation) return@translate
        onResult(result.map { current.copy(translation = it) })
      }
    }
    if (!refine) {
      translateStep(ProcessedText(text))
      return
    }
    onStage(PipelineStage.REFINING)
    ports.refine(text) { result ->
      if (gen != generation) return@refine
      result.fold(
        onSuccess = { translateStep(ProcessedText(text, refined = it.text)) },
        onFailure = { onResult(Result.failure(it)) },
      )
    }
  }

  fun cancel() {
    generation++
  }
}
