package com.rnboilerplate.alarms

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import com.rnboilerplate.R
import org.json.JSONObject

/**
 * Rings one alarm: its ringtone on the alarm stream at the chosen volume
 * (relative to the phone's alarm volume, which is never changed) and its
 * vibration pattern, with an ongoing notification offering Snooze and
 * Dismiss. Stops on Dismiss / Snooze or after the alarm's ring time; the
 * notification then stays as a plain "missed" one.
 *
 * It's a foreground service so the sound keeps playing with the app closed.
 * Android lets an app start one from an exact alarm; when it can't (no
 * exact-alarm permission), [AlarmAlert] falls back to a notification that
 * plays the default alarm sound itself.
 */
class AlarmRingService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var current: AlarmEntry? = null
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var wake: PowerManager.WakeLock? = null
  private var focus: AudioFocusRequest? = null
  private val autoStop = Runnable { finishCurrent(missed = true) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  override fun onDestroy() {
    stopSound()
    instance = null
    super.onDestroy()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val entry = intent?.getStringExtra(EXTRA_ENTRY)?.let { AlarmEntry.from(runCatching { JSONObject(it) }.getOrNull()) }
    if (entry == null) {
      // Must still satisfy startForegroundService() before stopping.
      startAsForeground(AlarmAlert.placeholder(this))
      stopEverything(remove = true)
      return START_NOT_STICKY
    }
    // A new alarm while another rings: the older one becomes a "missed" notification.
    current?.let { if (it.key != entry.key) finishCurrent(missed = true, keepService = true) }
    current = entry
    val notification = AlarmAlert.ringing(this, entry)
    if (!startAsForeground(notification, AlarmAlert.notificationId(entry.key))) {
      AlarmAlert.fallback(this, entry)
      current = null
      stopSelf()
      return START_NOT_STICKY
    }
    startSound(entry)
    handler.removeCallbacks(autoStop)
    handler.postDelayed(autoStop, entry.alert.ringSeconds * 1000L)
    if (entry.alert.priority) AlarmActivity.show(this, entry)
    return START_NOT_STICKY
  }

  private fun startAsForeground(n: Notification, id: Int = PLACEHOLDER_ID): Boolean {
    val type = when {
      Build.VERSION.SDK_INT >= 34 ->
        if (AlarmScheduler.canScheduleExact(this)) ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED
        else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      Build.VERSION.SDK_INT >= 29 -> ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      else -> 0
    }
    return try {
      ServiceCompat.startForeground(this, id, n, type)
      true
    } catch (_: Exception) {
      false
    }
  }

  private fun startSound(e: AlarmEntry) {
    stopSound()
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "akshar:alarm").apply {
      acquire(e.alert.ringSeconds * 1000L + 5_000L)
    }
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    if (e.alert.sound) {
      val audio = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      if (Build.VERSION.SDK_INT >= 26) {
        focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).build()
          .also { audio.requestAudioFocus(it) }
      }
      val volume = if (e.alert.priority) 1f else e.alert.volume / 100f
      player = AlarmSounds.player(this, e.alert.ringtone, attrs, volume, loop = true)?.also { it.start() }
    }
    if (e.alert.vibrate) {
      vibrator = AlarmSounds.vibrator(this)?.also { v ->
        val pattern = AlarmSounds.pattern(e.alert.vibration)
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT >= 26) v.vibrate(VibrationEffect.createWaveform(pattern, 0), attrs)
        else v.vibrate(pattern, 0)
      }
    }
  }

  private fun stopSound() {
    handler.removeCallbacks(autoStop)
    player?.let {
      runCatching { it.stop() }
      it.release()
    }
    player = null
    vibrator?.cancel()
    vibrator = null
    if (Build.VERSION.SDK_INT >= 26) {
      focus?.let { (getSystemService(Context.AUDIO_SERVICE) as AudioManager).abandonAudioFocusRequest(it) }
    }
    focus = null
    wake?.let { if (it.isHeld) it.release() }
    wake = null
  }

  /** Ends the current ring; a missed one keeps a plain notification. */
  private fun finishCurrent(missed: Boolean, keepService: Boolean = false) {
    val e = current ?: return
    current = null
    stopSound()
    AlarmActivity.close(e.key)
    if (missed) AlarmAlert.missed(this, e) else NotificationManagerCompat.from(this).cancel(AlarmAlert.notificationId(e.key))
    // A missed alarm keeps its (now plain) notification; a dismissed one doesn't.
    if (!keepService) stopEverything(remove = !missed)
  }

  private fun stopEverything(remove: Boolean) {
    ServiceCompat.stopForeground(
      this,
      if (remove) ServiceCompat.STOP_FOREGROUND_REMOVE else ServiceCompat.STOP_FOREGROUND_DETACH,
    )
    stopSelf()
  }

  /** Stops [key] if it's ringing (Dismiss / Snooze / deleted in the app). */
  fun stop(key: String?) {
    val e = current ?: return
    if (key == null || e.key == key) finishCurrent(missed = false)
  }

  companion object {
    const val EXTRA_ENTRY = "entry"
    private const val PLACEHOLDER_ID = 0x7300
    @Volatile var instance: AlarmRingService? = null

    fun ringingKey(): String? = instance?.current?.key

    /** Stops the ring for [key] (null = whatever rings). Safe from any thread. */
    fun stop(context: Context, key: String?) {
      Handler(Looper.getMainLooper()).post { instance?.stop(key) }
      if (key != null) NotificationManagerCompat.from(context).cancel(AlarmAlert.notificationId(key))
    }
  }
}

/** Ringtones, preview and vibration helpers. */
object AlarmSounds {
  fun defaultUri(): Uri =
    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)

  /** A prepared player for [ringtone] ('' = default), or null if nothing can play. */
  fun player(context: Context, ringtone: String, attrs: AudioAttributes, volume: Float, loop: Boolean): MediaPlayer? {
    val candidates = listOfNotNull(ringtone.takeIf { it.isNotBlank() }?.let(Uri::parse), defaultUri())
    for (uri in candidates) {
      val p = MediaPlayer()
      try {
        p.setAudioAttributes(attrs)
        p.setDataSource(context, uri)
        p.isLooping = loop
        p.setVolume(volume, volume)
        p.prepare()
        return p
      } catch (_: Exception) {
        p.release()
      }
    }
    return null
  }

  fun title(context: Context, ringtone: String): String =
    try {
      val uri = ringtone.takeIf { it.isNotBlank() }?.let(Uri::parse) ?: defaultUri()
      RingtoneManager.getRingtone(context, uri)?.getTitle(context).orEmpty()
    } catch (_: Exception) {
      ""
    }

  fun vibrator(context: Context): Vibrator? {
    val v = if (Build.VERSION.SDK_INT >= 31) {
      (context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
    } else {
      @Suppress("DEPRECATION") context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
    }
    return v.takeIf { it.hasVibrator() }
  }

  fun pattern(name: String): LongArray = AlertConfig.pattern(name)

  private var preview: MediaPlayer? = null
  private val handler = Handler(Looper.getMainLooper())
  private val stopPreviewTask = Runnable { stopPreview() }

  /** Plays [ringtone] for a few seconds at [volume] (0–100) on the alarm stream. */
  fun preview(context: Context, ringtone: String, volume: Int): Boolean {
    stopPreview()
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ALARM)
      .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
      .build()
    val p = player(context, ringtone, attrs, volume.coerceIn(0, 100) / 100f, loop = false) ?: return false
    preview = p
    p.setOnCompletionListener { stopPreview() }
    p.start()
    handler.postDelayed(stopPreviewTask, 6_000L)
    return true
  }

  fun stopPreview() {
    handler.removeCallbacks(stopPreviewTask)
    preview?.let {
      runCatching { it.stop() }
      it.release()
    }
    preview = null
  }
}

/** Notifications for ringing, silent, missed and fallback alarms. */
object AlarmAlert {
  private const val CH_RINGING = "alarms_ringing"
  private const val CH_SILENT = "alarms_silent"
  private const val CH_FALLBACK = "alarms_fallback"
  private const val CH_FALLBACK_VIBRATE = "alarms_fallback_vibrate"
  const val ACTION_SNOOZE = "com.rnboilerplate.alarms.SNOOZE"
  const val ACTION_DISMISS = "com.rnboilerplate.alarms.DISMISS"
  const val EXTRA_ENTRY = "entry"

  fun notificationId(key: String) = 0x7400 + (key.hashCode() and 0xFFFF)

  /** Rings [e]: silent → plain notification, otherwise the ring service. */
  fun deliver(context: Context, e: AlarmEntry) {
    if (e.alert.mode == "silent") {
      notify(context, e, base(context, CH_SILENT, e).setPriority(NotificationCompat.PRIORITY_DEFAULT).build())
      return
    }
    val intent = Intent(context, AlarmRingService::class.java).putExtra(AlarmRingService.EXTRA_ENTRY, e.toJson().toString())
    try {
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    } catch (_: Exception) {
      // Background start not allowed (e.g. inexact alarm): alert by notification.
      fallback(context, e)
    }
  }

  private fun ensureChannels(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val nm = context.getSystemService(NotificationManager::class.java) ?: return
    fun make(id: String, name: Int, importance: Int, block: NotificationChannel.() -> Unit) {
      if (nm.getNotificationChannel(id) == null)
        nm.createNotificationChannel(NotificationChannel(id, context.getString(name), importance).apply(block))
    }
    make(CH_RINGING, R.string.alarms_channel_ringing, NotificationManager.IMPORTANCE_HIGH) {
      // The service plays the sound and vibration itself.
      setSound(null, null)
      enableVibration(false)
    }
    make(CH_SILENT, R.string.alarms_channel_silent, NotificationManager.IMPORTANCE_DEFAULT) {
      setSound(null, null)
      enableVibration(false)
    }
    make(CH_FALLBACK, R.string.alarms_channel_fallback, NotificationManager.IMPORTANCE_HIGH) {
      setSound(AlarmSounds.defaultUri(), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build())
      enableVibration(true)
      vibrationPattern = AlertConfig.pattern("default")
    }
    make(CH_FALLBACK_VIBRATE, R.string.alarms_channel_fallback_vibrate, NotificationManager.IMPORTANCE_HIGH) {
      setSound(null, null)
      enableVibration(true)
      vibrationPattern = AlertConfig.pattern("default")
    }
  }

  private fun action(context: Context, action: String, e: AlarmEntry): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      notificationId(e.key) + if (action == ACTION_SNOOZE) 1 else 2,
      Intent(context, AlarmActionReceiver::class.java)
        .setAction(action)
        .setData(Uri.parse("akshar-alarm://${action.substringAfterLast('.').lowercase()}/${Uri.encode(e.key)}"))
        .putExtra(EXTRA_ENTRY, e.toJson().toString()),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun open(context: Context, e: AlarmEntry): PendingIntent? {
    val intent = if (e.link.isNotBlank()) {
      Intent(Intent.ACTION_VIEW, Uri.parse(e.link)).setPackage(context.packageName)
    } else {
      context.packageManager.getLaunchIntentForPackage(context.packageName)
    } ?: return null
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    return PendingIntent.getActivity(context, notificationId(e.key), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  private fun base(context: Context, channel: String, e: AlarmEntry): NotificationCompat.Builder {
    ensureChannels(context)
    return NotificationCompat.Builder(context, channel)
      .setSmallIcon(R.drawable.ic_bell)
      .setContentTitle(e.title)
      .setContentText(e.body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(e.body))
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
      .setAutoCancel(true)
      .apply {
        open(context, e)?.let { setContentIntent(it) }
        if (e.alert.snoozeMinutes > 0)
          addAction(0, context.getString(R.string.alarms_snooze, e.alert.snoozeMinutes), action(context, ACTION_SNOOZE, e))
        addAction(0, context.getString(R.string.alarms_dismiss), action(context, ACTION_DISMISS, e))
      }
  }

  fun ringing(context: Context, e: AlarmEntry): Notification =
    base(context, CH_RINGING, e)
      .setPriority(NotificationCompat.PRIORITY_MAX)
      .setOngoing(true)
      .setAutoCancel(false)
      .setDeleteIntent(action(context, ACTION_DISMISS, e))
      .apply {
        if (e.alert.priority && AlarmActivity.canFullScreen(context))
          setFullScreenIntent(AlarmActivity.pending(context, e), true)
      }
      .build()

  fun placeholder(context: Context): Notification {
    ensureChannels(context)
    return NotificationCompat.Builder(context, CH_SILENT)
      .setSmallIcon(R.drawable.ic_bell)
      .setContentTitle(context.getString(R.string.alarms_channel_ringing))
      .build()
  }

  /** The ring ended without an answer: leave a plain notification. */
  fun missed(context: Context, e: AlarmEntry) {
    notify(context, e, base(context, CH_SILENT, e).setOngoing(false).build())
  }

  /** The ring service couldn't start: alert with a sounding notification. */
  fun fallback(context: Context, e: AlarmEntry) {
    val ch = if (e.alert.sound) CH_FALLBACK else CH_FALLBACK_VIBRATE
    notify(context, e, base(context, ch, e).setPriority(NotificationCompat.PRIORITY_HIGH).build())
  }

  private fun notify(context: Context, e: AlarmEntry, n: Notification) {
    try {
      NotificationManagerCompat.from(context).notify(notificationId(e.key), n)
    } catch (_: SecurityException) {
      // Notifications not allowed: nothing to show.
    }
  }
}
