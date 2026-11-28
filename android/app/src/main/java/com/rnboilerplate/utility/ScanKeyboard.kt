package com.rnboilerplate.utility

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothHidDevice
import android.bluetooth.BluetoothHidDeviceAppSdpSettings
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet
import java.util.concurrent.Executors

/**
 * Scanner gun: the phone becomes a Bluetooth keyboard (HID device profile,
 * Android 9+), so a scanned code is typed into whatever field has the cursor
 * on the paired computer, like a USB/Bluetooth barcode scanner. Nothing is
 * installed on the computer.
 *
 * The keyboard exists only while the Scanner gun screen is open ([start] →
 * [stop]). Keys follow the US layout (what scanner guns send by default);
 * characters a US keyboard cannot type are skipped and counted.
 */
@SuppressLint("MissingPermission") // Every entry point checks [hasPermission] first.
object ScanKeyboard {
  private const val TAG = "ScanKeyboard"
  private const val PREFS = "scan_keyboard"
  private const val KEY_HOST = "last_host"
  private const val REPORT_ID = 1
  private const val KEY_DELAY_MS = 4L

  const val STATE_UNSUPPORTED = "unsupported"
  const val STATE_PERMISSION = "permission"
  const val STATE_BLUETOOTH_OFF = "bluetooth_off"
  const val STATE_STOPPED = "stopped"
  const val STATE_STARTING = "starting"
  const val STATE_READY = "ready"
  const val STATE_CONNECTING = "connecting"
  const val STATE_CONNECTED = "connected"

  /** Standard boot keyboard: modifiers, reserved, six keys (report ID 1); LED output. */
  private val DESCRIPTOR = byteArrayOf(
    0x05, 0x01, 0x09, 0x06, 0xA1.toByte(), 0x01, 0x85.toByte(), REPORT_ID.toByte(),
    0x05, 0x07, 0x19, 0xE0.toByte(), 0x29, 0xE7.toByte(), 0x15, 0x00, 0x25, 0x01,
    0x75, 0x01, 0x95.toByte(), 0x08, 0x81.toByte(), 0x02,
    0x95.toByte(), 0x01, 0x75, 0x08, 0x81.toByte(), 0x01,
    0x95.toByte(), 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91.toByte(), 0x02,
    0x95.toByte(), 0x01, 0x75, 0x03, 0x91.toByte(), 0x01,
    0x95.toByte(), 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65,
    0x81.toByte(), 0x00,
    0xC0.toByte(),
  )

  private val main = Handler(Looper.getMainLooper())
  private val typing = Executors.newSingleThreadExecutor()
  private val listeners = CopyOnWriteArraySet<() -> Unit>()

  private var app: Context? = null
  private var hid: BluetoothHidDevice? = null
  @Volatile private var wanted = false
  @Volatile private var registered = false
  @Volatile private var host: BluetoothDevice? = null
  @Volatile private var connecting: BluetoothDevice? = null

  fun addListener(l: () -> Unit) = listeners.add(l)

  fun removeListener(l: () -> Unit) = listeners.remove(l)

  private fun changed() = main.post { listeners.forEach { it() } }

  private fun adapter(context: Context): BluetoothAdapter? =
    context.getSystemService(BluetoothManager::class.java)?.adapter

  fun hasPermission(context: Context): Boolean =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
      PackageManager.PERMISSION_GRANTED

  fun state(context: Context): String {
    val adapter = adapter(context)
    return when {
      Build.VERSION.SDK_INT < Build.VERSION_CODES.P || adapter == null -> STATE_UNSUPPORTED
      !hasPermission(context) -> STATE_PERMISSION
      !adapter.isEnabled -> STATE_BLUETOOTH_OFF
      !wanted -> STATE_STOPPED
      host != null -> STATE_CONNECTED
      connecting != null -> STATE_CONNECTING
      registered -> STATE_READY
      else -> STATE_STARTING
    }
  }

  val connected: Boolean get() = host != null

  fun hostName(): String? = host?.let { nameOf(it) }

  private fun nameOf(d: BluetoothDevice): String =
    try {
      d.name ?: d.address
    } catch (_: SecurityException) {
      d.address
    }

  fun statusJson(context: Context): String {
    val o = JSONObject().put("state", state(context))
    host?.let { o.put("host", JSONObject().put("name", nameOf(it)).put("address", it.address)) }
    connecting?.let { o.put("connecting", it.address) }
    if (hasPermission(context)) o.put("phoneName", adapter(context)?.name ?: "")
    return o.toString()
  }

  /** Paired devices, computers first, with the last-used one marked. */
  fun hostsJson(context: Context): String {
    val out = JSONArray()
    val adapter = adapter(context) ?: return out.toString()
    if (!hasPermission(context)) return out.toString()
    val last = prefs(context).getString(KEY_HOST, null)
    adapter.bondedDevices
      .sortedWith(compareByDescending<BluetoothDevice> { isComputer(it) }.thenBy { nameOf(it).lowercase() })
      .forEach {
        out.put(
          JSONObject()
            .put("name", nameOf(it))
            .put("address", it.address)
            .put("computer", isComputer(it))
            .put("connected", it.address == host?.address)
            .put("last", it.address == last),
        )
      }
    return out.toString()
  }

  private fun isComputer(d: BluetoothDevice): Boolean =
    try {
      d.bluetoothClass?.majorDeviceClass == BluetoothClass.Device.Major.COMPUTER
    } catch (_: SecurityException) {
      false
    }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** Registers the keyboard. Resolves (via [changed]) to ready / connected. */
  fun start(context: Context): String {
    val ctx = context.applicationContext
    app = ctx
    val s = state(ctx).let { if (it == STATE_STOPPED) STATE_STARTING else it }
    if (s == STATE_UNSUPPORTED || s == STATE_PERMISSION || s == STATE_BLUETOOTH_OFF) return s
    wanted = true
    val existing = hid
    if (existing != null) {
      if (!registered) register(ctx, existing)
      return state(ctx)
    }
    val ok = adapter(ctx)?.getProfileProxy(ctx, proxyListener, BluetoothProfile.HID_DEVICE) == true
    if (!ok) {
      wanted = false
      return STATE_UNSUPPORTED
    }
    changed()
    return state(ctx)
  }

  /** Disconnects and removes the keyboard (the computer stops seeing it). */
  fun stop() {
    wanted = false
    val ctx = app ?: return
    val h = hid
    try {
      host?.let { h?.disconnect(it) }
      if (registered) h?.unregisterApp()
    } catch (e: SecurityException) {
      Log.w(TAG, "stop: ${e.message}")
    }
    registered = false
    host = null
    connecting = null
    if (h != null) adapter(ctx)?.closeProfileProxy(BluetoothProfile.HID_DEVICE, h)
    hid = null
    changed()
  }

  fun connect(context: Context, address: String): Boolean {
    val h = hid ?: return false
    if (!registered || !hasPermission(context)) return false
    val device = try {
      adapter(context)?.getRemoteDevice(address)
    } catch (_: IllegalArgumentException) {
      null
    } ?: return false
    host?.let { if (it.address != address) h.disconnect(it) }
    connecting = device
    changed()
    val ok = h.connect(device)
    if (!ok) {
      connecting = null
      changed()
    }
    return ok
  }

  fun disconnect() {
    val h = hid ?: return
    try {
      host?.let { h.disconnect(it) }
    } catch (e: SecurityException) {
      Log.w(TAG, "disconnect: ${e.message}")
    }
  }

  private val proxyListener =
    object : BluetoothProfile.ServiceListener {
      override fun onServiceConnected(profile: Int, proxy: BluetoothProfile) {
        val h = proxy as? BluetoothHidDevice ?: return
        val ctx = app ?: return
        if (!wanted) {
          adapter(ctx)?.closeProfileProxy(BluetoothProfile.HID_DEVICE, h)
          return
        }
        hid = h
        register(ctx, h)
      }

      override fun onServiceDisconnected(profile: Int) {
        // Bluetooth went off: the screen starts again ('stopped') when it's back.
        wanted = false
        hid = null
        registered = false
        host = null
        connecting = null
        changed()
      }
    }

  private fun register(ctx: Context, h: BluetoothHidDevice) {
    if (!hasPermission(ctx)) return
    val sdp = BluetoothHidDeviceAppSdpSettings(
      "Scanner keyboard",
      "Types scanned codes",
      "Featured App",
      BluetoothHidDevice.SUBCLASS1_KEYBOARD,
      DESCRIPTOR,
    )
    val ok = h.registerApp(sdp, null, null, Executors.newSingleThreadExecutor(), callback)
    Log.i(TAG, "registerApp: $ok")
    changed()
  }

  private val callback =
    object : BluetoothHidDevice.Callback() {
      override fun onAppStatusChanged(pluggedDevice: BluetoothDevice?, registered: Boolean) {
        this@ScanKeyboard.registered = registered
        Log.i(TAG, "app registered=$registered plugged=${pluggedDevice?.address}")
        val ctx = app
        if (registered && ctx != null && host == null) {
          // Reconnect to the computer used last time (or the one Android offers).
          val address = pluggedDevice?.address ?: prefs(ctx).getString(KEY_HOST, null)
          if (address != null && isBonded(ctx, address)) connect(ctx, address)
        }
        if (!registered) {
          host = null
          connecting = null
        }
        changed()
      }

      override fun onConnectionStateChanged(device: BluetoothDevice, state: Int) {
        Log.i(TAG, "connection ${device.address}: $state")
        when (state) {
          BluetoothProfile.STATE_CONNECTED -> {
            host = device
            connecting = null
            app?.let { prefs(it).edit().putString(KEY_HOST, device.address).apply() }
          }
          BluetoothProfile.STATE_CONNECTING -> connecting = device
          BluetoothProfile.STATE_DISCONNECTED -> {
            if (host?.address == device.address) host = null
            if (connecting?.address == device.address) connecting = null
          }
        }
        changed()
      }

      override fun onGetReport(device: BluetoothDevice, type: Byte, id: Byte, bufferSize: Int) {
        try {
          hid?.replyReport(device, type, REPORT_ID.toByte(), ByteArray(8))
        } catch (e: SecurityException) {
          Log.w(TAG, "replyReport: ${e.message}")
        }
      }
    }

  private fun isBonded(ctx: Context, address: String): Boolean =
    try {
      adapter(ctx)?.bondedDevices?.any { it.address == address } == true
    } catch (_: SecurityException) {
      false
    }

  /**
   * Types [text] on the connected computer, in order with earlier calls.
   * [done] gets (typed, skipped characters) on the main thread; typed is
   * false when no computer is connected or the link dropped.
   */
  fun type(text: String, done: (Boolean, Int) -> Unit) {
    val h = hid
    val device = host
    if (h == null || device == null) {
      main.post { done(false, 0) }
      return
    }
    typing.execute {
      var skipped = 0
      var ok = true
      val release = ByteArray(8)
      var i = 0
      while (i < text.length && ok) {
        val ch = text[i]
        // \r\n is one Enter.
        if (ch == '\r' && i + 1 < text.length && text[i + 1] == '\n') {
          i++
          continue
        }
        val key = KeyMap.of(ch)
        if (key == null) {
          skipped++
        } else {
          val down = ByteArray(8).also {
            it[0] = key.first.toByte()
            it[2] = key.second.toByte()
          }
          ok = send(h, device, down) && send(h, device, release)
        }
        i++
      }
      main.post { done(ok, skipped) }
    }
  }

  private fun send(h: BluetoothHidDevice, d: BluetoothDevice, report: ByteArray): Boolean {
    val ok = try {
      h.sendReport(d, REPORT_ID, report)
    } catch (e: SecurityException) {
      false
    }
    Thread.sleep(KEY_DELAY_MS)
    return ok
  }

  /** US layout: char → (modifier, HID usage). */
  object KeyMap {
    private const val SHIFT = 0x02
    private const val PLAIN = "-=[]\\;'`,./"
    private const val SHIFTED = "_+{}|:\"~<>?"
    private val PUNCT = intArrayOf(0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38)
    private const val SHIFT_DIGITS = "!@#\$%^&*()"

    fun of(c: Char): Pair<Int, Int>? =
      when (c) {
        in 'a'..'z' -> 0 to 0x04 + (c - 'a')
        in 'A'..'Z' -> SHIFT to 0x04 + (c - 'A')
        in '1'..'9' -> 0 to 0x1E + (c - '1')
        '0' -> 0 to 0x27
        '\n', '\r' -> 0 to 0x28
        '\t' -> 0 to 0x2B
        ' ' -> 0 to 0x2C
        else -> {
          val p = PLAIN.indexOf(c)
          val s = SHIFTED.indexOf(c)
          val d = SHIFT_DIGITS.indexOf(c)
          when {
            p >= 0 -> 0 to PUNCT[p]
            s >= 0 -> SHIFT to PUNCT[s]
            d >= 0 -> SHIFT to (if (d == 9) 0x27 else 0x1E + d)
            else -> null
          }
        }
      }
  }
}
