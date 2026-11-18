package com.rnboilerplate.photowidget

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** One photo widget's settings (any number of placed widgets can show it). */
data class PhotoConfig(
  val id: String,
  val name: String,
  /** Private copy of the photo (inside files/photo_widgets). */
  val image: String,
  val imgW: Int,
  val imgH: Int,
  /** fit | fill | crop */
  val mode: String,
  /** Chosen shape in cells; 0 × 0 = match the widget's size. */
  val frameW: Int,
  val frameH: Int,
  val focusX: Float,
  val focusY: Float,
  val zoom: Float,
  /** Rounded corners, dp. */
  val corner: Int,
  val updatedAt: Long,
) {
  fun toJson(): JSONObject =
    JSONObject()
      .put("id", id)
      .put("name", name)
      .put("image", image)
      .put("imgW", imgW)
      .put("imgH", imgH)
      .put("mode", mode)
      .put("frameW", frameW)
      .put("frameH", frameH)
      .put("focusX", focusX.toDouble())
      .put("focusY", focusY.toDouble())
      .put("zoom", zoom.toDouble())
      .put("corner", corner)
      .put("updatedAt", updatedAt)

  companion object {
    val MODES = setOf("fit", "fill", "crop")
    private val ID_RE = Regex("^[A-Za-z0-9_-]{1,60}$")

    fun from(o: JSONObject?): PhotoConfig? {
      o ?: return null
      val id = o.optString("id")
      val image = o.optString("image")
      if (!ID_RE.matches(id) || image.isBlank()) return null
      return PhotoConfig(
        id = id,
        name = o.optString("name").take(40),
        image = image,
        imgW = o.optInt("imgW", 0).coerceAtLeast(0),
        imgH = o.optInt("imgH", 0).coerceAtLeast(0),
        mode = o.optString("mode").takeIf { it in MODES } ?: "fill",
        frameW = o.optInt("frameW", 0).coerceIn(0, 6),
        frameH = o.optInt("frameH", 0).coerceIn(0, 6),
        focusX = o.optDouble("focusX", 0.5).toFloat().coerceIn(0f, 1f),
        focusY = o.optDouble("focusY", 0.5).toFloat().coerceIn(0f, 1f),
        zoom = o.optDouble("zoom", 1.0).toFloat().coerceIn(1f, 4f),
        corner = o.optInt("corner", 16).coerceIn(0, 48),
        updatedAt = o.optLong("updatedAt", 0L),
      ).let { if (it.frameW == 0 || it.frameH == 0) it.copy(frameW = 0, frameH = 0) else it }
    }
  }
}

/**
 * Photo widget settings and which placed widget (appWidgetId) shows which
 * one. Native is the source of truth because the launcher asks the widget
 * provider directly, even when the app has never been opened since boot.
 */
class PhotoWidgetStore(context: Context) {
  private val prefs = context.getSharedPreferences("photo_widgets", Context.MODE_PRIVATE)

  fun configs(): List<PhotoConfig> {
    val arr = try {
      JSONArray(prefs.getString("configs", "[]") ?: "[]")
    } catch (_: Exception) {
      JSONArray()
    }
    return (0 until arr.length()).mapNotNull { PhotoConfig.from(arr.optJSONObject(it)) }.distinctBy { it.id }
  }

  fun config(id: String): PhotoConfig? = configs().firstOrNull { it.id == id }

  @Synchronized
  fun saveConfigs(list: List<PhotoConfig>) {
    val arr = JSONArray()
    list.forEach { arr.put(it.toJson()) }
    prefs.edit().putString("configs", arr.toString()).commit()
  }

  @Synchronized
  fun upsert(c: PhotoConfig) = saveConfigs(configs().filter { it.id != c.id } + c)

  fun bindings(): Map<Int, String> {
    val o = try {
      JSONObject(prefs.getString("bindings", "{}") ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    return o.keys().asSequence().mapNotNull { k -> k.toIntOrNull()?.let { it to o.optString(k) } }.toMap()
  }

  @Synchronized
  private fun saveBindings(map: Map<Int, String>) {
    val o = JSONObject()
    map.forEach { (k, v) -> o.put(k.toString(), v) }
    prefs.edit().putString("bindings", o.toString()).commit()
  }

  @Synchronized
  fun bind(widgetId: Int, configId: String) = saveBindings(bindings() + (widgetId to configId))

  @Synchronized
  fun unbind(widgetIds: IntArray) = saveBindings(bindings() - widgetIds.toSet())

  /** Placed widgets showing [configId]. */
  fun widgetsFor(configId: String): List<Int> = bindings().filterValues { it == configId }.keys.toList()
}
