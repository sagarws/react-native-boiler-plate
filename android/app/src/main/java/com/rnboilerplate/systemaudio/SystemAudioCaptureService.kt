package com.rnboilerplate.systemaudio

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.rnboilerplate.R

/**
 * Holds the screen-capture projection and runs [PlaybackRenderer] while
 * "Other apps → 8D" capture is on: a `mediaProjection` foreground service
 * (plus `microphone`, which Android 11+ needs for an AudioRecord in the
 * background; nothing is recorded from the microphone) with an ongoing
 * notification and Stop.
 *
 * Order (Android 14+): consent → startForeground(mediaProjection) →
 * getMediaProjection → registerCallback → capture. Ends on stopCapture(),
 * the notification's Stop, the projection's onStop (system "stop sharing")
 * or onDestroy — each releases record, track, engine and projection.
 */
class SystemAudioCaptureService : Service() {
  private val main = Handler(Looper.getMainLooper())
  private var projection: MediaProjection? = null
  private var renderer: PlaybackRenderer? = null
  private var receiverHeld = false

  private val projectionCallback =
    object : MediaProjection.Callback() {
      override fun onStop() {
        main.post { shutdown() }
      }
    }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> shutdown()
      // A restart without consent data would be a notification with nothing behind it.
      else -> if (renderer == null) stopSelf()
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    shutdown()
    takeStartCallback()?.invoke("failed")
    super.onDestroy()
  }

  private fun start(intent: Intent) {
    if (renderer != null) {
      takeStartCallback()?.invoke(null) // Already capturing.
      return
    }
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
    val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || data == null) return startFailed("failed")
    // Foreground with the mediaProjection type before obtaining the projection.
    if (!enterForeground()) return startFailed("failed")
    val p =
      try {
        getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)
      } catch (e: RuntimeException) {
        Log.w(TAG, "projection: ${e.javaClass.simpleName}")
        null
      } ?: return startFailed("failed")
    p.registerCallback(projectionCallback, main)
    projection = p
    CaptureStatus.error = null
    CaptureStatus.resetLevels()
    CaptureStatus.running = true
    renderer = PlaybackRenderer(applicationContext, p) { code -> main.post { onFatal(code) } }.also { it.start() }
    // Keeps hearing session announcements while capture holds the process.
    SessionEffectReceiver.registerRuntime(this)
    receiverHeld = true
    takeStartCallback()?.invoke(null)
    SystemAudioEvents.changed()
  }

  private fun startFailed(code: String) {
    CaptureStatus.error = code
    takeStartCallback()?.invoke(code)
    shutdown()
  }

  private fun onFatal(code: String) {
    CaptureStatus.error = code
    shutdown()
  }

  /** Idempotent: releases everything and leaves the foreground. */
  private fun shutdown() {
    renderer?.stop()
    renderer = null
    // Media volume back before anything else can fail.
    HearOnly8D.stop(this)
    projection?.let {
      runCatching { it.unregisterCallback(projectionCallback) }
      runCatching { it.stop() }
    }
    projection = null
    if (receiverHeld) SessionEffectReceiver.unregisterRuntime(this)
    receiverHeld = false
    val wasRunning = CaptureStatus.running
    CaptureStatus.running = false
    CaptureStatus.resetLevels()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
    if (wasRunning || CaptureStatus.error != null) SystemAudioEvents.changed()
  }

  private fun enterForeground(): Boolean {
    var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    ) {
      types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    }
    return try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), types)
      true
    } catch (e: RuntimeException) {
      Log.w(TAG, "Could not enter the foreground: ${e.javaClass.simpleName}")
      false
    }
  }

  private fun notification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, getString(R.string.system_audio_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
          setShowBadge(false)
          setSound(null, null)
          enableVibration(false)
        },
      )
    }
    val stop =
      PendingIntent.getService(
        this,
        1,
        Intent(this, SystemAudioCaptureService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val open =
      packageManager.getLaunchIntentForPackage(packageName)?.let {
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_volume_2)
      .setContentTitle(getString(R.string.system_audio_notif_title))
      .setContentText(getString(R.string.system_audio_notif_text))
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setContentIntent(open)
      .addAction(0, getString(R.string.system_audio_action_stop), stop)
      .build()
  }

  companion object {
    private const val TAG = "SystemAudioCapture"
    private const val ACTION_START = "com.rnboilerplate.systemaudio.START"
    private const val ACTION_STOP = "com.rnboilerplate.systemaudio.STOP"
    private const val EXTRA_RESULT_CODE = "result_code"
    private const val EXTRA_RESULT_DATA = "result_data"
    private const val CHANNEL_ID = "system_audio"
    private const val NOTIFICATION_ID = 4801

    /** Told once: null = capture started, else the promise's error code. */
    private var startCallback: ((String?) -> Unit)? = null

    @Synchronized private fun takeStartCallback(): ((String?) -> Unit)? = startCallback.also { startCallback = null }

    /** Asks for consent, then starts; [onResult] runs on the main thread. */
    fun requestStart(context: Context, onResult: (String?) -> Unit) {
      synchronized(this) {
        startCallback?.invoke("superseded")
        startCallback = onResult
      }
      SystemAudioConsentActivity.start(context)
    }

    /** From the consent activity, while it is still visible. */
    fun deliverConsent(context: Context, resultCode: Int, data: Intent?) {
      if (resultCode != Activity.RESULT_OK || data == null) {
        takeStartCallback()?.invoke("denied")
        return
      }
      val intent =
        Intent(context, SystemAudioCaptureService::class.java)
          .setAction(ACTION_START)
          .putExtra(EXTRA_RESULT_CODE, resultCode)
          .putExtra(EXTRA_RESULT_DATA, data)
      try {
        ContextCompat.startForegroundService(context, intent)
      } catch (e: RuntimeException) {
        Log.w(TAG, "start: ${e.javaClass.simpleName}")
        takeStartCallback()?.invoke("failed")
      }
    }

    fun stop(context: Context) {
      if (!CaptureStatus.running) return
      context.startService(Intent(context, SystemAudioCaptureService::class.java).setAction(ACTION_STOP))
    }
  }
}
