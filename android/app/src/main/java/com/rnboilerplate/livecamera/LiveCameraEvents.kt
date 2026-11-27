package com.rnboilerplate.livecamera

import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Native → JS events, delivered on the main thread; the module forwards each
 * one as a `LiveCameraEvent` device event.
 *
 * Types: stop {} (Stop in the notification, or the service's time limit),
 * network {online, transport}.
 */
object LiveCameraEvents {
  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(String, JSONObject) -> Unit>()

  fun add(listener: (String, JSONObject) -> Unit) = listeners.add(listener)

  fun remove(listener: (String, JSONObject) -> Unit) = listeners.remove(listener)

  fun emit(type: String, body: JSONObject = JSONObject()) {
    main.post { listeners.forEach { it(type, body) } }
  }
}
