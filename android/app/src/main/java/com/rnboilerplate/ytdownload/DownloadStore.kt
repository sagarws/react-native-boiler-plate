package com.rnboilerplate.ytdownload

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Finished downloads (newest first, capped), kept natively because the
 * service finishes them even when the JS app is closed. Each entry:
 * {id, title, author, kind, label, name, uri, mime, sizeBytes, durationSec, createdAt}.
 */
class DownloadStore private constructor(context: Context) {
  private val prefs = context.getSharedPreferences("yt_downloads", Context.MODE_PRIVATE)

  @Synchronized
  fun list(): JSONArray = runCatching { JSONArray(prefs.getString(KEY, "[]")) }.getOrDefault(JSONArray())

  @Synchronized
  fun get(id: String): JSONObject? {
    val all = list()
    return (0 until all.length()).map { all.getJSONObject(it) }.firstOrNull { it.optString("id") == id }
  }

  @Synchronized
  fun add(entry: JSONObject) {
    val all = list()
    val next = JSONArray().put(entry)
    for (i in 0 until minOf(all.length(), MAX_ENTRIES - 1)) next.put(all.getJSONObject(i))
    prefs.edit().putString(KEY, next.toString()).apply()
  }

  @Synchronized
  fun remove(id: String): JSONObject? {
    val all = list()
    val keep = JSONArray()
    var removed: JSONObject? = null
    for (i in 0 until all.length()) {
      val e = all.getJSONObject(i)
      if (e.optString("id") == id) removed = e else keep.put(e)
    }
    prefs.edit().putString(KEY, keep.toString()).apply()
    return removed
  }

  companion object {
    private const val KEY = "entries"
    private const val MAX_ENTRIES = 100

    @Volatile private var instance: DownloadStore? = null

    fun get(context: Context): DownloadStore =
      instance ?: synchronized(this) { instance ?: DownloadStore(context.applicationContext).also { instance = it } }
  }
}

/**
 * Native → JS events on the main thread, forwarded by the module as
 * `YouTubeDownloadEvent`. Types: progress {id, phase, fraction, bytes, total},
 * completed {entry}, failed {id, code}, cancelled {id}.
 */
object YtDownloadEvents {
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(String, JSONObject) -> Unit>()

  fun add(listener: (String, JSONObject) -> Unit) = listeners.add(listener)

  fun remove(listener: (String, JSONObject) -> Unit) = listeners.remove(listener)

  fun emit(type: String, body: JSONObject) {
    main.post { listeners.forEach { it(type, body) } }
  }
}
