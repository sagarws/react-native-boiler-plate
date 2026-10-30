package com.rnboilerplate.recorder

import android.content.Context
import android.net.Uri
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * The recordings library: one JSON entry per screenshot, voice or screen
 * recording, including a segmented session's segment list. Written by the
 * native side (the service keeps it current while recording, so a killed
 * process leaves an accurate record) and read by JS through RecorderModule.
 *
 * Entry fields: id, type (screenshot|video|audio), name, uri, createdAt,
 * endedAt, durationMs, sizeBytes, width, height, fps, audio
 * (none|system|mic|system_mic), status (recording|processing|completed|
 * interrupted|failed), error, segmentMinutes, keepSegments, outputKind,
 * thumb, segments [{index, uri, name, startUs, durationUs, sizeBytes, status
 * (writing|done|failed|deleted)}].
 */
class RecordingStore private constructor(context: Context) {
  private val file = AtomicFile(File(context.filesDir, "recordings/library.json").apply { parentFile?.mkdirs() })
  private val lock = Any()
  private var cache: MutableList<JSONObject>? = null

  private fun load(): MutableList<JSONObject> {
    cache?.let { return it }
    val list =
      try {
        val arr = JSONArray(String(file.readFully(), Charsets.UTF_8))
        (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.toMutableList()
      } catch (_: Exception) {
        mutableListOf()
      }
    cache = list
    return list
  }

  private fun save(list: List<JSONObject>) {
    val out = file.startWrite()
    try {
      out.write(JSONArray(list).toString().toByteArray(Charsets.UTF_8))
      file.finishWrite(out)
    } catch (e: Exception) {
      file.failWrite(out)
      throw e
    }
  }

  /** Newest first, as a JSON array string for JS. */
  fun listJson(): String = synchronized(lock) { JSONArray(load().sortedByDescending { it.optLong("createdAt") }).toString() }

  fun get(id: String): JSONObject? = synchronized(lock) { load().firstOrNull { it.optString("id") == id }?.let { JSONObject(it.toString()) } }

  fun put(entry: JSONObject) =
    synchronized(lock) {
      val list = load()
      val i = list.indexOfFirst { it.optString("id") == entry.optString("id") }
      if (i >= 0) list[i] = entry else list.add(entry)
      save(list)
    }

  /** Applies [change] to a copy of the entry and saves it; null when missing. */
  fun update(id: String, change: (JSONObject) -> Unit): JSONObject? =
    synchronized(lock) {
      val list = load()
      val i = list.indexOfFirst { it.optString("id") == id }
      if (i < 0) return null
      val copy = JSONObject(list[i].toString())
      change(copy)
      list[i] = copy
      save(list)
      copy
    }

  fun remove(id: String): JSONObject? =
    synchronized(lock) {
      val list = load()
      val i = list.indexOfFirst { it.optString("id") == id }
      if (i < 0) return null
      val removed = list.removeAt(i)
      save(list)
      removed
    }

  /**
   * After a process restart: sessions still marked recording/processing that
   * were created before [createdBefore] (i.e. not by the current process)
   * were cut off. Their segments are checked — complete
   * ones are kept (playable, mergeable), the one being written when the
   * process died has no index and is marked failed — and the session becomes
   * interrupted so the user can merge what survived. Nothing is deleted.
   */
  fun recoverStale(createdBefore: Long, verify: (Uri) -> Boolean) {
    val stale = synchronized(lock) {
      load().filter {
        val s = it.optString("status")
        (s == STATUS_RECORDING || s == STATUS_PROCESSING) && it.optLong("createdAt") < createdBefore
      }.map { it.optString("id") }
    }
    for (id in stale) {
      update(id) { entry ->
        val segments = entry.optJSONArray("segments") ?: JSONArray()
        for (k in 0 until segments.length()) {
          val seg = segments.getJSONObject(k)
          if (seg.optString("status") == SEG_WRITING) {
            seg.put("status", if (verify(Uri.parse(seg.optString("uri")))) SEG_DONE else SEG_FAILED)
          }
        }
        entry.put("status", STATUS_INTERRUPTED)
        if (!entry.has("error") || entry.optString("error").isEmpty()) entry.put("error", "process_killed")
      }
    }
  }

  companion object {
    const val STATUS_RECORDING = "recording"
    const val STATUS_PROCESSING = "processing"
    const val STATUS_COMPLETED = "completed"
    const val STATUS_INTERRUPTED = "interrupted"
    const val STATUS_FAILED = "failed"
    const val SEG_WRITING = "writing"
    const val SEG_DONE = "done"
    const val SEG_FAILED = "failed"
    const val SEG_DELETED = "deleted"

    @Volatile private var instance: RecordingStore? = null

    fun get(context: Context): RecordingStore =
      instance ?: synchronized(this) { instance ?: RecordingStore(context.applicationContext).also { instance = it } }
  }
}
