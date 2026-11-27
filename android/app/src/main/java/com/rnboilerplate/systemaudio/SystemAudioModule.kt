package com.rnboilerplate.systemaudio

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativeSystemAudioSpec

/**
 * 8D Audio Studio's "Other apps" mode (contract: src/specs/NativeSystemAudio.ts):
 * session effects ([SessionEffects]) and playback capture
 * ([SystemAudioCaptureService] → [PlaybackRenderer]). Relays the status JSON
 * as `SystemAudioEvent` {type: 'status', body}.
 */
class SystemAudioModule(context: ReactApplicationContext) : NativeSystemAudioSpec(context) {
  private val effects = SessionEffects.get(context)

  private val relay: (String) -> Unit = { json ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      val map = Arguments.createMap()
      map.putString("type", "status")
      map.putString("body", json)
      reactApplicationContext.emitDeviceEvent(EVENT, map)
    }
  }

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    SystemAudioEvents.add(reactApplicationContext, relay)
    // Implicit session broadcasts only reach a runtime receiver (see SessionEffectReceiver).
    SessionEffectReceiver.registerRuntime(reactApplicationContext)
  }

  override fun invalidate() {
    SystemAudioEvents.remove(relay)
    SessionEffectReceiver.unregisterRuntime(reactApplicationContext)
    super.invalidate()
  }

  override fun getStatus(promise: Promise) {
    promise.resolve(SystemAudioEvents.statusJson(reactApplicationContext))
  }

  override fun setEffectsEnabled(enabled: Boolean) {
    effects.setEnabled(enabled)
  }

  override fun setEffectParams(params: ReadableArray) {
    effects.setParams(FloatArray(params.size()) { params.getDouble(it).toFloat() })
  }

  override fun startCapture(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
      promise.reject("unsupported", "Playback capture needs Android 10")
      return
    }
    if (ContextCompat.checkSelfPermission(reactApplicationContext, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      promise.reject("permission", "RECORD_AUDIO not granted")
      return
    }
    if (CaptureStatus.running) {
      promise.resolve(null)
      return
    }
    val context = reactApplicationContext.currentActivity ?: reactApplicationContext
    SystemAudioCaptureService.requestStart(context) { error ->
      if (error == null) promise.resolve(null) else promise.reject(error, "Capture did not start: $error")
    }
  }

  override fun stopCapture() {
    SystemAudioCaptureService.stop(reactApplicationContext)
  }

  override fun setCaptureOutput(mode: String) {
    val next = if (mode == CaptureStatus.MODE_ACCESSIBILITY) CaptureStatus.MODE_ACCESSIBILITY else CaptureStatus.MODE_MEDIA
    if (next == CaptureStatus.outputMode) return
    CaptureStatus.outputMode = next // The render loop rebuilds its track on the next block.
    SystemAudioEvents.changed()
  }

  // Events go out through emitDeviceEvent; NativeEventEmitter only needs these to exist.
  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  companion object {
    const val NAME = "SystemAudio"
    const val EVENT = "SystemAudioEvent"
  }
}

class SystemAudioPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == SystemAudioModule.NAME) SystemAudioModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      SystemAudioModule.NAME to
        ReactModuleInfo(SystemAudioModule.NAME, SystemAudioModule.NAME, false, false, false, true),
    )
  }
}
