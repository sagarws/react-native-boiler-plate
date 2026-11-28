package com.rnboilerplate.systemaudio

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * "Hear only the 8D sound": Android cannot stop another app's sound from
 * playing, so the original is silenced with the media volume (0) while the
 * 8D version plays on the accessibility stream, which has its own volume
 * once [EightDVolumeService] is enabled. Playback capture keeps receiving
 * full-level audio at media volume 0 (the capture path uses fixed volume) —
 * verified on device.
 *
 * Media volume is per output (speaker, wired, Bluetooth), so the user's
 * volume is saved per output before it is muted and given back only on that
 * same output, and only while it is still 0 (if the user changed it, their
 * choice wins). If the output changes while the mode is on, the new output
 * is muted too.
 *
 * Bluetooth with absolute volume has one volume for the whole headset: the
 * 8D volume and the media volume cannot differ there, so the original
 * cannot be silenced (the headset pushes the media volume back up as soon
 * as the 8D volume changes). Phones don't let apps read whether absolute
 * volume is on, so this is detected by what happens: on Bluetooth, if media
 * does not stay at 0 ([verify]), the mode ends, the volume is given back and
 * the UI points to the "Disable absolute volume" developer option.
 */
object HearOnly8D {
  private const val TAG = "HearOnly8D"
  private const val PREFS = "system_audio"
  private const val KEY_PREFIX = "hear_only_saved_media_"
  private const val LEGACY_KEY = "hear_only_saved_media_volume"

  enum class StartResult { OK, HELPER_OFF, REFUSED }

  private const val VERIFY_DELAY_MS = 900L

  /** Seen on the current Bluetooth connection: media volume would not stay at 0. */
  @Volatile private var sharedSeen = false

  @Volatile var active = false
    private set

  /** Why the mode last ended on its own ('bt_shared_volume'), for the UI. */
  @Volatile var endedReason: String? = null
    private set

  private val main = Handler(Looper.getMainLooper())
  private var appContext: Context? = null

  private val deviceCallback =
    object : AudioDeviceCallback() {
      override fun onAudioDevicesAdded(added: Array<out AudioDeviceInfo>) = routeChanged()

      override fun onAudioDevicesRemoved(removed: Array<out AudioDeviceInfo>) = routeChanged()
    }

  /** Call once at app start: restores leftovers and follows output changes. */
  fun init(context: Context) {
    val app = context.applicationContext
    Log.i(TAG, "init: route ${route(app)}, saved ${app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).all.keys}")
    appContext = app
    migrateLegacy(app)
    restore(app)
    app.getSystemService(AudioManager::class.java)?.registerAudioDeviceCallback(deviceCallback, main)
  }

  fun start(context: Context): StartResult {
    if (!EightDVolumeService.isEnabled(context)) return StartResult.HELPER_OFF
    val am = context.getSystemService(AudioManager::class.java) ?: return StartResult.REFUSED
    return try {
      val saved = muteCurrentRoute(context, am)
      // The 8D version starts at the loudness the user had for media.
      val mediaMax = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC).coerceAtLeast(1)
      val a11yMax = am.getStreamMaxVolume(AudioManager.STREAM_ACCESSIBILITY).coerceAtLeast(1)
      val target = Math.round(saved.toFloat() / mediaMax * a11yMax).coerceIn(1, a11yMax)
      am.setStreamVolume(AudioManager.STREAM_ACCESSIBILITY, target, 0)
      CaptureStatus.outputMode = CaptureStatus.MODE_ACCESSIBILITY
      endedReason = null
      active = true
      SystemAudioEvents.publish()
      verifyLater(context)
      StartResult.OK
    } catch (e: SecurityException) {
      Log.w(TAG, "volume change refused: ${e.message}")
      restore(context)
      StartResult.REFUSED
    }
  }

  /** Ends the mode and gives the user's media volume back. Safe to call any time. */
  fun stop(context: Context) {
    active = false
    if (CaptureStatus.outputMode == CaptureStatus.MODE_ACCESSIBILITY) CaptureStatus.outputMode = CaptureStatus.MODE_MEDIA
    restore(context)
    SystemAudioEvents.publish()
  }

  /**
   * Gives back the saved media volume of the current output — only while our
   * mute (media 0) is still in effect there. Volumes saved for other outputs
   * wait until that output is in use again.
   */
  fun restore(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val route = route(context)
    val key = KEY_PREFIX + route
    if (!prefs.contains(key)) return
    val saved = prefs.getInt(key, 0)
    val am = context.getSystemService(AudioManager::class.java) ?: return
    val now = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    if (now != 0) {
      // The user set the volume themselves since: their choice wins.
      Log.i(TAG, "restore $route: media is $now, dropping saved $saved")
      prefs.edit().remove(key).commit()
      return
    }
    try {
      am.setStreamVolume(AudioManager.STREAM_MUSIC, saved, 0)
    } catch (e: SecurityException) {
      Log.w(TAG, "restore refused: ${e.message}")
    }
    // Keep the saved value until the volume really is back (a process being
    // torn down may not get the change through); the next start retries.
    val after = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    Log.i(TAG, "restore $route: saved $saved, media now $after")
    if (after == saved || saved == 0) prefs.edit().remove(key).commit()
  }

  /** The 8D volume, 0–1 (accessibility stream). */
  fun volume(context: Context): Float {
    val am = context.getSystemService(AudioManager::class.java) ?: return 0f
    val max = am.getStreamMaxVolume(AudioManager.STREAM_ACCESSIBILITY).coerceAtLeast(1)
    return am.getStreamVolume(AudioManager.STREAM_ACCESSIBILITY).toFloat() / max
  }

  fun setVolume(context: Context, fraction: Float) {
    val am = context.getSystemService(AudioManager::class.java) ?: return
    val max = am.getStreamMaxVolume(AudioManager.STREAM_ACCESSIBILITY)
    try {
      am.setStreamVolume(AudioManager.STREAM_ACCESSIBILITY, Math.round(fraction.coerceIn(0f, 1f) * max), 0)
    } catch (e: SecurityException) {
      Log.w(TAG, "8D volume refused: ${e.message}")
    }
    SystemAudioEvents.publish()
    verifyLater(context)
  }

  /** Re-checks shortly after a volume change (the headset answers asynchronously). */
  fun verifyLater(context: Context) {
    val app = context.applicationContext
    main.postDelayed({ verify(app) }, VERIFY_DELAY_MS)
  }

  /**
   * While the mode is on, media must stay at 0. On Bluetooth, media coming
   * back up means the headset shares one volume (absolute volume): end the
   * mode and say why.
   */
  private fun verify(context: Context) {
    if (!active || route(context) != ROUTE_BT) return
    val am = context.getSystemService(AudioManager::class.java) ?: return
    if (am.getStreamVolume(AudioManager.STREAM_MUSIC) == 0) return
    Log.i(TAG, "media volume came back on Bluetooth: shared (absolute) volume")
    sharedSeen = true
    endedReason = "bt_shared_volume"
    // Our mute no longer holds; the saved value for this output is stale.
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY_PREFIX + ROUTE_BT).apply()
    stop(context)
  }

  /** Media plays to a Bluetooth output already seen to share one volume. */
  fun sharedVolumeOutput(context: Context): Boolean = sharedSeen && route(context) == ROUTE_BT

  // --- internals ---

  private const val ROUTE_BT = "bt"
  private const val ROUTE_WIRED = "wired"
  private const val ROUTE_SPEAKER = "speaker"

  /** Where media plays now (Android routes media to Bluetooth, then wired, then the speaker). */
  private fun route(context: Context): String {
    val am = context.getSystemService(AudioManager::class.java) ?: return ROUTE_SPEAKER
    val types = am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).map { it.type }.toSet()
    val bt =
      mutableSetOf(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP, AudioDeviceInfo.TYPE_HEARING_AID).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          add(AudioDeviceInfo.TYPE_BLE_HEADSET)
          add(AudioDeviceInfo.TYPE_BLE_SPEAKER)
        }
      }
    val wired =
      setOf(
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        AudioDeviceInfo.TYPE_USB_HEADSET,
        AudioDeviceInfo.TYPE_USB_DEVICE,
      )
    return when {
      types.any { it in bt } -> ROUTE_BT
      types.any { it in wired } -> ROUTE_WIRED
      else -> ROUTE_SPEAKER
    }
  }

  /** Saves the current output's media volume (once) and sets it to 0. Returns the saved volume. */
  private fun muteCurrentRoute(context: Context, am: AudioManager): Int {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val key = KEY_PREFIX + route(context)
    val media = am.getStreamVolume(AudioManager.STREAM_MUSIC)
    // Keep the first saved value if this output is already muted by us.
    if (!prefs.contains(key)) prefs.edit().putInt(key, media).commit()
    Log.i(TAG, "mute ${route(context)}: saved ${prefs.getInt(key, media)} (media was $media)")
    am.setStreamVolume(AudioManager.STREAM_MUSIC, 0, 0)
    return prefs.getInt(key, media)
  }

  private fun routeChanged() {
    val ctx = appContext ?: return
    if (route(ctx) != ROUTE_BT) sharedSeen = false // A new connection gets a fresh check.
    if (!active) {
      restore(ctx) // An output we muted earlier is back: give its volume back.
      return
    }
    val am = ctx.getSystemService(AudioManager::class.java) ?: return
    try {
      muteCurrentRoute(ctx, am)
    } catch (e: SecurityException) {
      Log.w(TAG, "mute on new output refused: ${e.message}")
    }
    SystemAudioEvents.publish()
    verifyLater(ctx)
  }

  private fun migrateLegacy(context: Context) {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.contains(LEGACY_KEY)) return
    val v = prefs.getInt(LEGACY_KEY, 0)
    prefs.edit().remove(LEGACY_KEY).putInt(KEY_PREFIX + route(context), v).commit()
  }
}
