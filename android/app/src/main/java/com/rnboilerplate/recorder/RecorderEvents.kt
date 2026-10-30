package com.rnboilerplate.recorder

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.Date
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Native → JS events, delivered on the main thread. Only state changes and
 * meaningful progress go through here (never frames or samples); the
 * module forwards each one as a `RecorderEvent` device event.
 *
 * Types: state {state, mode, elapsedMs, segment, content}, segment_completed
 * {index}, segment_started {index}, merge_started, merge_progress {progress},
 * merge_completed {id}, library_changed, error {code}.
 */
object RecorderEvents {
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(String, JSONObject) -> Unit>()

  fun add(listener: (String, JSONObject) -> Unit) = listeners.add(listener)

  fun remove(listener: (String, JSONObject) -> Unit) = listeners.remove(listener)

  fun emit(type: String, body: JSONObject = JSONObject()) {
    main.post { listeners.forEach { it(type, body) } }
  }

  /** Called by the editor when it closes, for a screenshot still in preview. */
  @Volatile var onEditorClosed: ((source: String, saved: Boolean) -> Unit)? = null
}

/** Writes a screenshot bitmap to the screenshot folder and adds it to the library. */
object ScreenshotSaver {
  fun save(context: Context, bitmap: Bitmap, config: RecorderConfig, edited: Boolean): JSONObject {
    val storage = OutputStorage(context)
    val now = Date()
    val name = if (edited) RecordingNames.editedScreenshot(now) else RecordingNames.screenshot(now)
    val out = storage.create(OutputKind.SCREENSHOT, config.dirs[OutputKind.SCREENSHOT], name, "image/png")
    try {
      android.os.ParcelFileDescriptor.AutoCloseOutputStream(storage.openWrite(out.uri)).use { stream ->
        check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) { "encode_failed" }
        stream.flush()
      }
      storage.finish(out.uri)
    } catch (e: Exception) {
      storage.delete(out.uri)
      throw e
    }
    val id = UUID.randomUUID().toString()
    val entry =
      JSONObject().apply {
        put("id", id)
        put("type", "screenshot")
        put("name", out.name)
        put("uri", out.uri.toString())
        put("createdAt", now.time)
        put("endedAt", now.time)
        put("durationMs", 0)
        put("sizeBytes", storage.size(out.uri))
        put("width", bitmap.width)
        put("height", bitmap.height)
        put("audio", "none")
        put("status", RecordingStore.STATUS_COMPLETED)
        put("outputKind", OutputKind.SCREENSHOT.id)
        MediaCheck.saveThumb(context, bitmap, id)?.let { put("thumb", it) }
      }
    RecordingStore.get(context).put(entry)
    RecorderEvents.emit("library_changed")
    return entry
  }

  fun load(context: Context, uri: Uri): Bitmap? =
    try {
      val stream = if (uri.scheme == "file") java.io.FileInputStream(uri.path!!) else context.contentResolver.openInputStream(uri)
      stream?.use { android.graphics.BitmapFactory.decodeStream(it) }
    } catch (_: Exception) {
      null
    }
}
