package com.rnboilerplate.screenocr

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Translation settings mirrored from JS (the API key is never part of these).
 * When [enabled], every mode works on the translation: Copy copies it, the
 * read-aloud modes speak it.
 */
data class TranslateConfig(
  /** "Apply translation" — also the user's consent to send extracted text to Gemini. */
  val enabled: Boolean = false,
  /** Target language code: "en", "hi" or "gu". */
  val target: String = "hi",
  /** "auto" or a language code. */
  val source: String = "auto",
  /** User instructions; `{target}` and `{source}` are substituted. */
  val prompt: String = TranslationPrompt.DEFAULT_PROMPT,
  val model: String = TranslationPrompt.DEFAULT_MODEL,
  /** Gemini 3 thinking level: "low", "medium" or "high". */
  val thinkingLevel: String = "low",
)

/** Why a translation failed — each maps to a specific, actionable message. */
enum class TranslateError {
  NO_KEY,
  NO_CONSENT,
  NO_INTERNET,
  INVALID_KEY,
  API_DISABLED,
  MODEL_NOT_FOUND,
  QUOTA,
  SAFETY_BLOCKED,
  SERVER,
  TIMEOUT,
  BAD_RESPONSE,
  CANCELLED,
}

data class TranslationResult(val text: String, val detectedLanguage: String)

/**
 * A failed request. [status] is the HTTP status (0 when none) and [detail]
 * Google's own error message, already redacted — shown on "Test connection"
 * so a misconfiguration can be diagnosed instead of guessed.
 */
class TranslateException(val error: TranslateError, val status: Int = 0, val detail: String = "") :
  RuntimeException(error.name)

/** Builds the Gemini request. Pure, so prompt and payload are unit-tested. */
object TranslationPrompt {
  /**
   * Google's always-current Flash alias, so a retired model version can't
   * break translation. "Test connection" lists the models the key can use.
   */
  const val DEFAULT_MODEL = "gemini-flash-latest"
  const val DEFAULT_PROMPT =
    "Translate the text naturally into {target}. Keep names, numbers, prices and URLs unchanged. " +
      "Keep paragraph breaks. Output only the translation."
  const val MAX_PROMPT = 1000
  val THINKING_LEVELS = setOf("low", "medium", "high")

  private val NAMES = mapOf("en" to "English", "hi" to "Hindi", "gu" to "Gujarati")

  fun languageName(code: String): String = NAMES[code] ?: code

  /** The user's prompt with placeholders filled, plus fixed output rules. */
  fun systemInstruction(config: TranslateConfig): String {
    val user =
      config.prompt.ifBlank { DEFAULT_PROMPT }.take(MAX_PROMPT)
        .replace("{target}", languageName(config.target))
        .replace("{source}", if (config.source == "auto") "the detected language" else languageName(config.source))
    return "$user\n\n" +
      "Rules: Return JSON with \"detectedLanguage\" (ISO 639-1 code of the input text) and " +
      "\"translation\" (the translated text only, paragraphs separated by a blank line). " +
      "Do not add explanations or notes. If the text is already in ${languageName(config.target)}, " +
      "return it unchanged."
  }

  /** `generateContent` request body; [withThinking] adds the Gemini 3 thinking level. */
  fun requestBody(config: TranslateConfig, text: String, withThinking: Boolean = true): JSONObject {
    val generation =
      JSONObject()
        .put("temperature", 0.2)
        .put("responseMimeType", "application/json")
        .put(
          "responseSchema",
          JSONObject()
            .put("type", "OBJECT")
            .put(
              "properties",
              JSONObject()
                .put("detectedLanguage", JSONObject().put("type", "STRING"))
                .put("translation", JSONObject().put("type", "STRING")),
            )
            .put("required", JSONArray().put("translation")),
        )
    if (withThinking && config.thinkingLevel in THINKING_LEVELS) {
      generation.put("thinkingConfig", JSONObject().put("thinkingLevel", config.thinkingLevel))
    }
    return JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemInstruction(config)))))
      .put(
        "contents",
        JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text)))),
      )
      .put("generationConfig", generation)
  }

  /**
   * Splits text into request-sized chunks at paragraph boundaries, keeping
   * order; a single over-long paragraph is split at sentence ends.
   */
  fun chunks(text: String, maxChars: Int = 4000): List<String> {
    val paragraphs = ParagraphText.paragraphs(text)
    val out = ArrayList<String>()
    val current = StringBuilder()
    fun flush() {
      if (current.isNotEmpty()) out += current.toString()
      current.setLength(0)
    }
    for (paragraph in paragraphs) {
      val pieces =
        if (paragraph.length <= maxChars) listOf(paragraph)
        else paragraph.split(Regex("(?<=[.!?।॥])\\s+")).flatMap { it.chunked(maxChars) }
      for (piece in pieces) {
        if (current.isNotEmpty() && current.length + piece.length + 2 > maxChars) flush()
        if (current.isNotEmpty()) current.append("\n\n")
        current.append(piece)
      }
    }
    flush()
    return out
  }
}

/** A model the key can call, from `GET /v1beta/models`. */
data class GeminiModel(val id: String, val displayName: String)

/** Parses Gemini responses and maps failures. Pure. */
object GeminiResponse {
  /** A successful `generateContent` body → translation, or the reason it can't be used. */
  fun parse(body: String): Result<TranslationResult> {
    val root =
      try {
        JSONObject(body)
      } catch (_: JSONException) {
        return Result.failure(TranslateException(TranslateError.BAD_RESPONSE, detail = "Response is not JSON"))
      }
    root.optJSONObject("promptFeedback")?.optString("blockReason")?.takeIf { it.isNotEmpty() }?.let {
      return Result.failure(TranslateException(TranslateError.SAFETY_BLOCKED, detail = it))
    }
    val candidate = root.optJSONArray("candidates")?.optJSONObject(0)
      ?: return Result.failure(TranslateException(TranslateError.BAD_RESPONSE, detail = "No candidates in response"))
    val finish = candidate.optString("finishReason")
    if (finish == "SAFETY" || finish == "PROHIBITED_CONTENT" || finish == "BLOCKLIST") {
      return Result.failure(TranslateException(TranslateError.SAFETY_BLOCKED, detail = finish))
    }
    val parts = candidate.optJSONObject("content")?.optJSONArray("parts")
    // Thinking models may return "thought" parts; only answer text counts.
    val raw = buildString {
      for (i in 0 until (parts?.length() ?: 0)) {
        val part = parts!!.optJSONObject(i) ?: continue
        if (part.optBoolean("thought", false)) continue
        append(part.optString("text"))
      }
    }.trim()
    if (raw.isEmpty()) {
      return Result.failure(
        TranslateException(TranslateError.BAD_RESPONSE, detail = "Empty answer (finishReason: ${finish.ifEmpty { "none" }})"),
      )
    }
    // Structured output: {"detectedLanguage": "...", "translation": "..."}.
    // Fall back to the raw text if a model ignores the schema.
    return try {
      val json = JSONObject(stripCodeFence(raw))
      val translation = json.optString("translation").trim()
      if (translation.isEmpty()) Result.failure(TranslateException(TranslateError.BAD_RESPONSE, detail = "Empty translation"))
      else Result.success(TranslationResult(translation, json.optString("detectedLanguage").trim().lowercase()))
    } catch (_: JSONException) {
      Result.success(TranslationResult(raw, ""))
    }
  }

  private fun stripCodeFence(text: String): String =
    text.removePrefix("```json").removePrefix("```").removeSuffix("```").trim()

  /** Google's `error.message` from an error body, or "". */
  fun errorMessage(body: String): String =
    try {
      JSONObject(body).optJSONObject("error")?.optString("message").orEmpty()
    } catch (_: JSONException) {
      ""
    }

  /** HTTP status + error body → error category. */
  fun errorFor(status: Int, body: String): TranslateError {
    val message = body.lowercase()
    return when {
      status == 429 || "resource_exhausted" in message || "quota" in message -> TranslateError.QUOTA
      status == 404 || "is not found" in message || "not supported for generatecontent" in message ->
        TranslateError.MODEL_NOT_FOUND
      status == 403 && ("service_disabled" in message || "has not been used" in message || "disabled" in message) ->
        TranslateError.API_DISABLED
      status == 400 && ("api key not valid" in message || "api_key_invalid" in message) -> TranslateError.INVALID_KEY
      status == 401 || status == 403 -> TranslateError.INVALID_KEY
      status >= 500 -> TranslateError.SERVER
      else -> TranslateError.BAD_RESPONSE
    }
  }

  /** The model rejected the thinking setting (older model, or a level it lacks). */
  fun isThinkingRejected(status: Int, body: String): Boolean =
    status == 400 && "thinking" in body.lowercase()

  /** Models usable for translation, newest-looking first. */
  fun parseModels(body: String): List<GeminiModel> {
    val array =
      try {
        JSONObject(body).optJSONArray("models") ?: return emptyList()
      } catch (_: JSONException) {
        return emptyList()
      }
    val skip = listOf("embedding", "image", "tts", "audio", "live", "veo", "imagen", "aqa", "learnlm", "robotics", "computer")
    return (0 until array.length())
      .mapNotNull { array.optJSONObject(it) }
      .filter { model ->
        val methods = model.optJSONArray("supportedGenerationMethods")
        (0 until (methods?.length() ?: 0)).any { methods!!.optString(it) == "generateContent" }
      }
      .map { GeminiModel(it.optString("name").removePrefix("models/"), it.optString("displayName")) }
      .filter { m -> m.id.startsWith("gemini") && skip.none { it in m.id } }
      .sortedWith(compareByDescending<GeminiModel> { "latest" in it.id }.thenByDescending { it.id })
  }

  /** Never echo a key: strips it, and anything key-like, from text that might be shown. */
  fun redact(text: String, key: String): String =
    (if (key.length >= 6) text.replace(key, "•••") else text)
      .replace(Regex("(AIza|AQ\\.)[A-Za-z0-9._-]{8,}"), "•••")
      .take(300)
}
