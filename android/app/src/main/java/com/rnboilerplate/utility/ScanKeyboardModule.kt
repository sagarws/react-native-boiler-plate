package com.rnboilerplate.utility

import android.app.Activity
import android.bluetooth.BluetoothAdapter
import android.content.ActivityNotFoundException
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.provider.Settings
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.screenocr.NativeScanKeyboardSpec
import org.json.JSONArray
import org.json.JSONObject

/**
 * Utility → Scanner gun (contract: src/specs/NativeScanKeyboard.ts): the
 * Bluetooth keyboard ([ScanKeyboard]) and the gun-mode camera
 * ([BarcodeScanActivity] with [BarcodeScanActivity.EXTRA_GUN]).
 */
class ScanKeyboardModule(context: ReactApplicationContext) : NativeScanKeyboardSpec(context) {
  private var pendingGun: Promise? = null

  private val relay: () -> Unit = {
    if (reactApplicationContext.hasActiveReactInstance()) {
      reactApplicationContext.emitDeviceEvent(
        EVENT,
        Arguments.createMap().apply { putString("body", ScanKeyboard.statusJson(reactApplicationContext)) },
      )
    }
  }

  /** Bluetooth switched on/off (also from quick settings): the screen updates. */
  private val adapterState = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = relay()
  }

  private val results = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != REQUEST_GUN) return
      val promise = pendingGun ?: return
      pendingGun = null
      val raw = data?.getStringExtra(BarcodeScanActivity.EXTRA_RESULT)
      when {
        raw == null -> promise.resolve("[]")
        raw.startsWith(BarcodeScanActivity.ERROR_PREFIX) ->
          promise.reject(raw.removePrefix(BarcodeScanActivity.ERROR_PREFIX), "Scanner could not start")
        else -> promise.resolve(
          try {
            JSONObject(raw).optJSONArray("gun")?.toString() ?: "[]"
          } catch (_: Exception) {
            "[]"
          },
        )
      }
    }
  }

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    ScanKeyboard.addListener(relay)
    reactApplicationContext.addActivityEventListener(results)
    androidx.core.content.ContextCompat.registerReceiver(
      reactApplicationContext,
      adapterState,
      IntentFilter(BluetoothAdapter.ACTION_STATE_CHANGED),
      androidx.core.content.ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  override fun invalidate() {
    ScanKeyboard.removeListener(relay)
    reactApplicationContext.removeActivityEventListener(results)
    try {
      reactApplicationContext.unregisterReceiver(adapterState)
    } catch (_: IllegalArgumentException) {
      // Not registered.
    }
    super.invalidate()
  }

  override fun getStatus(promise: Promise) = promise.resolve(ScanKeyboard.statusJson(reactApplicationContext))

  override fun start(promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(ScanKeyboard.start(reactApplicationContext)) }
  }

  override fun stop() {
    UiThreadUtil.runOnUiThread { ScanKeyboard.stop() }
  }

  override fun getHosts(promise: Promise) = promise.resolve(ScanKeyboard.hostsJson(reactApplicationContext))

  override fun connect(address: String, promise: Promise) {
    UiThreadUtil.runOnUiThread { promise.resolve(ScanKeyboard.connect(reactApplicationContext, address)) }
  }

  override fun disconnect() = ScanKeyboard.disconnect()

  override fun makeDiscoverable() {
    val intent = Intent(BluetoothAdapter.ACTION_REQUEST_DISCOVERABLE)
      .putExtra(BluetoothAdapter.EXTRA_DISCOVERABLE_DURATION, 120)
    launch(intent)
  }

  override fun openBluetoothSettings() = launch(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))

  private fun launch(intent: Intent) {
    val activity = reactApplicationContext.currentActivity
    try {
      if (activity != null) {
        activity.startActivity(intent)
      } else {
        reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      }
    } catch (_: ActivityNotFoundException) {
      // No such screen on this phone.
    } catch (_: SecurityException) {
      // Bluetooth permission missing: the screen asks for it first.
    }
  }

  override fun typeText(text: String, promise: Promise) {
    if (!ScanKeyboard.connected) {
      promise.reject("not_connected", "No computer connected")
      return
    }
    ScanKeyboard.type(text) { typed, skipped ->
      if (typed) promise.resolve(skipped.toDouble()) else promise.reject("not_connected", "No computer connected")
    }
  }

  override fun startScanGun(optionsJson: String, promise: Promise) {
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject("no_activity", "The app must be in the foreground")
      return
    }
    val o = try {
      JSONObject(optionsJson)
    } catch (_: Exception) {
      JSONObject()
    }
    pendingGun?.resolve("[]")
    pendingGun = promise
    val suffix = o.optString("suffix", "\n").takeIf { it == "\n" || it == "\t" || it == "" } ?: "\n"
    val intent = Intent(activity, BarcodeScanActivity::class.java)
      .putExtra(BarcodeScanActivity.EXTRA_LABELS, (o.optJSONObject("labels") ?: JSONObject()).toString())
      .putExtra(BarcodeScanActivity.EXTRA_GUN, true)
      .putExtra(BarcodeScanActivity.EXTRA_SUFFIX, suffix)
      .putExtra(BarcodeScanActivity.EXTRA_BEEP, o.optBoolean("beep", true))
      .putExtra(BarcodeScanActivity.EXTRA_VIBRATE, o.optBoolean("vibrate", true))
    @Suppress("DEPRECATION") activity.startActivityForResult(intent, REQUEST_GUN)
  }

  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  companion object {
    const val NAME = "ScanKeyboard"
    const val EVENT = "ScanKeyboardStatus"
    private const val REQUEST_GUN = 0x5520
  }
}

class ScanKeyboardPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == ScanKeyboardModule.NAME) ScanKeyboardModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      ScanKeyboardModule.NAME to
        ReactModuleInfo(ScanKeyboardModule.NAME, ScanKeyboardModule.NAME, false, false, false, true),
    )
  }
}
