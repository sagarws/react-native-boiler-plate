package com.rnboilerplate.recorder

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.content.res.Configuration
import android.graphics.Bitmap
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.widget.Toast
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.IntentCompat
import com.rnboilerplate.MainActivity
import com.rnboilerplate.R
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.Date
import java.util.UUID
import java.util.concurrent.Executors

/**
 * The recording button, screen capture, recording sessions and merging —
 * independent of the OCR button's OverlayCaptureService (own window, own
 * consent, own notification, own preferences).
 *
 * Lifecycle:
 * - The bubble alone is a plain started service (an app showing an overlay
 *   stays alive); nothing is captured and no frames are rendered.
 * - Screen capture needs Android's consent each time a projection starts
 *   (RecorderConsentActivity). While a projection is held the service is a
 *   `mediaProjection` foreground service with an ongoing notification and
 *   the system's capture indicator; recording audio adds `microphone`;
 *   merging without a projection uses `dataSync`.
 * - Segments, timers and merging all run here, never in React Native: the
 *   UI can close and the recording continues. JS gets state changes only.
 *
 * The session state machine ([RecordingStateMachine]) makes Start/Stop
 * idempotent and blocks a second session or a merge while files are open.
 */
class RecorderService : Service(), RecorderBubble.Listener, ScreenshotPreview.Listener, SegmentedRecorder.Listener {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newSingleThreadExecutor()
  private lateinit var prefs: RecorderPrefs
  private lateinit var storage: OutputStorage
  private lateinit var store: RecordingStore
  private var config = RecorderConfig()
  private val machine = RecordingStateMachine()

  private var bubble: RecorderBubble? = null
  private var menu: RecorderMenu? = null
  private var controls: RecordingControls? = null
  private var preview: ScreenshotPreview? = null
  private var capture: CaptureSource? = null
  private var awaitingConsent = false
  private var endCaptureAfterSession = false

  // Current recording
  private var recorder: SegmentedRecorder? = null
  private var sessionEntryId: String? = null
  private var sessionMode: RecorderMode? = null
  private var sessionStartedAt = 0L
  private var pausedAt = 0L
  private var pausedTotal = 0L
  private var content = ""
  private var mergeProgress = 0f
  private var foregroundTypes = -1

  // Screenshot waiting in the preview / editor
  private var pendingShot: File? = null

  private val ticker =
    object : Runnable {
      override fun run() {
        tick()
        main.postDelayed(this, 1000)
      }
    }
  private var lastStorageCheck = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    prefs = RecorderPrefs(this)
    storage = OutputStorage(this)
    store = RecordingStore.get(this)
    config = prefs.read()
    running = this
    // A previous process may have died mid-session: keep what it finished.
    val startedAt = System.currentTimeMillis()
    io.execute { store.recoverStale(startedAt) { MediaCheck.verify(this, storage, it) } }
    RecorderEvents.onEditorClosed = { source, saved -> main.post { onEditorClosed(source, saved) } }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    config = prefs.read()
    when (intent?.action) {
      ACTION_SHOW -> showBubble()
      ACTION_HIDE -> hideBubble()
      ACTION_RUN -> runMode(RecorderMode.from(intent.getStringExtra(EXTRA_MODE) ?: config.mode.id))
      ACTION_STOP -> stopRecording(null)
      ACTION_PAUSE_RESUME -> pauseResume()
      ACTION_END_CAPTURE -> endCapture()
      ACTION_CONFIG -> applyConfig()
      ACTION_RESET_POSITION -> bubble?.resetPosition()
      ACTION_CONSENT -> onConsent(intent)
      ACTION_MERGE -> intent.getStringExtra(EXTRA_ID)?.let { remerge(it) }
      else -> if (bubble == null && !machine.state.busy) stopSelf()
    }
    return START_NOT_STICKY
  }

  // ── Bubble ──

  private fun showBubble() {
    if (bubble != null) {
      bubble?.apply(config)
      return
    }
    if (!Settings.canDrawOverlays(this)) {
      emitError("overlay_permission")
      stopIfIdle()
      return
    }
    val b = RecorderBubble(overlayContext(), prefs, this)
    try {
      b.show(config)
    } catch (e: RuntimeException) {
      emitError("overlay_permission")
      stopIfIdle()
      return
    }
    bubble = b
    if (machine.state.capturing) b.setActive(true, machine.state == RecordingState.PAUSED)
    publish()
  }

  private fun hideBubble() {
    menu?.remove()
    menu = null
    bubble?.remove()
    bubble = null
    // An active recording keeps its controls and notification Stop.
    if (!machine.state.capturing) {
      preview?.remove()
      discardPendingShot()
    }
    publish()
    stopIfIdle()
  }

  private fun applyConfig() {
    bubble?.apply(config)
    if (!config.bubbleEnabled && bubble != null) hideBubble()
  }

  override fun onBubbleTap() {
    if (menu?.showing == true) {
      menu?.dismiss()
      return
    }
    when {
      machine.state.capturing -> stopRecording(null)
      machine.state.busy -> toast(R.string.rec_busy)
      else -> runMode(config.mode)
    }
  }

  override fun onBubbleLongPress() {
    val b = bubble ?: return
    if (!config.longPressMenu) return
    if (machine.state.busy) {
      toast(R.string.rec_stop_to_change_mode)
      return
    }
    preview?.remove()
    val m = menu ?: RecorderMenu(overlayContext(), ::pickMode) { menu = null }.also { menu = it }
    m.show(config, b)
  }

  override fun onBubbleMoved() {
    bubble?.let { controls?.position(it) }
  }

  private fun pickMode(mode: RecorderMode) {
    menu = null
    config = config.copy(mode = mode)
    prefs.write(config)
    bubble?.apply(config)
    toast(mode.label())
    RecorderEvents.emit("config_changed")
    publish()
  }

  // ── Actions ──

  private fun needsProjection(mode: RecorderMode) = mode.video || mode == RecorderMode.SCREENSHOT || (mode.audio && config.audioSource.system)

  private fun hasMic() = ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  private fun runMode(mode: RecorderMode) {
    if (machine.state.busy || awaitingConsent) {
      if (machine.state.capturing) stopRecording(null) else toast(R.string.rec_busy)
      return
    }
    val projection = needsProjection(mode) && capture == null
    // Audio modes always pass through the (invisible) trampoline: it checks
    // the microphone permission and lets the service add the microphone
    // foreground type while the app is visible, as Android 14+ requires.
    if (projection || mode.audio) {
      awaitingConsent = true
      if (mode.records) machine.move(RecordingState.REQUESTING_PERMISSION)
      publish()
      RecorderConsentActivity.start(this, mode.id, projection, mode.audio)
      return
    }
    execute(mode)
  }

  private fun onConsent(intent: Intent) {
    awaitingConsent = false
    val mode = RecorderMode.from(intent.getStringExtra(EXTRA_MODE))
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, RESULT_CANCELLED)
    val data = IntentCompat.getParcelableExtra(intent, EXTRA_RESULT_DATA, Intent::class.java)
    if (resultCode == RESULT_MIC_DENIED || resultCode == RESULT_CANCELLED) {
      if (machine.state == RecordingState.REQUESTING_PERMISSION) machine.move(RecordingState.IDLE)
      if (resultCode == RESULT_MIC_DENIED) {
        toast(R.string.rec_mic_denied)
        emitError("mic_permission")
      } else {
        emitError("consent_denied")
      }
      publish()
      stopIfIdle()
      return
    }
    if (data != null) {
      // Foreground with the mediaProjection type before obtaining the projection.
      if (!enterForeground(withProjection = true, withMic = mode.audio && hasMic())) {
        failStart("foreground")
        return
      }
      val manager = getSystemService(MediaProjectionManager::class.java)
      val projection =
        try {
          manager.getMediaProjection(resultCode, data)
        } catch (e: RuntimeException) {
          null
        }
      if (projection == null) {
        failStart("projection")
        return
      }
      capture = CaptureSource(overlayContext(), projection) { onProjectionStopped() }
    } else if (!enterForeground(withProjection = capture != null, withMic = mode.audio && hasMic())) {
      failStart("foreground")
      return
    }
    execute(mode)
  }

  private fun failStart(code: String, message: Int = R.string.rec_start_failed) {
    if (machine.state == RecordingState.REQUESTING_PERMISSION || machine.state == RecordingState.PREPARING) {
      machine.move(RecordingState.FAILED)
    }
    emitError(code)
    toast(message)
    updateForeground()
    publish()
    stopIfIdle()
  }

  private fun execute(mode: RecorderMode) {
    if (mode == RecorderMode.SCREENSHOT) screenshot() else startRecording(mode)
  }

  // ── Screenshot ──

  private fun screenshot() {
    val source = capture ?: return runMode(RecorderMode.SCREENSHOT)
    preview?.remove()
    discardPendingShot()
    bubble?.setHidden(true)
    controls?.remove()
    // Two frames for the bubble to leave the screen before capturing.
    main.postDelayed({
      source.screenshot(1500) { bitmap ->
        bubble?.setHidden(false)
        if (bitmap == null) {
          if (!config.keepCaptureSession) endCapture()
          toast(R.string.rec_screenshot_failed)
          emitError("screenshot_failed")
          return@screenshot
        }
        if (looksBlank(bitmap)) toast(R.string.rec_screenshot_protected)
        io.execute {
          val file = File(cacheDir, "screenshots").apply { mkdirs() }.let { File(it, "pending_${System.currentTimeMillis()}.png") }
          val ok =
            try {
              FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            } catch (_: Exception) {
              false
            }
          main.post {
            if (!ok) {
              bitmap.recycle()
              file.delete()
              toast(R.string.rec_save_failed)
              return@post
            }
            pendingShot = file
            showPreview(bitmap)
            if (!config.keepCaptureSession) endCapture()
          }
        }
      }
    }, 120)
  }

  /** Secure (FLAG_SECURE) windows come back black; say so instead of saving silently. */
  private fun looksBlank(bitmap: Bitmap): Boolean {
    val stepX = (bitmap.width / 12).coerceAtLeast(1)
    val stepY = (bitmap.height / 20).coerceAtLeast(1)
    var x = stepX / 2
    while (x < bitmap.width) {
      var y = stepY / 2
      while (y < bitmap.height) {
        if (bitmap.getPixel(x, y) and 0x00FFFFFF != 0) return false
        y += stepY
      }
      x += stepX
    }
    return true
  }

  private fun showPreview(bitmap: Bitmap) {
    val b = bubble
    if (b == null) {
      // No button to anchor the preview: keep the screenshot rather than lose it.
      savePendingShot(bitmap)
      return
    }
    val p = preview ?: ScreenshotPreview(overlayContext(), this).also { preview = it }
    p.show(bitmap, config, b)
    bitmap.recycle()
  }

  override fun onPreviewEdit() {
    val file = pendingShot ?: return
    preview?.remove()
    ScreenshotEditorActivity.open(this, Uri.fromFile(file).toString())
  }

  override fun onPreviewSave() {
    preview?.remove()
    val file = pendingShot ?: return
    io.execute {
      val bitmap = android.graphics.BitmapFactory.decodeFile(file.path)
      main.post { if (bitmap != null) savePendingShot(bitmap) else toast(R.string.rec_save_failed) }
    }
  }

  override fun onPreviewDiscard() {
    preview?.remove()
    discardPendingShot()
  }

  override fun onPreviewTimeout() {
    if (config.autoSaveScreenshot) onPreviewSave() else onPreviewDiscard()
  }

  private fun savePendingShot(bitmap: Bitmap) {
    val file = pendingShot
    pendingShot = null
    io.execute {
      val ok =
        try {
          ScreenshotSaver.save(this, bitmap, config, edited = false)
          true
        } catch (_: Exception) {
          false
        } finally {
          bitmap.recycle()
          file?.delete()
        }
      main.post { toast(if (ok) R.string.rec_screenshot_saved else R.string.rec_save_failed) }
    }
  }

  private fun discardPendingShot() {
    pendingShot?.delete()
    pendingShot = null
  }

  private fun onEditorClosed(source: String, saved: Boolean) {
    val file = pendingShot ?: return
    if (Uri.fromFile(file).toString() != source) return
    if (saved) {
      discardPendingShot()
      return
    }
    // Cancelled: offer the original again.
    io.execute {
      val bitmap = android.graphics.BitmapFactory.decodeFile(file.path)
      main.post { if (bitmap != null) showPreview(bitmap) else discardPendingShot() }
    }
  }

  // ── Recording ──

  private fun startRecording(mode: RecorderMode) {
    if (!machine.canStart() && machine.state != RecordingState.REQUESTING_PERMISSION) return
    if (!machine.move(RecordingState.PREPARING)) return
    publish()
    val source = capture
    if (mode.video && source == null) return failStart("projection")
    val segmentsTree = config.dirs[OutputKind.SEGMENTS]
    if (storage.freeBytes(OutputKind.SEGMENTS, segmentsTree) < config.storageWarningMb * 1_000_000L) {
      return failStart("storage_low", R.string.rec_storage_low)
    }
    if (config.dirs.entries.any { !storage.status(it.key, it.value).accessible }) {
      return failStart("dir_access", R.string.rec_dir_missing)
    }

    val now = Date()
    val sessionId = RecordingNames.sessionId(now)
    var plan: VideoPlan? = null
    if (mode.video && source != null) {
      val m = source.metrics()
      plan = EncoderSetup.plan(m.width, m.height, config.video)
    }
    var pcm: PcmSource? = null
    val missing = mutableSetOf<PcmSource.Missing>()
    if (mode.audio && hasMic()) {
      val opened = PcmSource.open(config.audioSource, source?.projection, config.audio)
      pcm = opened.source
      missing += opened.missing
    }
    if (mode.audio && pcm == null) {
      // Voice mode with no audio at all can't record anything.
      if (!mode.video) {
        return failStart(
          "audio_unavailable",
          if (PcmSource.Missing.SYSTEM_UNSUPPORTED in missing) R.string.rec_system_audio_unsupported else R.string.rec_audio_failed,
        )
      }
    }
    if (PcmSource.Missing.SYSTEM_UNSUPPORTED in missing) toast(R.string.rec_system_audio_unsupported)
    else if (PcmSource.Missing.SYSTEM_FAILED in missing || PcmSource.Missing.MIC_FAILED in missing) toast(R.string.rec_audio_partial)

    val audioId =
      when {
        pcm == null -> "none"
        pcm.hasSystem && pcm.hasMic -> "system_mic"
        pcm.hasSystem -> "system"
        else -> "mic"
      }
    content = contentLabel(mode.video, audioId)
    val id = UUID.randomUUID().toString()
    val entry =
      JSONObject().apply {
        put("id", id)
        put("sessionId", sessionId)
        put("type", if (mode.video) "video" else "audio")
        put("name", if (mode.video) RecordingNames.screen(now, false) else RecordingNames.voice(now, false))
        put("uri", "")
        put("createdAt", now.time)
        put("durationMs", 0)
        put("sizeBytes", 0)
        plan?.let {
          put("width", it.width)
          put("height", it.height)
          put("fps", it.fps)
          put("videoBitrate", it.bitrate)
        }
        put("audio", audioId)
        put("status", RecordingStore.STATUS_RECORDING)
        put("segmentMinutes", if (config.segmentEnabled) config.segmentMinutes else 0)
        put("keepSegments", config.keepSegments)
        put("segmentsTree", segmentsTree ?: "")
        put("segments", JSONArray())
      }
    try {
      store.put(entry)
    } catch (e: Exception) {
      pcm?.release()
      return failStart("storage")
    }

    val rec =
      SegmentedRecorder(
        storage = storage,
        sessionId = sessionId,
        segmentsTree = segmentsTree,
        segmentDurationUs = config.segmentDurationUs,
        video = plan,
        pcm = pcm,
        audioQuality = if (pcm != null) config.audio else null,
        listener = this,
      )
    try {
      rec.prepare()
      if (plan != null && source != null) source.attachEncoder(rec.inputSurface!!, plan.width, plan.height)
      rec.start()
    } catch (e: Exception) {
      Log.w(TAG, "Recorder failed to start: ${e.javaClass.simpleName}")
      pcm?.release()
      source?.detach()
      store.update(id) { it.put("status", RecordingStore.STATUS_FAILED); it.put("error", "encoder") }
      return failStart("encoder")
    }
    recorder = rec
    sessionEntryId = id
    sessionMode = mode
    sessionStartedAt = SystemClock.elapsedRealtime()
    pausedTotal = 0
    pausedAt = 0
    machine.move(RecordingState.RECORDING)
    preview?.remove()
    bubble?.setActive(true)
    bubble?.let { b ->
      if (config.showControls) {
        val c = controls ?: RecordingControls(overlayContext(), ::pauseResume) { stopRecording(null) }.also { controls = it }
        c.show(config, b)
      }
    }
    setKeepScreenOn(config.keepScreenOn)
    enterForeground(withProjection = capture != null, withMic = pcm != null)
    main.removeCallbacks(ticker)
    main.post(ticker)
    RecorderEvents.emit("recording_started", JSONObject().put("id", id))
    publish()
  }

  private fun contentLabel(video: Boolean, audio: String): String {
    val a =
      when (audio) {
        "system" -> getString(R.string.rec_content_system)
        "mic" -> getString(R.string.rec_content_mic)
        "system_mic" -> getString(R.string.rec_content_system_mic)
        else -> null
      }
    return when {
      video && a == null -> getString(R.string.rec_content_video_only)
      video -> getString(R.string.rec_content_video_with, a)
      else -> a ?: ""
    }
  }

  private fun elapsedMs(): Long {
    if (sessionStartedAt == 0L) return 0
    val now = if (pausedAt > 0) pausedAt else SystemClock.elapsedRealtime()
    return now - sessionStartedAt - pausedTotal
  }

  private fun tick() {
    if (!machine.state.capturing) return
    controls?.update(elapsedMs(), (recorder?.segmentIndex ?: 0) + 1, content, machine.state == RecordingState.PAUSED)
    val now = SystemClock.elapsedRealtime()
    if (now - lastStorageCheck > 30_000) {
      lastStorageCheck = now
      val tree = config.dirs[OutputKind.SEGMENTS]
      io.execute {
        val free = storage.freeBytes(OutputKind.SEGMENTS, tree)
        if (free < config.storageWarningMb * 1_000_000L / 2) main.post { stopRecording("storage_low") }
      }
    }
  }

  private fun pauseResume() {
    val rec = recorder ?: return
    when (machine.state) {
      RecordingState.RECORDING -> {
        if (!machine.move(RecordingState.PAUSED)) return
        rec.pause()
        capture?.detach() // No frames rendered while paused.
        pausedAt = SystemClock.elapsedRealtime()
        bubble?.setActive(true, paused = true)
      }
      RecordingState.PAUSED -> {
        if (!machine.move(RecordingState.RECORDING)) return
        rec.resume()
        val source = capture
        val surface = rec.inputSurface
        val plan = currentPlan()
        if (source != null && surface != null && plan != null) source.attachEncoder(surface, plan.first, plan.second)
        pausedTotal += SystemClock.elapsedRealtime() - pausedAt
        pausedAt = 0
        bubble?.setActive(true)
      }
      else -> return
    }
    tick()
    updateNotification()
    RecorderEvents.emit(if (machine.state == RecordingState.PAUSED) "recording_paused" else "recording_resumed")
    publish()
  }

  private fun currentPlan(): Pair<Int, Int>? {
    val entry = sessionEntryId?.let { store.get(it) } ?: return null
    val w = entry.optInt("width")
    val h = entry.optInt("height")
    return if (w > 0 && h > 0) w to h else null
  }

  /** Idempotent. [reason] non-null = stopped by the system/app, not the user. */
  private fun stopRecording(reason: String?) {
    val rec = recorder ?: return
    if (machine.state == RecordingState.STOPPING || !machine.state.capturing) return
    if (machine.state == RecordingState.PAUSED) {
      pausedTotal += SystemClock.elapsedRealtime() - pausedAt
      pausedAt = 0
    }
    if (!machine.move(RecordingState.STOPPING)) return
    reason?.let {
      sessionEntryId?.let { id -> store.update(id) { e -> e.put("error", it) } }
      emitError(it)
      if (it == "storage_low") toast(R.string.rec_storage_low)
    }
    main.removeCallbacks(ticker)
    controls?.remove()
    bubble?.setActive(false)
    setKeepScreenOn(false)
    rec.stop()
    publish()
  }

  override fun onSegmentStarted(index: Int, uri: Uri, name: String, startUs: Long) {
    main.post {
      val id = sessionEntryId ?: return@post
      store.update(id) { e ->
        val segs = e.optJSONArray("segments") ?: JSONArray().also { e.put("segments", it) }
        segs.put(JSONObject().apply {
          put("index", index)
          put("uri", uri.toString())
          put("name", name)
          put("startUs", startUs)
          put("durationUs", 0)
          put("status", RecordingStore.SEG_WRITING)
        })
      }
      if (index > 0 && machine.state == RecordingState.RECORDING) {
        // Boundary: the previous file is closing as this one opens.
        machine.move(RecordingState.FINALIZING_SEGMENT)
        machine.move(RecordingState.STARTING_NEXT_SEGMENT)
        machine.move(RecordingState.RECORDING)
      }
      RecorderEvents.emit("segment_started", JSONObject().put("index", index))
    }
  }

  override fun onSegmentFinished(index: Int, durationUs: Long, ok: Boolean) {
    main.post {
      val id = sessionEntryId ?: return@post
      io.execute {
        store.update(id) { e ->
          val segs = e.optJSONArray("segments") ?: return@update
          for (k in 0 until segs.length()) {
            val s = segs.getJSONObject(k)
            if (s.optInt("index") != index) continue
            val uri = Uri.parse(s.optString("uri"))
            val valid = ok && MediaCheck.verify(this, storage, uri)
            s.put("status", if (valid) RecordingStore.SEG_DONE else RecordingStore.SEG_FAILED)
            s.put("durationUs", durationUs)
            s.put("sizeBytes", storage.size(uri))
          }
        }
        RecorderEvents.emit("segment_completed", JSONObject().put("index", index).put("ok", ok))
      }
    }
  }

  override fun onFailed(code: String) {
    main.post {
      Log.w(TAG, "Recording failed: $code")
      sessionEntryId?.let { id -> store.update(id) { it.put("error", code) } }
      emitError(code)
      if (machine.state.capturing) {
        machine.move(RecordingState.STOPPING)
        main.removeCallbacks(ticker)
        controls?.remove()
        bubble?.setActive(false)
      }
    }
  }

  override fun onStopped() {
    main.post {
      capture?.detach()
      recorder = null
      val id = sessionEntryId
      sessionEntryId = null
      sessionStartedAt = 0
      val mode = sessionMode
      sessionMode = null
      if (id == null || mode == null) {
        machine.move(RecordingState.FAILED)
        finishSession()
        return@post
      }
      // Segment updates run on io first, so queue the merge behind them.
      io.execute { main.post { afterStop(id) } }
    }
  }

  private fun afterStop(id: String) {
    val entry = store.get(id)
    val segments = entry?.optJSONArray("segments")
    val good = (0 until (segments?.length() ?: 0)).count { segments!!.getJSONObject(it).optString("status") == RecordingStore.SEG_DONE }
    if (entry == null || good == 0) {
      store.update(id) { it.put("status", RecordingStore.STATUS_FAILED); if (!it.has("error")) it.put("error", "no_media") }
      machine.move(RecordingState.FAILED)
      toast(R.string.rec_nothing_recorded)
      RecorderEvents.emit("library_changed")
      finishSession()
      return
    }
    if (!config.autoMerge) {
      store.update(id) { it.put("status", STATUS_UNMERGED); it.put("endedAt", System.currentTimeMillis()) }
      machine.move(RecordingState.COMPLETED)
      toast(R.string.rec_segments_saved)
      RecorderEvents.emit("library_changed")
      finishSession()
      return
    }
    merge(id)
  }

  // ── Merge ──

  private fun remerge(id: String) {
    if (machine.state.busy) {
      toast(R.string.rec_busy)
      emitError("busy")
      return
    }
    if (!enterForeground(withProjection = capture != null, withMic = false, merging = true)) {
      emitError("foreground")
      return
    }
    merge(id)
  }

  private fun merge(id: String) {
    if (!machine.move(RecordingState.MERGING)) {
      emitError("busy")
      return
    }
    mergeProgress = 0f
    store.update(id) { it.put("status", RecordingStore.STATUS_PROCESSING); it.remove("error") }
    updateForeground(merging = true)
    RecorderEvents.emit("merge_started", JSONObject().put("id", id))
    publish()
    val snapshot = config
    io.execute {
      val result = runCatching { mergeBlocking(id, snapshot) }
      main.post {
        val error = result.exceptionOrNull()
        if (error == null) {
          machine.move(RecordingState.COMPLETED)
          toast(R.string.rec_saved)
          RecorderEvents.emit("merge_completed", JSONObject().put("id", id))
        } else {
          val code = (error as? SegmentMerger.MergeException)?.code ?: "merge_failed"
          store.update(id) { it.put("status", RecordingStore.STATUS_FAILED); it.put("error", code) }
          if (machine.state == RecordingState.VERIFYING_OUTPUT || machine.state == RecordingState.MERGING) machine.move(RecordingState.FAILED)
          toast(R.string.rec_merge_failed)
          emitError(code)
        }
        RecorderEvents.emit("library_changed")
        finishSession()
      }
    }
  }

  /** Runs on [io]. Original segments are deleted only after the output verifies. */
  private fun mergeBlocking(id: String, snapshot: RecorderConfig) {
    val entry = store.get(id) ?: throw SegmentMerger.MergeException("not_found")
    val segs = entry.optJSONArray("segments") ?: JSONArray()
    val parts =
      (0 until segs.length()).map { segs.getJSONObject(it) }
        .filter { it.optString("status") == RecordingStore.SEG_DONE }
        .sortedBy { it.optInt("index") }
        .map { SegmentMerger.Part(Uri.parse(it.optString("uri")), it.optLong("startUs")) }
    if (parts.isEmpty()) throw SegmentMerger.MergeException("no_segments")
    val video = entry.optString("type") == "video"
    val createdAt = Date(entry.optLong("createdAt", System.currentTimeMillis()))
    val merged = parts.size > 1
    val kind =
      when {
        merged && snapshot.dirs[OutputKind.MERGED] != null -> OutputKind.MERGED
        video -> OutputKind.VIDEO
        else -> OutputKind.VOICE
      }
    val name = if (video) RecordingNames.screen(createdAt, merged) else RecordingNames.voice(createdAt, merged)
    val mediaKind = if (kind == OutputKind.MERGED) (if (video) OutputKind.VIDEO else OutputKind.VOICE) else kind
    val output =
      try {
        storage.create(if (snapshot.dirs[kind] != null) kind else mediaKind, snapshot.dirs[kind], name, if (video) "video/mp4" else "audio/mp4")
      } catch (e: Exception) {
        throw SegmentMerger.MergeException("storage")
      }
    var lastSent = 0L
    try {
      SegmentMerger(storage).merge(parts, output.uri) { p ->
        val now = SystemClock.elapsedRealtime()
        if (now - lastSent > 500 || p >= 1f) {
          lastSent = now
          main.post {
            mergeProgress = p
            updateNotification()
            RecorderEvents.emit("merge_progress", JSONObject().put("id", id).put("progress", p.toDouble()))
          }
        }
      }
      main.post { machine.move(RecordingState.VERIFYING_OUTPUT) }
      val info = MediaCheck.inspect(this, storage, output.uri) ?: throw SegmentMerger.MergeException("verify_failed")
      if (video && !info.hasVideo) throw SegmentMerger.MergeException("verify_failed")
      if (entry.optString("audio") != "none" && !info.hasAudio) throw SegmentMerger.MergeException("verify_failed")
      storage.finish(output.uri)
      val thumb = if (video) MediaCheck.videoThumb(this, storage, output.uri, id) else null
      val previousUri = entry.optString("uri")
      store.update(id) { e ->
        e.put("uri", output.uri.toString())
        e.put("name", output.name)
        e.put("status", RecordingStore.STATUS_COMPLETED)
        e.put("durationMs", info.durationMs)
        e.put("sizeBytes", storage.size(output.uri))
        e.put("outputKind", kind.id)
        if (!e.has("endedAt")) e.put("endedAt", System.currentTimeMillis())
        thumb?.let { e.put("thumb", it) }
        e.remove("error")
      }
      // A re-merge replaces the old output only once the new one is verified.
      if (previousUri.isNotEmpty() && previousUri != output.uri.toString()) storage.delete(Uri.parse(previousUri))
      if (!entry.optBoolean("keepSegments", false)) {
        store.update(id) { e ->
          val list = e.optJSONArray("segments") ?: return@update
          for (k in 0 until list.length()) {
            val s = list.getJSONObject(k)
            if (s.optString("status") == RecordingStore.SEG_DONE && storage.delete(Uri.parse(s.optString("uri")))) {
              s.put("status", RecordingStore.SEG_DELETED)
            }
          }
        }
      }
    } catch (e: Exception) {
      storage.delete(output.uri) // Never leave a broken final file; segments stay.
      throw e
    }
  }

  // ── Projection / lifecycle ──

  private fun onProjectionStopped() {
    val wasCapturing = machine.state.capturing
    capture?.release()
    capture = null
    if (wasCapturing) {
      // Everything recorded so far is finalized normally.
      toast(R.string.rec_capture_ended)
      stopRecording("capture_revoked")
    }
    updateForeground()
    publish()
  }

  /** The notification's "End screen capture": releases the projection. */
  private fun endCapture() {
    if (machine.state.busy) {
      // Let the session finish its files first; released in finishSession.
      endCaptureAfterSession = true
      if (machine.state.capturing && sessionMode?.let { needsProjection(it) } == true) stopRecording(null)
      return
    }
    capture?.release()
    capture = null
    updateForeground()
    publish()
    stopIfIdle()
  }

  private fun finishSession() {
    if (!config.keepCaptureSession || endCaptureAfterSession) {
      endCaptureAfterSession = false
      capture?.release()
      capture = null
    }
    if (!machine.state.busy) {
      // Back to a clean slate for the next session.
      machine.move(RecordingState.IDLE)
    }
    updateForeground()
    publish()
    stopIfIdle()
  }

  private fun stopIfIdle() {
    if (bubble == null && capture == null && !machine.state.busy && !awaitingConsent && pendingShot == null) {
      updateForeground()
      stopSelf()
    }
  }

  private fun micType() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0

  private fun types(withProjection: Boolean, withMic: Boolean, merging: Boolean): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return 0
    var t = 0
    if (withProjection) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
    if (withMic && hasMic()) t = t or micType()
    if (merging && t == 0) t = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
    return t
  }

  private fun enterForeground(withProjection: Boolean, withMic: Boolean, merging: Boolean = false): Boolean {
    val t = types(withProjection, withMic, merging)
    if (t == foregroundTypes && foregroundTypes > 0) {
      updateNotification()
      return true
    }
    return try {
      ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), t)
      foregroundTypes = t
      true
    } catch (e: RuntimeException) {
      Log.w(TAG, "Could not enter the foreground: ${e.javaClass.simpleName}")
      false
    }
  }

  /** Foreground while a projection, a recording or a merge is held; otherwise not. */
  private fun updateForeground(merging: Boolean = machine.state == RecordingState.MERGING || machine.state == RecordingState.VERIFYING_OUTPUT) {
    val recordingAudio = recorder != null && sessionMode?.audio == true
    val needed = capture != null || machine.state.capturing || merging || machine.state == RecordingState.STOPPING
    if (!needed) {
      if (foregroundTypes >= 0) ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
      foregroundTypes = -1
      return
    }
    enterForeground(capture != null, recordingAudio, merging)
  }

  private fun updateNotification() {
    if (foregroundTypes < 0) return
    getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, buildNotification())
  }

  private fun buildNotification(): Notification {
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) == null) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, getString(R.string.rec_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
          description = getString(R.string.rec_channel_description)
          setShowBadge(false)
        },
      )
    }
    val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
    fun action(icon: Int, label: Int, act: String, code: Int) =
      NotificationCompat.Action(icon, getString(label), PendingIntent.getService(this, code, Intent(this, RecorderService::class.java).setAction(act), PendingIntent.FLAG_IMMUTABLE))

    val builder =
      NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.ic_rec_dot)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(open)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
    val state = machine.state
    when {
      state.capturing || state == RecordingState.STOPPING -> {
        val paused = state == RecordingState.PAUSED
        builder.setContentTitle(getString(if (paused) R.string.rec_notif_paused else R.string.rec_notif_recording, getString(sessionMode?.label() ?: R.string.rec_mode_screen)))
          .setContentText(content)
        if (!paused && sessionStartedAt > 0) {
          builder.setUsesChronometer(true).setWhen(System.currentTimeMillis() - elapsedMs()).setShowWhen(true)
        }
        if (state != RecordingState.STOPPING) {
          builder.addAction(action(if (paused) R.drawable.ic_play else R.drawable.ic_pause, if (paused) R.string.rec_resume else R.string.rec_pause, ACTION_PAUSE_RESUME, 1))
          builder.addAction(action(R.drawable.ic_rec_stop, R.string.rec_stop, ACTION_STOP, 2))
        }
      }
      state == RecordingState.MERGING || state == RecordingState.VERIFYING_OUTPUT ->
        builder.setContentTitle(getString(R.string.rec_notif_merging))
          .setProgress(100, (mergeProgress * 100).toInt(), mergeProgress <= 0f)
      else -> {
        builder.setContentTitle(getString(R.string.rec_notif_ready)).setContentText(getString(R.string.rec_notif_ready_text))
        builder.addAction(action(R.drawable.ic_x, R.string.rec_end_capture, ACTION_END_CAPTURE, 3))
      }
    }
    return builder.build()
  }

  private fun setKeepScreenOn(on: Boolean) {
    bubble?.setKeepScreenOn(on)
  }

  private fun publish() {
    snapshot =
      JSONObject().apply {
        put("bubbleShown", bubble != null)
        put("state", machine.state.id)
        put("mode", config.mode.id)
        put("sessionMode", sessionMode?.id ?: "")
        put("elapsedMs", elapsedMs())
        put("segment", (recorder?.segmentIndex ?: 0) + 1)
        put("content", content)
        put("captureHeld", capture != null)
        put("mergeProgress", mergeProgress.toDouble())
      }
    RecorderEvents.emit("state", snapshot)
    updateNotification()
  }

  private fun emitError(code: String) = RecorderEvents.emit("error", JSONObject().put("code", code))

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    bubble?.onScreenChanged()
    bubble?.let { controls?.position(it) }
    menu?.dismiss()
  }

  private fun overlayContext(): Context =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      createWindowContext(
        getSystemService(android.hardware.display.DisplayManager::class.java).getDisplay(android.view.Display.DEFAULT_DISPLAY),
        android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        null,
      )
    } else {
      this
    }

  private fun toast(res: Int) = Toast.makeText(this, res, Toast.LENGTH_SHORT).show()

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    // Process ending with a session open: close the files cleanly if we can.
    recorder?.stop()
    menu?.remove()
    controls?.remove()
    preview?.remove()
    bubble?.remove()
    capture?.release()
    capture = null
    discardPendingShot()
    RecorderEvents.onEditorClosed = null
    if (running === this) running = null
    snapshot = JSONObject().put("bubbleShown", false).put("state", RecordingState.IDLE.id)
    RecorderEvents.emit("state", snapshot)
    io.shutdown()
    super.onDestroy()
  }

  companion object {
    private const val TAG = "RecorderService"
    private const val CHANNEL_ID = "screen_recorder"
    private const val NOTIFICATION_ID = 4310
    const val STATUS_UNMERGED = "unmerged"

    const val ACTION_SHOW = "com.rnboilerplate.recorder.SHOW"
    const val ACTION_HIDE = "com.rnboilerplate.recorder.HIDE"
    const val ACTION_RUN = "com.rnboilerplate.recorder.RUN"
    const val ACTION_STOP = "com.rnboilerplate.recorder.STOP"
    const val ACTION_PAUSE_RESUME = "com.rnboilerplate.recorder.PAUSE_RESUME"
    const val ACTION_END_CAPTURE = "com.rnboilerplate.recorder.END_CAPTURE"
    const val ACTION_CONFIG = "com.rnboilerplate.recorder.CONFIG"
    const val ACTION_RESET_POSITION = "com.rnboilerplate.recorder.RESET_POSITION"
    const val ACTION_CONSENT = "com.rnboilerplate.recorder.CONSENT"
    const val ACTION_MERGE = "com.rnboilerplate.recorder.MERGE"
    const val EXTRA_MODE = "mode"
    const val EXTRA_ID = "id"
    private const val EXTRA_RESULT_CODE = "result_code"
    private const val EXTRA_RESULT_DATA = "result_data"
    private const val RESULT_OK = -1
    const val RESULT_CANCELLED = 0
    const val RESULT_MIC_DENIED = -100

    @Volatile var running: RecorderService? = null
      private set

    /** Last published state (for RecorderModule.getStatus). */
    @Volatile var snapshot: JSONObject = JSONObject().put("bubbleShown", false).put("state", RecordingState.IDLE.id)
      private set

    fun send(context: Context, action: String, extras: Intent.() -> Unit = {}) {
      val intent = Intent(context, RecorderService::class.java).setAction(action).apply(extras)
      context.startService(intent)
    }

    fun deliverConsent(context: Context, mode: String, resultCode: Int, data: Intent?) {
      val intent =
        Intent(context, RecorderService::class.java)
          .setAction(ACTION_CONSENT)
          .putExtra(EXTRA_MODE, mode)
          .putExtra(EXTRA_RESULT_CODE, resultCode)
      if (data != null) intent.putExtra(EXTRA_RESULT_DATA, data)
      // Started while the consent activity is visible, so the service may
      // enter the foreground with mediaProjection/microphone types.
      if (data != null || resultCode == RESULT_OK) ContextCompat.startForegroundService(context, intent) else context.startService(intent)
    }
  }
}
