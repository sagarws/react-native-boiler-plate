package com.rnboilerplate.screenocr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.Display
import android.view.WindowManager
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.rnboilerplate.MainActivity
import com.rnboilerplate.R
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import org.json.JSONObject

/**
 * Hosts the floating button and the screen-capture session.
 *
 * Runs as a `mediaProjection` foreground service, which Android requires for
 * as long as a projection is held; the notification it shows is that
 * requirement, and its Stop action ends everything. Started only after the
 * user grants capture consent, never restarted by the system
 * (START_NOT_STICKY) because a projection cannot outlive its consent. When
 * the projection ends for any reason, the service shuts itself down.
 *
 * Idle cost is one window and an unattached virtual display: no polling,
 * no frames rendered until the button is tapped.
 */
class OverlayCaptureService : Service(), FloatingBubble.Listener {
  private val main = Handler(Looper.getMainLooper())
  private val busy = AtomicBoolean(false)
  private lateinit var prefs: OcrPrefs
  private var capturer: ScreenCapturer? = null
  private var bubble: FloatingBubble? = null
  private var engine: OcrEngine? = null
  private var activeToast: Toast? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = OcrPrefs(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> shutdown()
      ACTION_CONFIG_CHANGED -> bubble?.applyConfig(prefs.readConfig())
      ACTION_RESET_POSITION -> bubble?.resetPosition()
      else -> if (capturer == null) shutdown()
    }
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0)
    val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
    if (data == null) {
      shutdown()
      return
    }
    // The foreground service must be running with the mediaProjection type
    // *before* the projection is obtained (enforced from Android 14).
    try {
      ServiceCompat.startForeground(
        this,
        NOTIFICATION_ID,
        buildNotification(),
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
        } else {
          0
        },
      )
    } catch (e: RuntimeException) {
      Log.w(TAG, "Could not enter the foreground: ${e.javaClass.simpleName}")
      shutdown()
      return
    }

    val projection =
      try {
        getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)
      } catch (e: RuntimeException) {
        null
      }
    if (projection == null) {
      toast(R.string.screen_ocr_capture_unavailable)
      shutdown()
      return
    }

    capturer?.release()
    capturer =
      try {
        ScreenCapturer(this, projection) { onProjectionStopped() }
      } catch (e: RuntimeException) {
        Log.w(TAG, "Capture setup failed: ${e.javaClass.simpleName}")
        projection.stop()
        null
      }
    if (capturer == null) {
      toast(R.string.screen_ocr_capture_unavailable)
      shutdown()
      return
    }

    if (bubble == null) {
      if (!Settings.canDrawOverlays(this)) {
        toast(R.string.screen_ocr_overlay_revoked)
        shutdown()
        return
      }
      val created = FloatingBubble(overlayContext(), prefs, this)
      try {
        created.show(prefs.readConfig())
        bubble = created
      } catch (e: RuntimeException) {
        Log.w(TAG, "Overlay window rejected: ${e.javaClass.simpleName}")
        toast(R.string.screen_ocr_overlay_revoked)
        shutdown()
        return
      }
    }
    isRunning = true
    ScreenOcrBus.notifyStatus()
  }

  override fun onBubbleTap() {
    val activeCapturer = capturer ?: return
    val activeBubble = bubble ?: return
    // One capture at a time; repeated taps while busy are ignored.
    if (!busy.compareAndSet(false, true)) return
    // A toast from the previous capture would otherwise be read as screen text.
    activeToast?.cancel()
    activeToast = null

    activeBubble.setProcessing(true)
    activeBubble.setHiddenForCapture(true)
    // Give the compositor a couple of frames to drop the bubble from the screen.
    main.postDelayed(
      {
        activeCapturer.capture(CAPTURE_TIMEOUT_MS) { bitmap ->
          bubble?.setHiddenForCapture(false)
          if (bitmap == null) {
            finishCapture(R.string.screen_ocr_capture_failed)
            return@capture
          }
          val config = prefs.readConfig()
          val startedAt = SystemClock.elapsedRealtime()
          val ocr = engine ?: OcrEngine().also { engine = it }
          ocr.recognize(bitmap, config.mode) { result ->
            bitmap.recycle()
            val message = handleResult(result, config, SystemClock.elapsedRealtime() - startedAt)
            finishCapture(message)
          }
        }
      },
      HIDE_BEFORE_CAPTURE_MS,
    )
  }

  private fun finishCapture(messageRes: Int) {
    bubble?.setProcessing(false)
    busy.set(false)
    toast(messageRes)
  }

  /** Stores and copies a finished recognition; returns the message to show. */
  private fun handleResult(result: Result<String>, config: OcrConfig, durationMs: Long): Int {
    val text =
      result.getOrElse {
        // Never log recognised content — only the failure type.
        Log.w(TAG, "OCR failed: ${it.javaClass.simpleName}")
        return R.string.screen_ocr_failed
      }
    if (text.isBlank()) return R.string.screen_ocr_no_text

    val entry =
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("text", text)
        .put("mode", config.mode.id)
        .put("createdAt", System.currentTimeMillis())
        .put("durationMs", durationMs)
        .put("lineCount", text.lines().size)
    ScreenOcrBus.latest = entry
    if (config.saveHistory) prefs.appendPending(entry)
    ScreenOcrBus.notifyResult()

    if (!config.autoCopy) return R.string.screen_ocr_captured
    return if (ClipboardHelper.copy(this, text, sensitive = true)) {
      R.string.screen_ocr_copied
    } else {
      R.string.screen_ocr_clipboard_failed
    }
  }

  /** Long press: open the app on the latest capture to review, edit or share it. */
  override fun onBubbleLongPress() {
    val open =
      Intent(Intent.ACTION_VIEW, Uri.parse(LATEST_DEEP_LINK))
        .setPackage(packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    try {
      startActivity(open)
    } catch (e: RuntimeException) {
      Log.w(TAG, "Could not open the app: ${e.javaClass.simpleName}")
    }
  }

  private fun onProjectionStopped() {
    if (capturer == null) return
    toast(R.string.screen_ocr_capture_stopped)
    shutdown()
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    bubble?.onScreenChanged()
  }

  private fun shutdown() {
    releaseResources()
    ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun releaseResources() {
    main.removeCallbacksAndMessages(null)
    bubble?.remove()
    bubble = null
    capturer?.release()
    capturer = null
    engine?.close()
    engine = null
    busy.set(false)
    activeToast = null
    if (isRunning) {
      isRunning = false
      ScreenOcrBus.notifyStatus()
    }
  }

  override fun onDestroy() {
    releaseResources()
    super.onDestroy()
  }

  private fun toast(messageRes: Int) {
    activeToast?.cancel()
    activeToast =
      Toast.makeText(applicationContext, messageRes, Toast.LENGTH_SHORT).also { it.show() }
  }

  /**
   * A window context for the overlay (Android 11+): the supported way for a
   * service to add windows, and its resources follow rotation and display
   * changes. Older versions use the service itself.
   */
  private fun overlayContext(): Context {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return this
    val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    return createDisplayContext(display)
      .createWindowContext(WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, null)
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(
            CHANNEL_ID,
            getString(R.string.screen_ocr_channel_name),
            NotificationManager.IMPORTANCE_LOW,
          )
          .apply {
            description = getString(R.string.screen_ocr_channel_description)
            setShowBadge(false)
          },
      )
    }
    val openApp =
      PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    val stop =
      PendingIntent.getService(
        this,
        1,
        Intent(this, OverlayCaptureService::class.java).setAction(ACTION_STOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    // Deliberately generic: extracted text never appears in a notification.
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(R.drawable.ic_scan_text)
      .setContentTitle(getString(R.string.screen_ocr_notification_title))
      .setContentText(getString(R.string.screen_ocr_notification_text))
      .setContentIntent(openApp)
      .addAction(0, getString(R.string.screen_ocr_notification_stop), stop)
      .setOngoing(true)
      .setSilent(true)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .build()
  }

  companion object {
    private const val TAG = "ScreenOcr"
    private const val ACTION_START = "com.rnboilerplate.screenocr.START"
    private const val ACTION_STOP = "com.rnboilerplate.screenocr.STOP"
    private const val ACTION_CONFIG_CHANGED = "com.rnboilerplate.screenocr.CONFIG_CHANGED"
    private const val ACTION_RESET_POSITION = "com.rnboilerplate.screenocr.RESET_POSITION"
    private const val EXTRA_RESULT_CODE = "resultCode"
    private const val EXTRA_RESULT_DATA = "resultData"
    private const val CHANNEL_ID = "screen_capture"
    private const val NOTIFICATION_ID = 4210
    private const val HIDE_BEFORE_CAPTURE_MS = 120L
    private const val CAPTURE_TIMEOUT_MS = 1500L
    const val LATEST_DEEP_LINK = "rnboilerplate://capture/latest"

    @Volatile
    var isRunning = false
      private set

    fun start(context: Context, resultCode: Int, data: Intent) {
      val intent =
        Intent(context, OverlayCaptureService::class.java)
          .setAction(ACTION_START)
          .putExtra(EXTRA_RESULT_CODE, resultCode)
          .putExtra(EXTRA_RESULT_DATA, data)
      ContextCompat.startForegroundService(context, intent)
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, OverlayCaptureService::class.java))
    }

    fun notifyConfigChanged(context: Context) = sendIfRunning(context, ACTION_CONFIG_CHANGED)

    fun resetPosition(context: Context) = sendIfRunning(context, ACTION_RESET_POSITION)

    private fun sendIfRunning(context: Context, action: String) {
      if (!isRunning) return
      context.startService(Intent(context, OverlayCaptureService::class.java).setAction(action))
    }
  }
}
