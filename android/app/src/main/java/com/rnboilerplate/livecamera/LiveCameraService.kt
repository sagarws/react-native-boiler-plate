package com.rnboilerplate.livecamera

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rnboilerplate.R

/**
 * Keeps the app alive while the live camera is shared from the background.
 * The camera and the stream live in react-native-webrtc (JS); this service
 * only holds the foreground state (camera, plus microphone with audio), a
 * partial wake lock and a low-latency Wi-Fi lock, and shows the ongoing
 * notification with Stop.
 *
 * START_NOT_STICKY: a service restarted without the JS stream would be a
 * notification with nothing behind it.
 */
class LiveCameraService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null
  private var title = ""
  private var text = ""

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> {
        title = intent.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: getString(R.string.live_camera_title)
        val withAudio = intent.getBooleanExtra(EXTRA_AUDIO, false)
        val error = runCatching { startInForeground(withAudio) }.exceptionOrNull()
        takeStartCallback()?.invoke(error)
        if (error != null) {
          stopSelf()
          return START_NOT_STICKY
        }
        running = true
        acquireLocks()
      }
      ACTION_UPDATE -> {
        if (!running) return START_NOT_STICKY
        text = intent.getStringExtra(EXTRA_TEXT).orEmpty()
        notify(notification())
      }
      ACTION_STOP -> stopFromNotification()
      // A null intent would be a restart, which START_NOT_STICKY rules out.
      else -> if (!running) stopSelf()
    }
    return START_NOT_STICKY
  }

  // Android 15+: Android's time limit for this service type ran out.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopFromNotification()
  }

  override fun onDestroy() {
    running = false
    releaseLocks()
    takeStartCallback()?.invoke(IllegalStateException("stopped before start"))
    super.onDestroy()
  }

  /** Stop tapped (or time limit): tell JS to end the stream, then stop. JS's own stopService is then a no-op. */
  private fun stopFromNotification() {
    if (running) LiveCameraEvents.emit("stop")
    running = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun startInForeground(withAudio: Boolean) {
    ensureChannel()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      var type = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
      if (withAudio) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
      startForeground(NOTIFICATION_ID, notification(), type)
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // Camera/microphone types arrived in 11; 10 only checks the manifest's types.
      startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST)
    } else {
      startForeground(NOTIFICATION_ID, notification())
    }
  }

  private fun acquireLocks() {
    if (wakeLock == null) {
      wakeLock =
        (getSystemService(Context.POWER_SERVICE) as PowerManager)
          .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_TAG)
          .apply {
            setReferenceCounted(false)
            acquire(WAKE_TIMEOUT_MS) // safety net if onDestroy never runs
          }
    }
    if (wifiLock == null) {
      val mode =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
          @Suppress("DEPRECATION")
          WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
      wifiLock =
        (applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager)
          ?.createWifiLock(mode, WAKE_TAG)
          ?.apply {
            setReferenceCounted(false)
            acquire()
          }
    }
  }

  private fun releaseLocks() {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    wifiLock?.let { if (it.isHeld) it.release() }
    wifiLock = null
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    getSystemService(NotificationManager::class.java)?.createNotificationChannel(
      NotificationChannel(CHANNEL_ID, getString(R.string.live_camera_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
        setSound(null, null)
        enableVibration(false)
      },
    )
  }

  private fun notification(): Notification {
    val stop =
      PendingIntent.getService(
        this,
        1,
        Intent(this, LiveCameraService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_rec_camera)
      .setContentTitle(title)
      .apply { if (text.isNotEmpty()) setContentText(text) }
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(launchIntent())
      .addAction(0, getString(R.string.live_camera_action_stop), stop)
      .build()
  }

  private fun launchIntent(): PendingIntent? =
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  @Suppress("MissingPermission") // Guarded by areNotificationsEnabled (POST_NOTIFICATIONS on 13+).
  private fun notify(notification: Notification) {
    val manager = NotificationManagerCompat.from(this)
    if (manager.areNotificationsEnabled()) manager.notify(NOTIFICATION_ID, notification)
  }

  companion object {
    private const val ACTION_START = "com.rnboilerplate.livecamera.START"
    private const val ACTION_UPDATE = "com.rnboilerplate.livecamera.UPDATE"
    private const val ACTION_STOP = "com.rnboilerplate.livecamera.STOP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_AUDIO = "withAudio"
    private const val EXTRA_TEXT = "text"
    private const val CHANNEL_ID = "live_camera"
    private const val NOTIFICATION_ID = 4301
    private const val WAKE_TAG = "rnboilerplate:livecamera"
    private const val WAKE_TIMEOUT_MS = 12 * 60 * 60 * 1000L

    @Volatile var running = false
      private set

    /** Told once whether startForeground succeeded (null) or failed, for the module's promise. */
    private var startCallback: ((Throwable?) -> Unit)? = null

    @Synchronized private fun takeStartCallback(): ((Throwable?) -> Unit)? = startCallback.also { startCallback = null }

    /** Starts (or retitles) the service; [onStarted] runs on the main thread once startForeground has run. */
    fun start(context: Context, title: String, withAudio: Boolean, onStarted: (Throwable?) -> Unit) {
      synchronized(this) {
        startCallback?.invoke(IllegalStateException("superseded"))
        startCallback = onStarted
      }
      val intent =
        Intent(context, LiveCameraService::class.java)
          .setAction(ACTION_START)
          .putExtra(EXTRA_TITLE, title)
          .putExtra(EXTRA_AUDIO, withAudio)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: Exception) {
        // Android 12+ refuses from the background (ForegroundServiceStartNotAllowedException).
        takeStartCallback()?.invoke(e)
      }
    }

    fun update(context: Context, text: String) {
      if (!running) return
      context.startService(Intent(context, LiveCameraService::class.java).setAction(ACTION_UPDATE).putExtra(EXTRA_TEXT, text))
    }

    fun stop(context: Context) {
      running = false
      context.stopService(Intent(context, LiveCameraService::class.java))
    }
  }
}
