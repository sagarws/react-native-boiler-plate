package com.rnboilerplate.lifewidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.security.SecureRandom
import java.util.UUID

/**
 * The widget's private storage: the snapshot pushed by the app and the queue
 * of quick logs made on the widget (imported and cleared when the app opens).
 * Local to the device; nothing here is logged or sent anywhere.
 */
class LifeWidgetStore(context: Context) {
  private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

  fun snapshot(): JSONObject? =
    prefs.getString(KEY_SNAPSHOT, null)?.let { runCatching { JSONObject(it) }.getOrNull() }

  fun saveSnapshot(json: String) {
    // Reject anything that isn't a JSON object so a bad push can't break the widget.
    if (runCatching { JSONObject(json) }.isSuccess) prefs.edit().putString(KEY_SNAPSHOT, json).apply()
  }

  fun logs(): JSONArray = synchronized(LOCK) { readLogs() }

  fun appendLog(taskId: String, day: String, quantity: Double, at: Long) = synchronized(LOCK) {
    val logs = readLogs()
    logs.put(
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("task", taskId)
        .put("day", day)
        .put("q", quantity)
        .put("at", at),
    )
    prefs.edit().putString(KEY_LOGS, logs.toString()).commit()
  }

  /** Returns the queued logs and clears the queue in one step. */
  fun takeLogs(): JSONArray = synchronized(LOCK) {
    val logs = readLogs()
    prefs.edit().remove(KEY_LOGS).commit()
    logs
  }

  /**
   * Random per-install token carried by the widget's own PendingIntents, so
   * another app can't add logs by broadcasting to the (exported) provider.
   */
  fun token(): String = synchronized(LOCK) {
    prefs.getString(KEY_TOKEN, null) ?: ByteArray(16).also { SecureRandom().nextBytes(it) }
      .joinToString("") { "%02x".format(it) }
      .also { prefs.edit().putString(KEY_TOKEN, it).apply() }
  }

  private fun readLogs(): JSONArray =
    prefs.getString(KEY_LOGS, null)?.let { runCatching { JSONArray(it) }.getOrNull() } ?: JSONArray()

  private companion object {
    const val FILE = "life_widget"
    const val KEY_SNAPSHOT = "snapshot"
    const val KEY_LOGS = "logs"
    const val KEY_TOKEN = "token"
    val LOCK = Any()
  }
}
