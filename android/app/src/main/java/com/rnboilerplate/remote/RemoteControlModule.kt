package com.rnboilerplate.remote

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.DisplayMetrics
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import com.rnboilerplate.R
import com.rnboilerplate.screenocr.NativeRemoteControlSpec
import java.net.Inet4Address
import java.net.NetworkInterface
import java.security.KeyStore
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONArray
import org.json.JSONObject

/**
 * Remote Access TurboModule: network facts for LAN discovery, the screen's
 * size, keep-screen-on while viewing, the incoming-request notification, and
 * the bridge to [RemoteControlService] for input when this phone is
 * controlled. Session rules (who may control, for how long) are enforced in
 * the JS host service before anything reaches here.
 */
class RemoteControlModule(context: ReactApplicationContext) : NativeRemoteControlSpec(context) {
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun getName() = NAME

  override fun invalidate() {
    releaseLock()
    super.invalidate()
  }

  /**
   * Argon2id for the password check (BouncyCastle; same output as the
   * desktop's node:crypto and @noble/hashes). Off the UI and JS threads; one
   * at a time, so a burst of attempts cannot claim many 64 MiB buffers.
   */
  override fun argon2id(
    password: String,
    salt: String,
    t: Double,
    m: Double,
    p: Double,
    dkLen: Double,
    promise: Promise,
  ) {
    kdfExecutor.execute {
      try {
        val passes = t.toInt()
        val memoryKiB = m.toInt()
        val lanes = p.toInt()
        val length = dkLen.toInt()
        require(passes in 1..10 && memoryKiB in 8..262_144 && lanes in 1..4 && length in 16..64) {
          "Unsafe password settings."
        }
        val pw = Base64.decode(password, Base64.NO_WRAP)
        val params =
          Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
            .withVersion(Argon2Parameters.ARGON2_VERSION_13)
            .withSalt(Base64.decode(salt, Base64.NO_WRAP))
            .withIterations(passes)
            .withMemoryAsKB(memoryKiB)
            .withParallelism(lanes)
            .build()
        val out = ByteArray(length)
        val generator = Argon2BytesGenerator()
        generator.init(params)
        generator.generateBytes(pw, out)
        pw.fill(0)
        promise.resolve(Base64.encodeToString(out, Base64.NO_WRAP))
      } catch (e: Throwable) {
        promise.reject("E_ARGON2", e.message ?: "Argon2 failed", e)
      }
    }
  }

  /** The Keystore key for saved connection passwords, created on first use. */
  private fun secretKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(SECRET_KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        SECRET_KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build(),
    )
    return generator.generateKey()
  }

  override fun sealSecret(plain: String, promise: Promise) {
    kdfExecutor.execute {
      try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val sealed = cipher.iv + cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
        promise.resolve(Base64.encodeToString(sealed, Base64.NO_WRAP))
      } catch (e: Throwable) {
        promise.reject("E_SEAL", e.message ?: "Could not encrypt", e)
      }
    }
  }

  override fun openSecret(sealed: String, promise: Promise) {
    kdfExecutor.execute {
      try {
        val bytes = Base64.decode(sealed, Base64.NO_WRAP)
        require(bytes.size > GCM_IV_BYTES + 16) { "Damaged secret." }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
          Cipher.DECRYPT_MODE,
          secretKey(),
          GCMParameterSpec(128, bytes, 0, GCM_IV_BYTES),
        )
        val plain = cipher.doFinal(bytes, GCM_IV_BYTES, bytes.size - GCM_IV_BYTES)
        promise.resolve(String(plain, Charsets.UTF_8))
      } catch (e: Throwable) {
        promise.reject("E_OPEN", e.message ?: "Could not decrypt", e)
      }
    }
  }

  override fun getNetworkAddresses(promise: Promise) {
    val out = JSONArray()
    runCatching {
      for (nif in NetworkInterface.getNetworkInterfaces()) {
        if (!nif.isUp || nif.isLoopback) continue
        for (addr in nif.interfaceAddresses) {
          val ip = addr.address as? Inet4Address ?: continue
          out.put(
            JSONObject()
              .put("address", ip.hostAddress)
              .put("broadcast", addr.broadcast?.hostAddress ?: JSONObject.NULL)
              .put("name", nif.name),
          )
        }
      }
    }
    promise.resolve(out.toString())
  }

  override fun setDiscoveryLock(enabled: Boolean) {
    if (!enabled) return releaseLock()
    if (multicastLock?.isHeld == true) return
    val wifi = reactApplicationContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager ?: return
    multicastLock = wifi.createMulticastLock("remote-discovery").apply {
      setReferenceCounted(false)
      runCatching { acquire() }
    }
  }

  private fun releaseLock() {
    runCatching { multicastLock?.takeIf { it.isHeld }?.release() }
    multicastLock = null
  }

  override fun getScreenInfo(promise: Promise) {
    val wm = reactApplicationContext.getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val metrics = reactApplicationContext.resources.displayMetrics
    val (w, h) = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      wm.currentWindowMetrics.bounds.let { it.width() to it.height() }
    } else {
      val real = DisplayMetrics()
      @Suppress("DEPRECATION")
      wm.defaultDisplay.getRealMetrics(real)
      real.widthPixels to real.heightPixels
    }
    @Suppress("DEPRECATION")
    val rotation = wm.defaultDisplay.rotation
    promise.resolve(
      JSONObject()
        .put("width", w)
        .put("height", h)
        .put("density", metrics.density.toDouble())
        .put("rotation", rotation)
        .toString(),
    )
  }

  override fun setKeepScreenOn(enabled: Boolean) {
    UiThreadUtil.runOnUiThread {
      val window = reactApplicationContext.currentActivity?.window ?: return@runOnUiThread
      if (enabled) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  override fun isControlServiceEnabled(promise: Promise) {
    promise.resolve(RemoteControlService.isEnabled(reactApplicationContext) && RemoteControlService.current() != null)
  }

  override fun openControlServiceSettings() {
    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { reactApplicationContext.startActivity(intent) }
  }

  override fun pointer(action: String, x: Double, y: Double, button: Double) {
    RemoteControlService.current()?.pointer(action, x, y, button.toInt())
  }

  override fun scroll(x: Double, y: Double, dx: Double, dy: Double) {
    RemoteControlService.current()?.scroll(x, y, dx, dy)
  }

  override fun globalAction(name: String, promise: Promise) {
    val service = RemoteControlService.current() ?: return promise.resolve(false)
    UiThreadUtil.runOnUiThread { promise.resolve(runCatching { service.global(name) }.getOrDefault(false)) }
  }

  override fun typeText(text: String, promise: Promise) {
    val service = RemoteControlService.current() ?: return promise.resolve(false)
    UiThreadUtil.runOnUiThread { promise.resolve(runCatching { service.typeText(text.take(MAX_TEXT)) }.getOrDefault(false)) }
  }

  override fun editAction(name: String, promise: Promise) {
    val service = RemoteControlService.current() ?: return promise.resolve(false)
    UiThreadUtil.runOnUiThread { promise.resolve(runCatching { service.edit(name) }.getOrDefault(false)) }
  }

  override fun notifyIncoming(title: String, text: String) {
    val context = reactApplicationContext.applicationContext
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, context.getString(R.string.remote_channel_name), NotificationManager.IMPORTANCE_HIGH).apply {
          description = context.getString(R.string.remote_channel_description)
        },
      )
    }
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val content = launch?.let {
      PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title.take(120))
      .setContentText(text.take(300))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .setAutoCancel(true)
      .setTimeoutAfter(60_000)
      .apply { if (content != null) setContentIntent(content) }
      .build()
    runCatching { manager.notify(NOTIFICATION_ID, notification) }
  }

  override fun cancelIncoming() {
    val manager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(NOTIFICATION_ID)
  }

  companion object {
    const val NAME = "RemoteControl"
    private const val CHANNEL_ID = "remote_access_requests"
    private const val NOTIFICATION_ID = 47_801
    private const val MAX_TEXT = 4096
    private const val SECRET_KEY_ALIAS = "featured_remote_saved_passwords"
    private const val GCM_IV_BYTES = 12
    /** One password check at a time (each may hold up to 256 MiB); also seals/opens saved passwords. */
    private val kdfExecutor = Executors.newSingleThreadExecutor()
  }
}

class RemoteControlPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == RemoteControlModule.NAME) RemoteControlModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      RemoteControlModule.NAME to
        ReactModuleInfo(RemoteControlModule.NAME, RemoteControlModule.NAME, false, false, false, true),
    )
  }
}
