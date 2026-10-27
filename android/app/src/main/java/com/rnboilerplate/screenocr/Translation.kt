package com.rnboilerplate.screenocr

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Translation settings mirrored from JS (the API key is never part of these). */
data class TranslateConfig(
  /** The user explicitly allowed sending extracted text to Google Gemini. */
  val consent: Boolean = false,
  /** Target language code: "en", "hi" or "gu". */
  val target: String = "hi",
  /** "auto" or a language code. */
  val source: String = "auto",
  /** User instructions; `{target}` and `{source}` are substituted. */
  val prompt: String = TranslationPrompt.DEFAULT_PROMPT,
  val model: String = TranslationPrompt.DEFAULT_MODEL,
)

/** Why a translation failed — each maps to a specific, actionable message. */
enum class TranslateError {
  NO_KEY,
  NO_CONSENT,
  NO_INTERNET,
  INVALID_KEY,
  API_DISABLED,
  QUOTA,
  SAFETY_BLOCKED,
  SERVER,
  TIMEOUT,
  BAD_RESPONSE,
  CANCELLED,
}

data class TranslationResult(val text: String, val detectedLanguage: String)

/** Builds the Gemini request. Pure, so prompt and payload are unit-tested. */
object TranslationPrompt {
  const val DEFAULT_MODEL = "gemini-2.5-flash"
  const val DEFAULT_PROMPT =
    "Translate the text naturally into {target}. Keep names, numbers, prices and URLs unchanged. " +
      "Keep paragraph breaks. Output only the translation."
  const val MAX_PROMPT = 1000

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

  /** `generateContent` request body. */
  fun requestBody(config: TranslateConfig, text: String): JSONObject =
    JSONObject()
      .put("systemInstruction", JSONObject().put("parts", JSONArray().put(JSONObject().put("text", systemInstruction(config)))))
      .put(
        "contents",
        JSONArray().put(JSONObject().put("role", "user").put("parts", JSONArray().put(JSONObject().put("text", text)))),
      )
      .put(
        "generationConfig",
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
          ),
      )

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

/** Parses Gemini responses and maps failures. Pure. */
object GeminiResponse {
  /** A successful `generateContent` body → translation, or the reason it can't be used. */
  fun parse(body: String): Result<TranslationResult> {
    val root =
      try {
        JSONObject(body)
      } catch (_: JSONException) {
        return Result.failure(TranslateException(TranslateError.BAD_RESPONSE))
      }
    if (root.optJSONObject("promptFeedback")?.has("blockReason") == true) {
      return Result.failure(TranslateException(TranslateError.SAFETY_BLOCKED))
    }
    val candidate = root.optJSONArray("candidates")?.optJSONObject(0)
      ?: return Result.failure(TranslateException(TranslateError.BAD_RESPONSE))
    if (candidate.optString("finishReason") == "SAFETY") {
      return Result.failure(TranslateException(TranslateError.SAFETY_BLOCKED))
    }
    val parts = candidate.optJSONObject("content")?.optJSONArray("parts")
    val raw = buildString {
      for (i in 0 until (parts?.length() ?: 0)) append(parts!!.optJSONObject(i)?.optString("text").orEmpty())
    }.trim()
    if (raw.isEmpty()) return Result.failure(TranslateException(TranslateError.BAD_RESPONSE))
    // Structured output: {"detectedLanguage": "...", "translation": "..."}.
    // Fall back to the raw text if a model ignores the schema.
    return try {
      val json = JSONObject(raw)
      val translation = json.optString("translation").trim()
      if (translation.isEmpty()) Result.failure(TranslateException(TranslateError.BAD_RESPONSE))
      else Result.success(TranslationResult(translation, json.optString("detectedLanguage").trim().lowercase()))
    } catch (_: JSONException) {
      Result.success(TranslationResult(raw, ""))
    }
  }

  /** HTTP status + error body → error category. */
  fun errorFor(status: Int, body: String): TranslateError {
    val message = body.lowercase()
    return when {
      status == 429 || "resource_exhausted" in message || "quota" in message -> TranslateError.QUOTA
      status == 403 && ("service_disabled" in message || "has not been used" in message || "disabled" in message) ->
        TranslateError.API_DISABLED
      status == 400 && ("api key not valid" in message || "api_key_invalid" in message) -> TranslateError.INVALID_KEY
      status == 401 || status == 403 -> TranslateError.INVALID_KEY
      status >= 500 -> TranslateError.SERVER
      else -> TranslateError.BAD_RESPONSE
    }
  }

  /** Never echo a key: strips anything key-like from text that might be shown or logged. */
  fun redact(text: String, key: String): String =
    (if (key.length >= 6) text.replace(key, "•••") else text).replace(Regex("(AIza|AQ\\.)[A-Za-z0-9._-]{8,}"), "•••")
}

class TranslateException(val error: TranslateError) : RuntimeException(error.name)
