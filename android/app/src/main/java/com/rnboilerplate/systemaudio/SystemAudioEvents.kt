package com.rnboilerplate.systemaudio

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Live state of the capture route, written by [PlaybackRenderer] /
 * [SystemAudioCaptureService] and read when the status JSON is built.
 */
object CaptureStatus {
  const val MODE_MEDIA = "media"
  const val MODE_ACCESSIBILITY = "accessibility"
  const val FLOOR_DB = -120.0

  @Volatile var running = false
  @Volatile var outputMode = MODE_MEDIA
  @Volatile var inputDb = FLOOR_DB
  @Volatile var outputDb = FLOOR_DB
  @Volatile var silentMs = 0L
  @Volatile var latencyMs = 0
  @Volatile var error: String? = null

  fun resetLevels() {
    inputDb = FLOOR_DB
    outputDb = FLOOR_DB
    silentMs = 0
    latencyMs = 0
  }
}

/**
 * Native → JS: every listener (one per live [SystemAudioModule]) gets the
 * full status JSON (see src/specs/NativeSystemAudio.ts) on the main thread.
 * Bursts of changes coalesce into one event.
 */
object SystemAudioEvents {
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(String) -> Unit>()
  @Volatile private var appContext: Context? = null
  private val emitNow = Runnable { emitStatus() }

  fun add(context: Context, listener: (String) -> Unit) {
    appContext = context.applicationContext
    listeners.add(listener)
  }

  fun remove(listener: (String) -> Unit) = listeners.remove(listener)

  /** Schedules one status event (any thread). */
  fun changed() {
    if (listeners.isEmpty()) return
    main.removeCallbacks(emitNow)
    main.post(emitNow)
  }

  private fun emitStatus() {
    val context = appContext ?: return
    val json = statusJson(context)
    listeners.forEach { it(json) }
  }

  fun statusJson(context: Context): String {
    val effects = SessionEffects.get(context)
    return JSONObject()
      .put("sessions", effects.sessionsJson())
      .put("effectsEnabled", effects.enabled)
      .put("effectsSupported", effects.supportedJson())
      .put(
        "capture",
        JSONObject()
          .put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)
          .put("running", CaptureStatus.running)
          .put("outputMode", CaptureStatus.outputMode)
          .put("inputDb", round1(CaptureStatus.inputDb))
          .put("outputDb", round1(CaptureStatus.outputDb))
          .put("silentMs", CaptureStatus.silentMs)
          .put("latencyMs", CaptureStatus.latencyMs)
          .put("error", CaptureStatus.error ?: JSONObject.NULL),
      ).toString()
  }

  private fun round1(v: Double) = Math.round(v * 10) / 10.0
}
