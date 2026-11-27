package com.rnboilerplate.audiostudio

import android.os.Handler
import android.os.Looper
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativeAudioStudioSpec
import org.json.JSONObject
import java.util.concurrent.Executors

/**
 * 8D Audio Studio TurboModule (src/specs/NativeAudioStudio.ts). Library
 * lookups run on a background executor; every player command is posted to
 * the main thread, where [AudioStudioPlayer] (ExoPlayer) lives. Player
 * events are relayed to JS as `AudioStudioEvent` {type, body}.
 */
class AudioStudioModule(context: ReactApplicationContext) : NativeAudioStudioSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())

  private val relay: (String, JSONObject) -> Unit = { type, body ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      val map = Arguments.createMap()
      map.putString("type", type)
      map.putString("body", body.toString())
      reactApplicationContext.emitDeviceEvent(EVENT, map)
    }
  }

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    AudioStudioPlayer.addListener(relay)
  }

  override fun invalidate() {
    // The player and its service outlive the JS instance (playback continues).
    AudioStudioPlayer.removeListener(relay)
    io.shutdown()
    super.invalidate()
  }

  private fun onMain(block: () -> Unit) {
    main.post {
      try {
        block()
      } catch (e: Exception) {
        android.util.Log.w(NAME, "command failed", e)
      }
    }
  }

  // ── library ──

  override fun scanLibrary(promise: Promise) {
    val context = reactApplicationContext
    if (!AudioLibrary.hasPermission(context)) {
      promise.reject("permission", "Audio library permission not granted")
      return
    }
    io.execute {
      try {
        promise.resolve(AudioLibrary.scan(context).toString())
      } catch (e: SecurityException) {
        promise.reject("permission", e.message, e)
      } catch (e: Exception) {
        promise.reject("scan_failed", e.message, e)
      }
    }
  }

  override fun importFiles(uris: ReadableArray, promise: Promise) {
    val list = (0 until uris.size()).mapNotNull { uris.getString(it) }
    io.execute {
      try {
        promise.resolve(AudioLibrary.import(reactApplicationContext, list).toString())
      } catch (e: Exception) {
        promise.reject("import_failed", e.message, e)
      }
    }
  }

  // ── queue / playback ──

  override fun setQueue(songsJson: String, startIndex: Double, positionMs: Double, play: Boolean) =
    onMain { AudioStudioPlayer.setQueue(reactApplicationContext, songsJson, startIndex.toInt(), positionMs.toLong(), play) }

  override fun addToQueue(songsJson: String, index: Double) =
    onMain { AudioStudioPlayer.addToQueue(reactApplicationContext, songsJson, index.toInt()) }

  override fun removeFromQueue(index: Double) = onMain { AudioStudioPlayer.removeFromQueue(index.toInt()) }

  override fun moveQueueItem(from: Double, to: Double) = onMain { AudioStudioPlayer.moveQueueItem(from.toInt(), to.toInt()) }

  override fun clearQueue() = onMain { AudioStudioPlayer.clearQueue() }

  override fun play() = onMain { AudioStudioPlayer.play(reactApplicationContext) }

  override fun pause() = onMain { AudioStudioPlayer.pause() }

  override fun next() = onMain { AudioStudioPlayer.next() }

  override fun previous() = onMain { AudioStudioPlayer.previous() }

  override fun seekTo(positionMs: Double) = onMain { AudioStudioPlayer.seekTo(positionMs.toLong()) }

  override fun skipTo(index: Double) = onMain { AudioStudioPlayer.skipTo(reactApplicationContext, index.toInt()) }

  override fun setRepeatMode(mode: String) = onMain { AudioStudioPlayer.setRepeatMode(mode) }

  override fun setShuffle(enabled: Boolean) = onMain { AudioStudioPlayer.setShuffle(reactApplicationContext, enabled) }

  override fun setSpeed(speed: Double) = onMain { AudioStudioPlayer.setSpeed(speed.toFloat()) }

  override fun setSleepTimer(minutes: Double, endOfTrack: Boolean) = onMain { AudioStudioPlayer.setSleepTimer(minutes, endOfTrack) }

  override fun setCrossfade(ms: Double) = onMain { AudioStudioPlayer.setCrossfade(ms.toLong()) }

  override fun getState(promise: Promise) {
    main.post {
      try {
        promise.resolve(AudioStudioPlayer.state().toString())
      } catch (e: Exception) {
        promise.reject("state_failed", e.message, e)
      }
    }
  }

  // ── DSP ──

  override fun setDspParams(params: ReadableArray) {
    SpatialDsp.setParams(FloatArray(params.size()) { params.getDouble(it).toFloat() })
  }

  override fun getDspState(promise: Promise) {
    val state = SpatialDsp.state
    val out = Arguments.createArray()
    state.forEach { out.pushDouble(it.toDouble()) }
    promise.resolve(out)
  }

  // Required by NativeEventEmitter; events go through emitDeviceEvent.
  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  companion object {
    const val NAME = NativeAudioStudioSpec.NAME
    const val EVENT = "AudioStudioEvent"
  }
}

class AudioStudioPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == AudioStudioModule.NAME) AudioStudioModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      AudioStudioModule.NAME to
        ReactModuleInfo(AudioStudioModule.NAME, AudioStudioModule.NAME, false, false, false, true),
    )
  }
}
