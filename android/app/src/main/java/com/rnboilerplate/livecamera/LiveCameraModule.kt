package com.rnboilerplate.livecamera

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Handler
import android.os.Looper
import android.util.Base64
import androidx.core.content.ContextCompat
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.rnboilerplate.screenocr.NativeLiveCameraSpec
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * Share Live Camera TurboModule. The camera and the WebRTC stream are owned
 * by react-native-webrtc in JS; this module starts/stops [LiveCameraService]
 * (keeps the app alive in the background), draws QR codes for the share
 * link, and relays [LiveCameraEvents] to JS as `LiveCameraEvent`.
 */
class LiveCameraModule(context: ReactApplicationContext) : NativeLiveCameraSpec(context) {
  private val io = Executors.newSingleThreadExecutor()
  private val main = Handler(Looper.getMainLooper())
  private val connectivity = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
  private var lastNetwork: String? = null

  private val relay: (String, JSONObject) -> Unit = { type, body ->
    if (reactApplicationContext.hasActiveReactInstance()) {
      val map = Arguments.createMap()
      map.putString("type", type)
      map.putString("body", body.toString())
      reactApplicationContext.emitDeviceEvent(EVENT, map)
    }
  }

  /** Coalesces the burst of callbacks a network switch produces into one event. */
  private val emitNetwork =
    Runnable {
      val state = networkState()
      val json = state.toString()
      if (json != lastNetwork) {
        lastNetwork = json
        LiveCameraEvents.emit("network", state)
      }
    }

  private val networkCallback =
    object : ConnectivityManager.NetworkCallback() {
      override fun onAvailable(network: Network) = schedule()

      override fun onLost(network: Network) = schedule()

      override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = schedule()

      private fun schedule() {
        main.removeCallbacks(emitNetwork)
        main.postDelayed(emitNetwork, NETWORK_DEBOUNCE_MS)
      }
    }
  private var networkRegistered = false

  override fun getName() = NAME

  override fun initialize() {
    super.initialize()
    LiveCameraEvents.add(relay)
    // Cheap and silent while nothing changes; lives as long as the module.
    networkRegistered = runCatching { connectivity.registerDefaultNetworkCallback(networkCallback) }.isSuccess
  }

  override fun invalidate() {
    LiveCameraEvents.remove(relay)
    if (networkRegistered) runCatching { connectivity.unregisterNetworkCallback(networkCallback) }
    networkRegistered = false
    main.removeCallbacks(emitNetwork)
    io.shutdown()
    super.invalidate()
  }

  override fun startService(title: String, withAudio: Boolean, promise: Promise) {
    val context = reactApplicationContext
    val missing =
      listOfNotNull(Manifest.permission.CAMERA, if (withAudio) Manifest.permission.RECORD_AUDIO else null)
        .filter { ContextCompat.checkSelfPermission(context, it) != PackageManager.PERMISSION_GRANTED }
    if (missing.isNotEmpty()) {
      promise.reject("permission", "Not granted: ${missing.joinToString()}")
      return
    }
    LiveCameraService.start(context, title.take(MAX_TITLE), withAudio) { error ->
      if (error == null) promise.resolve(null) else promise.reject("start_failed", error.message ?: "Could not start", error)
    }
  }

  override fun updateNotification(text: String) {
    LiveCameraService.update(reactApplicationContext, text.take(MAX_TEXT))
  }

  override fun stopService() {
    LiveCameraService.stop(reactApplicationContext)
  }

  override fun isServiceRunning(promise: Promise) {
    promise.resolve(LiveCameraService.running)
  }

  override fun qrCode(text: String, size: Double, promise: Promise) {
    io.execute {
      try {
        promise.resolve("data:image/png;base64," + qrPng(text, size.toInt().coerceIn(MIN_QR, MAX_QR)))
      } catch (e: Exception) {
        promise.reject("qr_failed", e.message ?: "Could not draw the QR code", e)
      }
    }
  }

  override fun getNetworkState(promise: Promise) {
    promise.resolve(networkState().toString())
  }

  // Events go out through emitDeviceEvent; NativeEventEmitter only needs these to exist.
  /** Copies the viewer link (main thread: ClipboardManager requires a looper). */
  override fun copyText(text: String, promise: Promise) {
    Handler(Looper.getMainLooper()).post {
      try {
        val cm = reactApplicationContext.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText("Live camera link", text))
        promise.resolve(true)
      } catch (e: Exception) {
        promise.resolve(false)
      }
    }
  }

  override fun addListener(eventName: String) = Unit

  override fun removeListeners(count: Double) = Unit

  private fun networkState(): JSONObject {
    val caps = connectivity.activeNetwork?.let { connectivity.getNetworkCapabilities(it) }
    val online =
      caps != null &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
        caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
    val transport =
      when {
        caps == null -> "none"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "wifi"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "cellular"
        caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "ethernet"
        else -> "other"
      }
    return JSONObject().put("online", online).put("transport", transport)
  }

  /** ZXing QR, error correction M, 1-module quiet zone, black on white, encoded as base64 PNG. */
  private fun qrPng(text: String, size: Int): String {
    val hints =
      mapOf(
        EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
        EncodeHintType.MARGIN to 1,
        EncodeHintType.CHARACTER_SET to "UTF-8",
      )
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
    val w = matrix.width
    val h = matrix.height
    val pixels = IntArray(w * h)
    for (y in 0 until h) {
      val row = y * w
      for (x in 0 until w) pixels[row + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
    }
    val bitmap = Bitmap.createBitmap(pixels, w, h, Bitmap.Config.ARGB_8888)
    try {
      val out = ByteArrayOutputStream()
      check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) { "encode_failed" }
      return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } finally {
      bitmap.recycle()
    }
  }

  companion object {
    const val NAME = "LiveCamera"
    const val EVENT = "LiveCameraEvent"
    private const val NETWORK_DEBOUNCE_MS = 300L
    private const val MAX_TITLE = 120
    private const val MAX_TEXT = 300
    private const val MIN_QR = 64
    private const val MAX_QR = 2048
  }
}

class LiveCameraPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == LiveCameraModule.NAME) LiveCameraModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      LiveCameraModule.NAME to
        ReactModuleInfo(LiveCameraModule.NAME, LiveCameraModule.NAME, false, false, false, true),
    )
  }
}
