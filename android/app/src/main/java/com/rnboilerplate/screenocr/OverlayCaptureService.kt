package com.rnboilerplate.screenocr

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.hardware.display.DisplayManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
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
import org.json.JSONObject

/**
 * Hosts the floating button, the screen-capture session and read-aloud.
 *
 * Runs as a `mediaProjection` foreground service, which Android requires for
 * as long as a projection is held; the notification it shows is that
 * requirement, and its Stop action ends everything. Started only after the
 * user grants capture consent, never restarted by the system
 * (START_NOT_STICKY) because a projection cannot outlive its consent.
 *
 * A tap runs the configured [FloatingAction]:
 * - COPY — capture → OCR → clipboard;
 * - SPEAK — capture → OCR → speak, with the controller panel;
 * - SPEAK_SCROLL — a [ReadingSession] that speaks, scrolls (accessibility
 *   service, if the user enabled it) or waits for a manual scroll, and
 *   continues with the new text only.
 *
 * One operation at a time: while a capture or a reading session is running,
 * further taps control it instead of starting another. Idle cost is one
 * window and an unattached virtual display: no polling, no frames rendered.
 */
class OverlayCaptureService :
  Service(), FloatingBubble.Listener, ReadingPanel.Listener, ReadingPorts {
  private val main = Handler(Looper.getMainLooper())
  private lateinit var prefs: OcrPrefs
  private var capturer: ScreenCapturer? = null
  private var bubble: FloatingBubble? = null
  private var panel: ReadingPanel? = null
  private var engine: OcrEngine? = null
  private var speech: SpeechPlayer? = null
  private var session: ReadingSession? = null
  private var sessionConfig: OcrConfig? = null
  private var capturing = false
  private var activeToast: Toast? = null
  private var focusRequest: AudioFocusRequest? = null
  private var pausedByFocusLoss = false
  private var lastText: String? = null

  private val screenOffReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (sessionConfig?.speech?.stopOnScreenOff == true) session?.stop()
      }
    }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = OcrPrefs(this)
    ContextCompat.registerReceiver(
      this,
      screenOffReceiver,
      IntentFilter(Intent.ACTION_SCREEN_OFF),
      ContextCompat.RECEIVER_NOT_EXPORTED,
    )
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> shutdown()
      ACTION_CONFIG_CHANGED -> {
        val config = prefs.readConfig()
        bubble?.applyConfig(config)
        // A running session keeps its own settings; only colours follow along.
        val current = sessionConfig
        panel?.applyConfig(
          current?.copy(
            bubbleColor = config.bubbleColor,
            bubbleIconColor = config.bubbleIconColor,
            panelColor = config.panelColor,
            panelTextColor = config.panelTextColor,
          ) ?: config,
        )
      }
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
        ScreenCapturer(overlayContext(), projection) { onProjectionStopped() }
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

  // ── Bubble ────────────────────────────────────────────────────────────

  override fun onBubbleTap() {
    if (capturer == null || bubble == null) return
    // A running session owns the button: a tap pauses/resumes it (or
    // continues after a manual scroll).
    session?.let { current ->
      if (current.state.isActive) {
        if (current.state == ReadingState.WAITING_FOR_SCROLL) current.next() else current.togglePause()
        return
      }
    }
    // One capture at a time; repeated taps while busy are ignored.
    if (capturing) return
    val config = prefs.readConfig()
    when (config.action) {
      FloatingAction.COPY -> copyOnce(config)
      FloatingAction.SPEAK, FloatingAction.SPEAK_SCROLL -> startReading(config)
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

  // ── Capture + OCR (shared by every action) ────────────────────────────

  private class CaptureFailed : RuntimeException("capture")

  /**
   * Hides the overlay, grabs one frame, shows the overlay again and runs OCR
   * with the configured languages. Never runs twice at once.
   */
  private fun captureAndRecognize(
    config: OcrConfig,
    onOcr: () -> Unit,
    onResult: (Result<String>, Long) -> Unit,
  ) {
    val activeCapturer = capturer
    if (activeCapturer == null || capturing) {
      onResult(Result.failure(CaptureFailed()), 0)
      return
    }
    capturing = true
    // A toast from the previous step would otherwise be read as screen text.
    activeToast?.cancel()
    activeToast = null
    bubble?.setProcessing(true)
    bubble?.setHiddenForCapture(true)
    panel?.setHiddenForCapture(true)
    // Give the compositor a couple of frames to drop the overlay from the screen.
    main.postDelayed(
      {
        activeCapturer.capture(CAPTURE_TIMEOUT_MS) { bitmap ->
          bubble?.setHiddenForCapture(false)
          panel?.setHiddenForCapture(false)
          if (bitmap == null) {
            capturing = false
            bubble?.setProcessing(false)
            onResult(Result.failure(CaptureFailed()), 0)
            return@capture
          }
          onOcr()
          val startedAt = SystemClock.elapsedRealtime()
          val ocr = engine ?: OcrEngine(this).also { engine = it }
          ocr.recognize(bitmap, config.mode) { result ->
            bitmap.recycle()
            capturing = false
            bubble?.setProcessing(false)
            // Never log recognised content — only the failure type.
            result.exceptionOrNull()?.let { Log.w(TAG, "OCR failed: ${it.javaClass.simpleName}") }
            onResult(result, SystemClock.elapsedRealtime() - startedAt)
          }
        }
      },
      HIDE_BEFORE_CAPTURE_MS,
    )
  }

  private fun copyOnce(config: OcrConfig) {
    captureAndRecognize(config, onOcr = {}) { result, duration ->
      val text = result.getOrNull()
      val message =
        when {
          result.exceptionOrNull() is CaptureFailed -> R.string.screen_ocr_capture_failed
          text == null -> R.string.screen_ocr_failed
          text.isBlank() -> R.string.screen_ocr_no_text
          else -> {
            store(text, config, duration)
            when {
              !config.autoCopy -> R.string.screen_ocr_captured
              ClipboardHelper.copy(this, text, sensitive = true) -> R.string.screen_ocr_copied
              else -> R.string.screen_ocr_clipboard_failed
            }
          }
        }
      toast(message)
    }
  }

  /** Keeps a finished extraction: in memory always, queued for history if enabled. */
  private fun store(text: String, config: OcrConfig, durationMs: Long) {
    val entry =
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("text", text)
        .put("mode", config.mode.id)
        .put("createdAt", System.currentTimeMillis())
        .put("durationMs", durationMs)
        .put("lineCount", text.lines().size)
    lastText = text
    ScreenOcrBus.latest = entry
    if (config.saveHistory) prefs.appendPending(entry)
    ScreenOcrBus.notifyResult()
  }

  // ── Read aloud ─────────────────────────────────────────────────────────

  private fun startReading(config: OcrConfig) {
    sessionConfig = config
    val wantedEngine =
      if (config.speech.preferGoogle && SpeechPlayer.isGoogleInstalled(this)) SpeechPlayer.GOOGLE_TTS else ""
    if (speech?.enginePackage != wantedEngine) {
      speech?.shutdown()
      speech = SpeechPlayer(this, config.speech.preferGoogle)
    }
    val readingPanel = panel ?: ReadingPanel(overlayContext(), this).also { panel = it }
    try {
      readingPanel.show(config)
    } catch (e: RuntimeException) {
      Log.w(TAG, "Panel window rejected: ${e.javaClass.simpleName}")
    }
    bubble?.setReading(true)
    val autoScroll = config.action == FloatingAction.SPEAK_SCROLL
    session = ReadingSession(autoScroll, config.reading, this).also { it.start() }
  }

  override fun captureText(onOcr: () -> Unit, onResult: (Result<String>) -> Unit) {
    val config = sessionConfig ?: return onResult(Result.failure(CaptureFailed()))
    captureAndRecognize(config, onOcr) { result, duration ->
      result.getOrNull()?.takeIf { it.isNotBlank() }?.let { text ->
        store(text, config, duration)
        if (config.speech.copyBeforeSpeaking) ClipboardHelper.copy(this, text, sensitive = true)
      }
      onResult(result)
    }
  }

  override fun speak(
    text: String,
    fromSegment: Int,
    onProgress: (Int, Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
  ) {
    val config = sessionConfig ?: return onError(ReadingReason.SPEECH_FAILED)
    val player = speech ?: return onError(ReadingReason.SPEECH_FAILED)
    player.whenReady { ok ->
      if (!ok) {
        onError(ReadingReason.SPEECH_FAILED)
        return@whenReady
      }
      val s = config.speech
      val available = OcrConfig.SPEECH_LANGUAGES.filter { player.isLanguageUsable(it) }.toSet()
      val segments = SpeechSegmenter.segment(text, s.language, s.switchByScript, available)
      requestAudioFocus()
      player.speak(segments, fromSegment, s.voiceName, s.rate, s.pitch, onProgress, onDone, onError)
    }
  }

  override fun stopSpeech() {
    speech?.stop()
  }

  override fun canScroll(): Boolean = ScrollAccessibilityService.running() != null

  override fun scroll(onResult: (Boolean) -> Unit) {
    val service = ScrollAccessibilityService.running() ?: return onResult(false)
    service.scrollForward { scrolled -> main.post { onResult(scrolled) } }
  }

  override fun schedule(delayMs: Long, block: () -> Unit) {
    main.postDelayed(block, delayMs)
  }

  override fun onStateChanged(state: ReadingState, info: ReadingInfo) {
    val autoScroll = sessionConfig?.action == FloatingAction.SPEAK_SCROLL
    panel?.update(state, info, autoScroll)
    if (state.isActive) return
    // Finished: release audio focus, say why, tidy the overlay a moment later.
    abandonAudioFocus()
    bubble?.setReading(false)
    when (info.reason) {
      ReadingReason.NO_TEXT -> toast(R.string.screen_ocr_no_text)
      ReadingReason.CAPTURE_FAILED -> toast(R.string.screen_ocr_capture_failed)
      ReadingReason.OCR_FAILED -> toast(R.string.screen_ocr_failed)
      ReadingReason.SPEECH_FAILED -> toast(R.string.reading_error_speech)
      ReadingReason.VOICE_MISSING -> toast(R.string.reading_error_voice)
      ReadingReason.END_OF_PAGE -> toast(R.string.reading_end_of_page)
      ReadingReason.SECTION_LIMIT -> toast(R.string.reading_limit_reached)
      ReadingReason.NONE -> Unit
    }
    val ended = session
    main.postDelayed(
      { if (session === ended && session?.state?.isActive != true) panel?.remove() },
      PANEL_LINGER_MS,
    )
  }

  // ── Panel ──────────────────────────────────────────────────────────────

  override fun onPanelPlayPause() {
    pausedByFocusLoss = false
    session?.togglePause()
  }

  override fun onPanelRestart() {
    session?.restartSection()
  }

  override fun onPanelNext() {
    session?.next()
  }

  override fun onPanelCopy() {
    val text = session?.currentText?.takeIf { it.isNotBlank() } ?: lastText
    if (text.isNullOrBlank()) return
    toast(
      if (ClipboardHelper.copy(this, text, sensitive = true)) R.string.screen_ocr_copied
      else R.string.screen_ocr_clipboard_failed,
    )
  }

  override fun onPanelStop() {
    session?.stop()
    panel?.remove()
  }

  // ── Audio focus: pause for calls/other audio, resume after if allowed ──

  private val focusListener =
    AudioManager.OnAudioFocusChangeListener { change ->
      val current = session ?: return@OnAudioFocusChangeListener
      when (change) {
        AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
          if (current.state == ReadingState.SPEAKING) {
            current.pause()
            pausedByFocusLoss = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
          }
        }
        AudioManager.AUDIOFOCUS_GAIN -> {
          if (pausedByFocusLoss && sessionConfig?.speech?.resumeAfterInterruption == true) {
            current.resume()
          }
          pausedByFocusLoss = false
        }
      }
    }

  private fun requestAudioFocus() {
    if (focusRequest != null || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val request =
      AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build(),
        )
        .setOnAudioFocusChangeListener(focusListener, main)
        .build()
    getSystemService(AudioManager::class.java).requestAudioFocus(request)
    focusRequest = request
  }

  private fun abandonAudioFocus() {
    val request = focusRequest ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      getSystemService(AudioManager::class.java).abandonAudioFocusRequest(request)
    }
    focusRequest = null
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

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
    session?.stop()
    session = null
    abandonAudioFocus()
    speech?.shutdown()
    speech = null
    panel?.remove()
    panel = null
    bubble?.remove()
    bubble = null
    capturer?.release()
    capturer = null
    engine?.close()
    engine = null
    capturing = false
    activeToast = null
    if (isRunning) {
      isRunning = false
      ScreenOcrBus.notifyStatus()
    }
  }

  override fun onDestroy() {
    releaseResources()
    try {
      unregisterReceiver(screenOffReceiver)
    } catch (_: IllegalArgumentException) {
      // Not registered.
    }
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
    private const val PANEL_LINGER_MS = 2500L
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
