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
 *   continues with the new text only;
 * - SPEAK_PAGINATION — a [PaginationSession] that speaks the page, presses
 *   the user-pinned Next button once (accessibility service), verifies the
 *   page turned and continues. The pin is set with [TargetPicker];
 *
 * "Refine text" and "Apply translation" (opt-in, user's own Gemini key) are a
 * [TextPipeline] over every action: OCR text → refine → translate → then Copy
 * copies, and the read-aloud modes speak, the final text. Only extracted text
 * is sent — never the screenshot.
 *
 * One operation at a time: while a capture or a reading session is running,
 * further taps control it instead of starting another. Idle cost is one
 * window and an unattached virtual display: no polling, no frames rendered.
 */
class OverlayCaptureService :
  Service(), FloatingBubble.Listener, ReadingPanel.Listener, ReadingPorts, TargetPicker.Listener {
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
  /** The last capture failed because the one shared app was hidden (already explained). */
  private var lastCaptureHidden = false
  private var picker: TargetPicker? = null
  private var pagination: PaginationSession? = null
  private var gemini: GeminiClient? = null
  /** Last original → processed text, so pause/resume/restart don't re-send it. */
  private var processedCache: Pair<String, ProcessedText>? = null
  private var lastTranslateError: TranslateError = TranslateError.SERVER
  private var lastCaptureDuration = 0L
  private val keyStore by lazy { SecureKeyStore(this) }

  private val screenOffReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (sessionConfig?.speech?.stopOnScreenOff == true) {
          session?.stop()
          pagination?.stop()
        }
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
      ACTION_CALIBRATE -> startCalibration()
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
    if (picker?.isShowing == true) return
    pagination?.let { current ->
      if (current.state.isActive) {
        current.togglePause()
        return
      }
    }

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
    // A Gemini step is on but no key is saved: nothing is captured or sent.
    if ((config.translate.enabled || config.refine.enabled) && !keyStore.hasKey) {
      toast(R.string.translate_error_no_key)
      return
    }
    processedCache = null
    when (config.action) {
      FloatingAction.COPY -> copyOnce(config)
      FloatingAction.SPEAK, FloatingAction.SPEAK_SCROLL -> startReading(config)
      FloatingAction.SPEAK_PAGINATION -> startPagination(config)
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

  /** One app was shared and it is not on screen; already explained by a toast. */
  private class SharedAppHidden : RuntimeException("shared app hidden")

  /**
   * Hides the overlay, grabs one frame, shows the overlay again and runs OCR
   * with the configured languages. Never runs twice at once.
   */
  private fun captureAndRecognize(
    config: OcrConfig,
    onOcr: () -> Unit,
    onResult: (Result<String>, Long) -> Unit,
  ) = captureAndRecognize(config, onOcr) { result, duration, _ -> onResult(result, duration) }

  /** 9×8 difference hash of a frame, for detecting page turns on image-only pages. */
  private fun fingerprint(bitmap: android.graphics.Bitmap): Long {
    val small = android.graphics.Bitmap.createScaledBitmap(bitmap, 9, 8, true)
    val pixels = IntArray(72)
    small.getPixels(pixels, 0, 9, 0, 0, 9, 8)
    if (small !== bitmap) small.recycle()
    val grey =
      IntArray(72) { i ->
        val c = pixels[i]
        (((c shr 16) and 0xFF) * 299 + ((c shr 8) and 0xFF) * 587 + (c and 0xFF) * 114) / 1000
      }
    return PageChangeDetector.dHash(grey)
  }

  private fun captureAndRecognize(
    config: OcrConfig,
    onOcr: () -> Unit,
    onResult: (Result<String>, Long, Long) -> Unit,
  ) {
    val activeCapturer = capturer
    if (activeCapturer == null || capturing) {
      onResult(Result.failure(CaptureFailed()), 0, 0)
      return
    }
    lastCaptureHidden = !activeCapturer.contentVisible
    if (!activeCapturer.contentVisible) {
      // One-app share and that app is behind another: Android sends blank frames.
      toast(R.string.screen_ocr_shared_app_hidden)
      onResult(Result.failure(SharedAppHidden()), 0, 0)
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
            onResult(Result.failure(CaptureFailed()), 0, 0)
            return@capture
          }
          val hash = fingerprint(bitmap)
          onOcr()
          val startedAt = SystemClock.elapsedRealtime()
          val ocr = engine ?: OcrEngine(this).also { engine = it }
          ocr.recognize(bitmap, config.mode) { result ->
            bitmap.recycle()
            capturing = false
            bubble?.setProcessing(false)
            // Never log recognised content — only the failure type.
            result.exceptionOrNull()?.let { Log.w(TAG, "OCR failed: ${it.javaClass.simpleName}") }
            onResult(result, SystemClock.elapsedRealtime() - startedAt, hash)
          }
        }
      },
      HIDE_BEFORE_CAPTURE_MS,
    )
  }

  private fun copyOnce(config: OcrConfig) {
    captureAndRecognize(config, onOcr = {}) { result: Result<String>, duration: Long ->
      val text = result.getOrNull()
      val message =
        when {
          result.exceptionOrNull() is SharedAppHidden -> return@captureAndRecognize
          result.exceptionOrNull() is CaptureFailed -> R.string.screen_ocr_capture_failed
          text == null -> R.string.screen_ocr_failed
          text.isBlank() -> R.string.screen_ocr_no_text
          config.translate.enabled || config.refine.enabled -> {
            processThenCopy(text, config, duration)
            return@captureAndRecognize
          }
          else -> {
            store(text, config, duration)
            copyResultMessage(text, config)
          }
        }
      toast(message)
    }
  }

  private fun copyResultMessage(text: String, config: OcrConfig): Int =
    when {
      !config.autoCopy -> R.string.screen_ocr_captured
      ClipboardHelper.copy(this, text, sensitive = true) -> R.string.screen_ocr_copied
      else -> R.string.screen_ocr_clipboard_failed
    }

  /** Copy mode with refinement/translation: the final text is what gets copied. */
  private fun processThenCopy(text: String, config: OcrConfig, duration: Long) {
    bubble?.setProcessing(true)
    process(text, config, onStage = { stage ->
      toast(if (stage == PipelineStage.REFINING) R.string.refine_status_refining else R.string.translate_status_translating)
    }) { result ->
      bubble?.setProcessing(false)
      result.fold(
        onSuccess = { processed ->
          store(processed, config, duration)
          toast(copyResultMessage(processed.finalText, config))
        },
        onFailure = { error ->
          // The original is still useful: keep it, but say why it wasn't processed.
          store(ProcessedText(text), config, duration)
          toast(translateErrorRes((error as? TranslateException)?.error ?: TranslateError.SERVER))
        },
      )
    }
  }

  /** Runs the enabled Gemini steps over OCR text. */
  private fun process(
    text: String,
    config: OcrConfig,
    onStage: (PipelineStage) -> Unit,
    onResult: (Result<ProcessedText>) -> Unit,
  ) {
    val key = keyStore.read() ?: return onResult(Result.failure(TranslateException(TranslateError.NO_KEY)))
    val client = gemini ?: GeminiClient().also { gemini = it }
    val pipeline =
      TextPipeline(
        object : PipelinePorts {
          override fun refine(text: String, onResult: (Result<TranslationResult>) -> Unit) =
            client.refine(key, config.translate, config.refine, text, onResult)

          override fun translate(text: String, onResult: (Result<TranslationResult>) -> Unit) {
            // Same language as the target: nothing to translate.
            if (config.translate.source != "auto" && config.translate.source == config.translate.target) {
              onResult(Result.success(TranslationResult(text, config.translate.source)))
            } else {
              client.translate(key, config.translate, text, onResult)
            }
          }
        },
      )
    pipeline.process(text, config.refine.enabled, config.translate.enabled, onStage, onResult)
  }

  /** Keeps a finished extraction: in memory always, queued for history if enabled. */
  private fun store(text: String, config: OcrConfig, durationMs: Long) =
    store(ProcessedText(text), config, durationMs)

  private fun store(processed: ProcessedText, config: OcrConfig, durationMs: Long) {
    val text = processed.original
    val translated = processed.translation
    val entry =
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("text", text)
        .put("mode", config.mode.id)
        .put("createdAt", System.currentTimeMillis())
        .put("durationMs", durationMs)
        .put("lineCount", text.lines().size)
    processed.refined?.let { entry.put("refined", it) }
    if (translated != null) {
      entry
        .put("translation", translated.text)
        .put("targetLanguage", config.translate.target)
        .put("sourceLanguage", translated.detectedLanguage)
    }
    lastText = processed.finalText
    ScreenOcrBus.latest = entry
    if (config.saveHistory) prefs.appendPending(entry)
    ScreenOcrBus.notifyResult()
  }

  // ── Read aloud ─────────────────────────────────────────────────────────

  /** Speech engine and controller panel for a read-aloud session. */
  private fun prepareReadAloud(config: OcrConfig) {
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
  }

  private fun startReading(config: OcrConfig) {
    prepareReadAloud(config)
    val autoScroll = config.action == FloatingAction.SPEAK_SCROLL
    session = ReadingSession(autoScroll, config.reading, this).also { it.start() }
  }

  override fun captureText(onOcr: () -> Unit, onResult: (Result<String>) -> Unit) {
    val config = sessionConfig ?: return onResult(Result.failure(CaptureFailed()))
    captureAndRecognize(config, onOcr) { result: Result<String>, duration: Long ->
      lastCaptureDuration = duration
      // With refinement/translation on, the entry is stored (and copied) once processed.
      if (!config.translate.enabled && !config.refine.enabled) {
        result.getOrNull()?.takeIf { it.isNotBlank() }?.let { text ->
          store(text, config, duration)
          if (config.speech.copyBeforeSpeaking) ClipboardHelper.copy(this, text, sensitive = true)
        }
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
    val tr = config.translate
    if (!tr.enabled && !config.refine.enabled) {
      speakNow(text, config.speech, fromSegment, onProgress, onDone, onError)
      return
    }
    // A translation is spoken in the target language; refined text in the usual one.
    val speechFor = { processed: ProcessedText ->
      if (processed.translation == null) {
        config.speech
      } else {
        config.speech.copy(
          language = tr.target,
          voiceName = if (config.speech.language == tr.target) config.speech.voiceName else "",
        )
      }
    }
    processedCache?.takeIf { it.first == text }?.let { (_, cached) ->
      speakNow(cached.finalText, speechFor(cached), fromSegment, onProgress, onDone, onError)
      return
    }
    process(text, config, onStage = { stage -> panel?.setStage(stage, tr.target) }) { result ->
      result.fold(
        onSuccess = { processed ->
          processedCache = text to processed
          store(processed, config, lastCaptureDuration)
          if (config.speech.copyBeforeSpeaking) ClipboardHelper.copy(this, processed.finalText, sensitive = true)
          speakNow(processed.finalText, speechFor(processed), fromSegment, onProgress, onDone, onError)
        },
        onFailure = { error ->
          lastTranslateError = (error as? TranslateException)?.error ?: TranslateError.SERVER
          onError(ReadingReason.TRANSLATE_FAILED)
        },
      )
    }
  }

  private fun speakNow(
    text: String,
    s: SpeechConfig,
    fromSegment: Int,
    onProgress: (Int, Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
  ) {
    val player = speech ?: return onError(ReadingReason.SPEECH_FAILED)
    player.whenReady { ok ->
      if (!ok) {
        onError(ReadingReason.SPEECH_FAILED)
        return@whenReady
      }
      val available = OcrConfig.SPEECH_LANGUAGES.filter { player.isLanguageUsable(it) }.toSet()
      val segments = SpeechSegmenter.segment(text, s.language, s.switchByScript, available)
      requestAudioFocus()
      player.speak(segments, fromSegment, s.voiceName, s.rate, s.pitch, onProgress, onDone, onError)
    }
  }

  override fun stopSpeech() {
    // Pause, skip and stop all end an in-flight translation too.
    gemini?.cancel()
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
    ScreenOcrBus.readingActive = state.isActive
    val autoScroll = sessionConfig?.action == FloatingAction.SPEAK_SCROLL
    panel?.update(state, info, autoScroll)
    if (state.isActive) return
    // Finished: release audio focus, say why, tidy the overlay a moment later.
    abandonAudioFocus()
    bubble?.setReading(false)
    when (info.reason) {
      ReadingReason.NO_TEXT -> toast(R.string.screen_ocr_no_text)
      ReadingReason.CAPTURE_FAILED, ReadingReason.OCR_FAILED ->
        if (!lastCaptureHidden) {
          toast(
            if (info.reason == ReadingReason.CAPTURE_FAILED) R.string.screen_ocr_capture_failed
            else R.string.screen_ocr_failed,
          )
        }
      ReadingReason.SPEECH_FAILED -> toast(R.string.reading_error_speech)
      ReadingReason.VOICE_MISSING -> toast(R.string.reading_error_voice)
      ReadingReason.TRANSLATE_FAILED -> toast(translateErrorRes(lastTranslateError))
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

  private val paginationActive: Boolean
    get() = pagination?.state?.isActive == true

  override fun onPanelPlayPause() {
    pausedByFocusLoss = false
    if (paginationActive) pagination?.togglePause() else session?.togglePause()
  }

  override fun onPanelRestart() {
    if (paginationActive) pagination?.restartPage() else session?.restartSection()
  }

  override fun onPanelNext() {
    if (paginationActive) pagination?.next() else session?.next()
  }

  override fun onPanelRecalibrate() {
    pagination?.stop()
    panel?.remove()
    startCalibration()
  }

  override fun onPanelCopy() {
    val text =
      processedCache?.second?.finalText
        ?: (if (paginationActive) pagination?.currentText else session?.currentText)?.takeIf { it.isNotBlank() }
        ?: lastText
    if (text.isNullOrBlank()) return
    toast(
      if (ClipboardHelper.copy(this, text, sensitive = true)) R.string.screen_ocr_copied
      else R.string.screen_ocr_clipboard_failed,
    )
  }

  override fun onPanelStop() {
    session?.stop()
    pagination?.stop()
    panel?.remove()
  }

  // ── Audio focus: pause for calls/other audio, resume after if allowed ──

  private val focusListener =
    AudioManager.OnAudioFocusChangeListener { change ->
      val paged = pagination?.takeIf { it.state.isActive }
      val reading = session?.takeIf { it.state.isActive }

      when (change) {
        AudioManager.AUDIOFOCUS_LOSS, AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
          val speaking =
            paged?.state == PaginationState.SPEAKING_PAGE || reading?.state == ReadingState.SPEAKING
          if (speaking) {
            paged?.pause()
            reading?.pause()
            pausedByFocusLoss = change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
          }
        }
        AudioManager.AUDIOFOCUS_GAIN -> {
          if (pausedByFocusLoss && sessionConfig?.speech?.resumeAfterInterruption == true) {
            paged?.resume()
            reading?.resume()
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

  // ── Speak with pagination ─────────────────────────────────────────────

  private fun startPagination(config: OcrConfig) {
    val target = prefs.readTarget()
    val problem = target?.let { TargetValidator.validate(it, ScreenGeometryReader.current(this)) }
    if (target == null || problem != TargetProblem.NONE) {
      // No usable pin: open the picker rather than click somewhere stale.
      toast(if (target == null) R.string.pagination_issue_no_target else R.string.pagination_issue_target_invalid)
      startCalibration()
      return
    }
    if (ScrollAccessibilityService.running() == null) {
      toast(R.string.pagination_issue_no_permission)
      return
    }
    prepareReadAloud(config)
    pagination = PaginationSession(config.pagination, paginationPorts).also { it.start() }
  }

  private val paginationPorts =
    object : PaginationPorts {
      override fun capture(onOcr: () -> Unit, onResult: (Result<PageSnapshot>) -> Unit) {
        val config = sessionConfig ?: return onResult(Result.failure(CaptureFailed()))
        captureAndRecognize(config, onOcr) { result: Result<String>, duration: Long, hash: Long ->
          val text = result.getOrNull()
          if (text == null) {
            onResult(Result.failure(result.exceptionOrNull() ?: CaptureFailed()))
          } else {
            lastCaptureDuration = duration
            if (text.isNotBlank() && !config.translate.enabled && !config.refine.enabled) store(text, config, duration)
            onResult(Result.success(PageSnapshot(text, hash)))
          }
        }
      }

      override fun speak(
        text: String,
        fromSegment: Int,
        onProgress: (Int, Int) -> Unit,
        onDone: () -> Unit,
        onError: (ReadingReason) -> Unit,
      ) {
        val config = sessionConfig
        if (config?.speech?.copyBeforeSpeaking == true && !config.translate.enabled && !config.refine.enabled) {
          ClipboardHelper.copy(this@OverlayCaptureService, text, true)
        }
        this@OverlayCaptureService.speak(text, fromSegment, onProgress, onDone, onError)
      }

      override fun stopSpeech() = this@OverlayCaptureService.stopSpeech()

      override fun clickNext(onResult: (ClickOutcome) -> Unit) {
        val target = prefs.readTarget() ?: return onResult(ClickOutcome.TARGET_INVALID)
        // Re-validated before every click: rotation / resize mid-session stops here.
        if (TargetValidator.validate(target, ScreenGeometryReader.current(this@OverlayCaptureService)) !=
          TargetProblem.NONE
        ) {
          return onResult(ClickOutcome.TARGET_INVALID)
        }
        val service = ScrollAccessibilityService.running() ?: return onResult(ClickOutcome.NO_PERMISSION)
        // Our own windows must not be under the tap.
        bubble?.setHiddenForCapture(true)
        panel?.setHiddenForCapture(true)
        main.postDelayed(
          {
            service.clickTarget(target) { outcome ->
              main.post {
                bubble?.setHiddenForCapture(false)
                panel?.setHiddenForCapture(false)
                onResult(outcome)
              }
            }
          },
          HIDE_BEFORE_CAPTURE_MS,
        )
      }

      override fun schedule(delayMs: Long, block: () -> Unit) {
        main.postDelayed(block, delayMs)
      }

      override fun onStateChanged(state: PaginationState, info: PaginationInfo) {
        ScreenOcrBus.readingActive = state.isActive
        panel?.updatePagination(state, info)
        if (state == PaginationState.NEEDS_ATTENTION) abandonAudioFocus()
        if (state.isActive) return
        abandonAudioFocus()
        bubble?.setReading(false)
        when (info.issue) {
          PaginationIssue.PAGE_LIMIT -> toast(R.string.pagination_issue_page_limit)
          PaginationIssue.LAST_PAGE -> toast(R.string.pagination_issue_last_page)
          PaginationIssue.EMPTY_PAGE -> toast(R.string.screen_ocr_no_text)
          PaginationIssue.CAPTURE_FAILED ->
            if (!lastCaptureHidden) toast(R.string.screen_ocr_capture_failed)
          PaginationIssue.SPEECH_FAILED -> toast(R.string.reading_error_speech)
          PaginationIssue.VOICE_MISSING -> toast(R.string.reading_error_voice)
          PaginationIssue.TRANSLATE_FAILED -> toast(translateErrorRes(lastTranslateError))
          else -> Unit
        }
        val ended = pagination
        main.postDelayed(
          { if (pagination === ended && pagination?.state?.isActive != true) panel?.remove() },
          PANEL_LINGER_MS,
        )
      }
    }

  /** Shows the crosshair picker (from Settings, the panel, or a tap with no valid pin). */
  private fun startCalibration() {
    if (bubble == null) return
    session?.stop()
    pagination?.stop()
    panel?.remove()
    val config = prefs.readConfig()
    val saved = prefs.readTarget()
    val created = picker ?: TargetPicker(overlayContext(), this).also { picker = it }
    try {
      bubble?.setHiddenForCapture(true)
      created.show(config, saved?.x, saved?.y)
    } catch (e: RuntimeException) {
      Log.w(TAG, "Picker window rejected: ${e.javaClass.simpleName}")
      bubble?.setHiddenForCapture(false)
    }
  }

  override fun onPinned(x: Int, y: Int, anchor: TargetAnchor) {
    bubble?.setHiddenForCapture(false)
    val access = ScrollAccessibilityService.running()
    // Identity of the control under the pin (needs the accessibility service).
    val node = access?.identifyAt(x, y)
    var chosen = anchor
    if (chosen == TargetAnchor.CONTENT && node?.isIdentifiable != true) {
      chosen = TargetAnchor.SCREEN
      toast(R.string.pagination_content_unavailable)
    } else {
      toast(R.string.pagination_target_saved)
    }
    prefs.writeTarget(
      PaginationTarget(
        x = x,
        y = y,
        anchor = chosen,
        geometry = ScreenGeometryReader.current(this),
        node = node,
        packageName = access?.activePackage().orEmpty(),
        calibratedAt = System.currentTimeMillis(),
      ),
    )
    ScreenOcrBus.notifyStatus()
  }

  override fun onPickerCancelled() {
    bubble?.setHiddenForCapture(false)
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
    pagination?.stop()
    pagination = null
    gemini?.shutdown()
    gemini = null
    picker?.remove()
    picker = null
    ScreenOcrBus.readingActive = false
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
    private const val ACTION_CALIBRATE = "com.rnboilerplate.screenocr.CALIBRATE"
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

    /** Opens the Next-button picker; false when the floating button is not running. */
    fun startCalibration(context: Context): Boolean {
      if (!isRunning) return false
      sendIfRunning(context, ACTION_CALIBRATE)
      return true
    }

    private fun sendIfRunning(context: Context, action: String) {
      if (!isRunning) return
      context.startService(Intent(context, OverlayCaptureService::class.java).setAction(action))
    }
  }
}
