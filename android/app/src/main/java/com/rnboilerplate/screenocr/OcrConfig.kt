package com.rnboilerplate.screenocr

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

enum class OcrMode(val id: String) {
  ENGLISH("english"),
  HINDI("hindi"),
  MIXED("mixed");

  companion object {
    fun from(id: String?): OcrMode = entries.firstOrNull { it.id == id } ?: MIXED
  }
}

/** Settings the overlay service needs while the React Native UI may not be running. */
data class OcrConfig(
  val mode: OcrMode = OcrMode.MIXED,
  val autoCopy: Boolean = true,
  val saveHistory: Boolean = true,
  val bubbleSizeDp: Int = 56,
  val bubbleOpacity: Float = 0.92f,
  val bubbleColor: Int = Color.parseColor("#7C3AED"),
  val bubbleIconColor: Int = Color.WHITE,
)

/** Which screen edge the bubble rests on, and how far down it sits (0..1). */
data class BubblePosition(val onRight: Boolean, val yRatio: Float)

/**
 * SharedPreferences store for the overlay. JS pushes its settings here so the
 * service can read them without a running JS runtime; finished captures wait
 * here (only when history is on) until the app drains them into its history.
 */
class OcrPrefs(context: Context) {
  private val prefs: SharedPreferences =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun readConfig(): OcrConfig {
    val d = OcrConfig()
    return OcrConfig(
      mode = OcrMode.from(prefs.getString(K_MODE, d.mode.id)),
      autoCopy = prefs.getBoolean(K_AUTO_COPY, d.autoCopy),
      saveHistory = prefs.getBoolean(K_SAVE_HISTORY, d.saveHistory),
      bubbleSizeDp = prefs.getInt(K_SIZE, d.bubbleSizeDp).coerceIn(MIN_SIZE_DP, MAX_SIZE_DP),
      bubbleOpacity = prefs.getFloat(K_OPACITY, d.bubbleOpacity).coerceIn(MIN_OPACITY, 1f),
      bubbleColor = prefs.getInt(K_COLOR, d.bubbleColor),
      bubbleIconColor = prefs.getInt(K_ICON_COLOR, d.bubbleIconColor),
    )
  }

  fun writeConfig(config: OcrConfig) {
    prefs.edit()
      .putString(K_MODE, config.mode.id)
      .putBoolean(K_AUTO_COPY, config.autoCopy)
      .putBoolean(K_SAVE_HISTORY, config.saveHistory)
      .putInt(K_SIZE, config.bubbleSizeDp.coerceIn(MIN_SIZE_DP, MAX_SIZE_DP))
      .putFloat(K_OPACITY, config.bubbleOpacity.coerceIn(MIN_OPACITY, 1f))
      .putInt(K_COLOR, config.bubbleColor)
      .putInt(K_ICON_COLOR, config.bubbleIconColor)
      .apply()
    if (!config.saveHistory) clearPending()
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

  companion object {
    private const val FILE = "screen_ocr"
    private const val K_MODE = "ocrMode"
    private const val K_AUTO_COPY = "autoCopy"
    private const val K_SAVE_HISTORY = "saveHistory"
    private const val K_SIZE = "bubbleSizeDp"
    private const val K_OPACITY = "bubbleOpacity"
    private const val K_COLOR = "bubbleColor"
    private const val K_ICON_COLOR = "bubbleIconColor"
    private const val K_ON_RIGHT = "bubbleOnRight"
    private const val K_Y_RATIO = "bubbleYRatio"
    private const val K_PENDING = "pendingResults"
    private const val MAX_PENDING = 50
    private const val DEFAULT_Y_RATIO = 0.35f
    const val MIN_SIZE_DP = 40
    const val MAX_SIZE_DP = 80
    const val MIN_OPACITY = 0.3f
  }
}
