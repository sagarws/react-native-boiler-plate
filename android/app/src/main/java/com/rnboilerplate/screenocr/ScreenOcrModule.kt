package com.rnboilerplate.screenocr

import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.UiThreadUtil

/**
 * TurboModule bridging the overlay service to JS. Holds no capture state of
 * its own: status lives in [OverlayCaptureService] / [ScreenOcrBus], settings
 * in [OcrPrefs], so the service keeps working while the JS runtime is gone.
 */
class ScreenOcrModule(context: ReactApplicationContext) :
  NativeScreenOcrSpec(context), ScreenOcrBus.Listener {
  private val prefs = OcrPrefs(context)

  override fun initialize() {
    super.initialize()
    ScreenOcrBus.listener = this
  }

  override fun invalidate() {
    if (ScreenOcrBus.listener === this) ScreenOcrBus.listener = null
    super.invalidate()
  }

  override fun getStatus(promise: Promise) {
    val status =
      Arguments.createMap().apply {
        putBoolean("overlayPermission", Settings.canDrawOverlays(reactApplicationContext))
        putBoolean("serviceRunning", OverlayCaptureService.isRunning)
      }
    promise.resolve(status)
  }

  override fun openOverlaySettings() {
    val intent =
      Intent(
          Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
          Uri.parse("package:${reactApplicationContext.packageName}"),
        )
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  override fun startOverlay(promise: Promise) {
    if (!Settings.canDrawOverlays(reactApplicationContext)) {
      promise.reject(E_OVERLAY_PERMISSION, "Display over other apps is not allowed")
      return
    }
    if (OverlayCaptureService.isRunning) {
      promise.resolve(true)
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    // A second request while one is pending supersedes the first.
    ScreenOcrBus.deliverConsent(false)
    ScreenOcrBus.consentCallback = { granted -> promise.resolve(granted) }
    UiThreadUtil.runOnUiThread {
      activity.startActivity(Intent(activity, CaptureConsentActivity::class.java))
    }
  }

  override fun stopOverlay() {
    OverlayCaptureService.stop(reactApplicationContext)
  }

  override fun updateConfig(config: ReadableMap) {
    val defaults = OcrConfig()
    prefs.writeConfig(
      OcrConfig(
        mode = OcrMode.from(config.getStringOrNull("ocrMode")),
        autoCopy = config.getBooleanOr("autoCopy", defaults.autoCopy),
        saveHistory = config.getBooleanOr("saveHistory", defaults.saveHistory),
        bubbleSizeDp = config.getDoubleOr("bubbleSizeDp", defaults.bubbleSizeDp.toDouble()).toInt(),
        bubbleOpacity = config.getDoubleOr("bubbleOpacity", defaults.bubbleOpacity.toDouble()).toFloat(),
        bubbleColor = parseColor(config.getStringOrNull("bubbleColor"), defaults.bubbleColor),
        bubbleIconColor = parseColor(config.getStringOrNull("bubbleIconColor"), defaults.bubbleIconColor),
      ),
    )
    OverlayCaptureService.notifyConfigChanged(reactApplicationContext)
  }

  override fun resetBubblePosition() {
    prefs.resetPosition()
    OverlayCaptureService.resetPosition(reactApplicationContext)
  }

  override fun copyToClipboard(text: String, promise: Promise) {
    promise.resolve(ClipboardHelper.copy(reactApplicationContext, text, sensitive = false))
  }

  override fun getLatestResult(promise: Promise) {
    promise.resolve(ScreenOcrBus.latest?.toString() ?: "")
  }

  override fun consumePendingResults(promise: Promise) {
    promise.resolve(prefs.drainPending())
  }

  override fun clearCapturedData() {
    ScreenOcrBus.latest = null
    prefs.clearPending()
  }

  override fun onCaptureResult() = emit(EVENT_RESULT)

  override fun onStatusChanged() = emit(EVENT_STATUS)

  /** Payload-free nudges; JS pulls the data, so nothing is delivered twice. */
  private fun emit(event: String) {
    if (!reactApplicationContext.hasActiveReactInstance()) return
    reactApplicationContext.emitDeviceEvent(event, null)
  }

  private fun parseColor(value: String?, fallback: Int): Int =
    try {
      if (value.isNullOrBlank()) fallback else Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
      fallback
    }

  private fun ReadableMap.getStringOrNull(key: String): String? =
    if (hasKey(key) && !isNull(key)) getString(key) else null

  private fun ReadableMap.getBooleanOr(key: String, fallback: Boolean): Boolean =
    if (hasKey(key) && !isNull(key)) getBoolean(key) else fallback

  private fun ReadableMap.getDoubleOr(key: String, fallback: Double): Double =
    if (hasKey(key) && !isNull(key)) getDouble(key) else fallback

  companion object {
    const val NAME = NativeScreenOcrSpec.NAME
    private const val E_OVERLAY_PERMISSION = "overlay_permission"
    private const val E_NO_ACTIVITY = "no_activity"
    private const val EVENT_RESULT = "ScreenOcrResult"
    private const val EVENT_STATUS = "ScreenOcrStatus"
  }
}
