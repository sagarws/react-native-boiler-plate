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
    // A previous run that died with the original silenced: give the volume back.
    if (!CaptureStatus.running) HearOnly8D.restore(reactApplicationContext)
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
  override fun setHearOnly8D(enabled: Boolean, promise: Promise) {
    if (!enabled) {
      HearOnly8D.stop(reactApplicationContext)
      return promise.resolve("ok")
    }
    promise.resolve(
      when (HearOnly8D.start(reactApplicationContext)) {
        HearOnly8D.StartResult.OK -> "ok"
        HearOnly8D.StartResult.HELPER_OFF -> "helper_off"
        HearOnly8D.StartResult.REFUSED -> "refused"
      },
    )
  }

  override fun openDeveloperSettings() {
    val intent =
      android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS)
        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      reactApplicationContext.startActivity(intent)
    } catch (e: android.content.ActivityNotFoundException) {
      // Developer options not unlocked yet: open the phone's main settings instead.
      reactApplicationContext.startActivity(
        android.content.Intent(android.provider.Settings.ACTION_DEVICE_INFO_SETTINGS)
          .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }
  }

  override fun openVolumeHelperSettings() {
    val intent =
      android.content.Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)
        .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  override fun setEightDVolume(fraction: Double) {
    HearOnly8D.setVolume(reactApplicationContext, fraction.toFloat())
  }

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
