package com.rnboilerplate.screenocr

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * OCR language selection. Each mode names the recognisers it runs:
 * ML Kit Latin (English), ML Kit Devanagari (Hindi) and Tesseract
 * (Gujarati — ML Kit has no Gujarati model). Ids are persisted; `mixed`
 * keeps its original meaning (Hindi + English) for existing installs.
 */
enum class OcrMode(val id: String, val latin: Boolean, val devanagari: Boolean, val gujarati: Boolean) {
  ENGLISH("english", latin = true, devanagari = false, gujarati = false),
  HINDI("hindi", latin = false, devanagari = true, gujarati = false),
  GUJARATI("gujarati", latin = false, devanagari = false, gujarati = true),
  HINDI_ENGLISH("mixed", latin = true, devanagari = true, gujarati = false),
  GUJARATI_ENGLISH("gujarati_english", latin = true, devanagari = false, gujarati = true),
  HINDI_GUJARATI("hindi_gujarati", latin = false, devanagari = true, gujarati = true),
  ALL("all", latin = true, devanagari = true, gujarati = true);

  companion object {
    fun from(id: String?): OcrMode = entries.firstOrNull { it.id == id } ?: HINDI_ENGLISH
  }
}

/** What a tap on the floating button does. */
enum class FloatingAction(val id: String) {
  COPY("copy"),
  SPEAK("speak"),
  SPEAK_SCROLL("speak_scroll");

  companion object {
    fun from(id: String?): FloatingAction = entries.firstOrNull { it.id == id } ?: COPY
  }
}

data class SpeechConfig(
  /** "en", "hi" or "gu". Independent of the OCR mode. */
  val language: String = "en",
  /** An installed voice name, or "" for the language's default voice. */
  val voiceName: String = "",
  val rate: Float = 1f,
  val pitch: Float = 1f,
  /** Speak each sentence with a voice for its script when one is installed. */
  val switchByScript: Boolean = true,
  val preferGoogle: Boolean = true,
  val copyBeforeSpeaking: Boolean = false,
  val stopOnScreenOff: Boolean = true,
  val resumeAfterInterruption: Boolean = true,
)

data class ReadingConfig(
  /** Use the accessibility service to scroll; off = manual scrolling. */
  val autoScroll: Boolean = true,
  /** Hard stop after this many sections. */
  val maxSections: Int = 30,
  /** Consecutive screens with nothing new before the page is treated as ended. */
  val maxNoNewText: Int = 2,
  /** Without auto-scroll, wait for the user to scroll and tap Continue. */
  val manualFallback: Boolean = true,
)

/** Settings the overlay service needs while the React Native UI may not be running. */
data class OcrConfig(
  val mode: OcrMode = OcrMode.HINDI_ENGLISH,
  val action: FloatingAction = FloatingAction.COPY,
  val autoCopy: Boolean = true,
  val saveHistory: Boolean = true,
  val bubbleSizeDp: Int = 56,
  val bubbleOpacity: Float = 0.92f,
  val bubbleColor: Int = Color.parseColor("#7C3AED"),
  val bubbleIconColor: Int = Color.WHITE,
  val panelColor: Int = Color.parseColor("#1C1928"),
  val panelTextColor: Int = Color.parseColor("#F3F1F8"),
  val speech: SpeechConfig = SpeechConfig(),
  val reading: ReadingConfig = ReadingConfig(),
) {
  companion object {
    const val MIN_SIZE_DP = 40
    const val MAX_SIZE_DP = 80
    const val MIN_OPACITY = 0.3f
    val SPEECH_LANGUAGES = setOf("en", "hi", "gu")

    private fun color(json: JSONObject, key: String, fallback: Int): Int =
      try {
        val value = json.optString(key)
        if (value.isNullOrBlank()) fallback else Color.parseColor(value)
      } catch (_: IllegalArgumentException) {
        fallback
      }

    /** Parses with per-field defaults and clamping; never throws. */
    fun fromJson(json: JSONObject): OcrConfig {
      val d = OcrConfig()
      val s = json.optJSONObject("speech") ?: JSONObject()
      val r = json.optJSONObject("reading") ?: JSONObject()
      val ds = d.speech
      val dr = d.reading
      val language = s.optString("language", ds.language)
      return OcrConfig(
        mode = OcrMode.from(json.optString("ocrMode", d.mode.id)),
        action = FloatingAction.from(json.optString("action", d.action.id)),
        autoCopy = json.optBoolean("autoCopy", d.autoCopy),
        saveHistory = json.optBoolean("saveHistory", d.saveHistory),
        bubbleSizeDp = json.optInt("bubbleSizeDp", d.bubbleSizeDp).coerceIn(MIN_SIZE_DP, MAX_SIZE_DP),
        bubbleOpacity =
          json.optDouble("bubbleOpacity", d.bubbleOpacity.toDouble()).toFloat().coerceIn(MIN_OPACITY, 1f),
        bubbleColor = color(json, "bubbleColor", d.bubbleColor),
        bubbleIconColor = color(json, "bubbleIconColor", d.bubbleIconColor),
        panelColor = color(json, "panelColor", d.panelColor),
        panelTextColor = color(json, "panelTextColor", d.panelTextColor),
        speech =
          SpeechConfig(
            language = if (language in SPEECH_LANGUAGES) language else ds.language,
            voiceName = s.optString("voiceName", ds.voiceName),
            rate = s.optDouble("rate", ds.rate.toDouble()).toFloat().coerceIn(0.5f, 2f),
            pitch = s.optDouble("pitch", ds.pitch.toDouble()).toFloat().coerceIn(0.5f, 2f),
            switchByScript = s.optBoolean("switchByScript", ds.switchByScript),
            preferGoogle = s.optBoolean("preferGoogle", ds.preferGoogle),
            copyBeforeSpeaking = s.optBoolean("copyBeforeSpeaking", ds.copyBeforeSpeaking),
            stopOnScreenOff = s.optBoolean("stopOnScreenOff", ds.stopOnScreenOff),
            resumeAfterInterruption = s.optBoolean("resumeAfterInterruption", ds.resumeAfterInterruption),
          ),
        reading =
          ReadingConfig(
            autoScroll = r.optBoolean("autoScroll", dr.autoScroll),
            maxSections = r.optInt("maxSections", dr.maxSections).coerceIn(1, 200),
            maxNoNewText = r.optInt("maxNoNewText", dr.maxNoNewText).coerceIn(1, 10),
            manualFallback = r.optBoolean("manualFallback", dr.manualFallback),
          ),
      )
    }
  }
}

/** Which screen edge the bubble rests on, and how far down it sits (0..1). */
data class BubblePosition(val onRight: Boolean, val yRatio: Float)

/**
 * SharedPreferences store for the overlay. JS pushes its settings here (as
 * JSON) so the service can read them without a running JS runtime; finished
 * captures wait here (only when history is on) until the app drains them.
 */
class OcrPrefs(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun readConfig(): OcrConfig =
    try {
      OcrConfig.fromJson(JSONObject(prefs.getString(K_CONFIG, "{}") ?: "{}"))
    } catch (_: JSONException) {
      OcrConfig()
    }

  fun writeConfig(json: JSONObject) {
    prefs.edit().putString(K_CONFIG, json.toString()).apply()
    if (!OcrConfig.fromJson(json).saveHistory) clearPending()
  }

  fun readPosition(): BubblePosition =
    BubblePosition(
      onRight = prefs.getBoolean(K_ON_RIGHT, true),
      yRatio = prefs.getFloat(K_Y_RATIO, DEFAULT_Y_RATIO).coerceIn(0f, 1f),
    )

  fun writePosition(position: BubblePosition) {
    prefs.edit()
      .putBoolean(K_ON_RIGHT, position.onRight)
      .putFloat(K_Y_RATIO, position.yRatio.coerceIn(0f, 1f))
      .apply()
  }

  fun resetPosition() {
    prefs.edit().remove(K_ON_RIGHT).remove(K_Y_RATIO).apply()
  }

  @Synchronized
  fun appendPending(result: JSONObject) {
    val queue = readPending()
    queue.put(result)
    // Keep only the newest entries; the app's own history is capped as well.
    val trimmed = JSONArray()
    val start = (queue.length() - MAX_PENDING).coerceAtLeast(0)
    for (i in start until queue.length()) trimmed.put(queue.get(i))
    prefs.edit().putString(K_PENDING, trimmed.toString()).apply()
  }

  /** Returns the queued results as a JSON array string and empties the queue. */
  @Synchronized
  fun drainPending(): String {
    val queue = readPending()
    prefs.edit().remove(K_PENDING).apply()
    return queue.toString()
  }

  @Synchronized
  fun clearPending() {
    prefs.edit().remove(K_PENDING).apply()
  }

  private fun readPending(): JSONArray =
    try {
      JSONArray(prefs.getString(K_PENDING, "[]") ?: "[]")
    } catch (_: JSONException) {
      JSONArray()
    }

  private companion object {
    const val FILE = "screen_ocr"
    const val K_CONFIG = "config"
    const val K_ON_RIGHT = "bubbleOnRight"
    const val K_Y_RATIO = "bubbleYRatio"
    const val K_PENDING = "pendingResults"
    const val MAX_PENDING = 50
    const val DEFAULT_Y_RATIO = 0.35f
  }
}
