package com.rnboilerplate.screenocr

import com.rnboilerplate.screenocr.share.AudioShareHub
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import android.speech.tts.TextToSpeech
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.UiThreadUtil
import org.json.JSONException
import org.json.JSONObject

/**
 * TurboModule bridging the overlay service to JS. Holds no capture state of
 * its own: status lives in [OverlayCaptureService] / [ScreenOcrBus], settings
 * in [OcrPrefs], so the service keeps working while the JS runtime is gone.
 * It owns a separate [SpeechPlayer] for the settings screen (voice info, Test
 * Voice) and in-app reading.
 */
class ScreenOcrModule(context: ReactApplicationContext) :
  NativeScreenOcrSpec(context), ScreenOcrBus.Listener {
  private val prefs = OcrPrefs(context)
  private var speech: SpeechPlayer? = null

  override fun initialize() {
    super.initialize()
    ScreenOcrBus.listener = this
  }

  override fun invalidate() {
    if (ScreenOcrBus.listener === this) ScreenOcrBus.listener = null
    gemini?.shutdown()
    gemini = null
    UiThreadUtil.runOnUiThread {
      speech?.shutdown()
      speech = null
    }
    super.invalidate()
  }

  override fun getStatus(promise: Promise) {
    val status =
      Arguments.createMap().apply {
        putBoolean("overlayPermission", Settings.canDrawOverlays(reactApplicationContext))
        putBoolean("serviceRunning", OverlayCaptureService.isRunning)
      }
    promise.resolve(status)
  }

  override fun openOverlaySettings() {
    startSettings(
      Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:${reactApplicationContext.packageName}"),
      ),
    )
  }

  override fun startOverlay(promise: Promise) {
    if (!Settings.canDrawOverlays(reactApplicationContext)) {
      promise.reject(E_OVERLAY_PERMISSION, "Display over other apps is not allowed")
      return
    }
    if (OverlayCaptureService.isRunning) {
      promise.resolve(true)
      return
    }
    val activity = reactApplicationContext.currentActivity
    if (activity == null) {
      promise.reject(E_NO_ACTIVITY, "The app must be in the foreground")
      return
    }
    // A second request while one is pending supersedes the first.
    ScreenOcrBus.deliverConsent(false)
    ScreenOcrBus.consentCallback = { granted -> promise.resolve(granted) }
    UiThreadUtil.runOnUiThread {
      activity.startActivity(Intent(activity, CaptureConsentActivity::class.java))
    }
  }

  override fun stopOverlay() {
    OverlayCaptureService.stop(reactApplicationContext)
  }

  override fun updateConfig(configJson: String) {
    val json =
      try {
        JSONObject(configJson)
      } catch (_: JSONException) {
        return
      }
    prefs.writeConfig(json)
    OverlayCaptureService.notifyConfigChanged(reactApplicationContext)
    AudioShareHub.apply(reactApplicationContext, json.optJSONObject("audioShare")?.optBoolean("enabled") == true)
  }

  // ── Audio sharing (Chrome extension) ─────────────────────────────────

  override fun getAudioShareStatus(promise: Promise) {
    promise.resolve(AudioShareHub.statusJson().toString())
  }

  override fun respondAudioShare(approve: Boolean) {
    AudioShareHub.respond(approve)
  }

  override fun disconnectAudioShare() {
    AudioShareHub.disconnect()
  }

  override fun resetBubblePosition() {
    prefs.resetPosition()
    OverlayCaptureService.resetPosition(reactApplicationContext)
  }

  override fun copyToClipboard(text: String, promise: Promise) {
    promise.resolve(ClipboardHelper.copy(reactApplicationContext, text, sensitive = false))
  }

  override fun getLatestResult(promise: Promise) {
    promise.resolve(ScreenOcrBus.latest?.toString() ?: "")
  }

  override fun consumePendingResults(promise: Promise) {
    promise.resolve(prefs.drainPending())
  }

  override fun clearCapturedData() {
    ScreenOcrBus.latest = null
    prefs.clearPending()
  }

  // ── Speech ────────────────────────────────────────────────────────────

  /** The module's player, recreated when the engine preference changes. Main thread only. */
  private fun player(): SpeechPlayer {
    val preferGoogle = prefs.readConfig().speech.preferGoogle
    val wanted =
      if (preferGoogle && SpeechPlayer.isGoogleInstalled(reactApplicationContext)) SpeechPlayer.GOOGLE_TTS else ""
    speech?.let { if (it.enginePackage == wanted) return it }
    speech?.shutdown()
    return SpeechPlayer(reactApplicationContext, preferGoogle).also { speech = it }
  }

  override fun getSpeechInfo(promise: Promise) {
    UiThreadUtil.runOnUiThread {
      val p = player()
      p.whenReady { ok ->
        val info =
          if (ok) p.describe() else JSONObject().put("ready", false).put("activeEngine", p.enginePackage)
        info.put("scrollServiceEnabled", ScrollAccessibilityService.isEnabled(reactApplicationContext))
        info.put("googleInstalled", SpeechPlayer.isGoogleInstalled(reactApplicationContext))
        promise.resolve(info.toString())
      }
    }
  }

  override fun openTtsSettings() {
    startSettings(Intent("com.android.settings.TTS_SETTINGS"), fallback = Intent(Settings.ACTION_SETTINGS))
  }

  override fun installVoiceData() {
    UiThreadUtil.runOnUiThread {
      val engine = speech?.enginePackage?.takeIf { it.isNotEmpty() } ?: speech?.defaultEngine().orEmpty()
      val install = Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA)
      if (engine.isNotEmpty()) install.setPackage(engine)
      startSettings(install, fallback = Intent("com.android.settings.TTS_SETTINGS"))
    }
  }

  override fun testVoice(
    text: String,
    language: String,
    voiceName: String,
    rate: Double,
    pitch: Double,
    promise: Promise,
  ) {
    speakOnce(text, language, voiceName, rate.toFloat(), pitch.toFloat(), switchByScript = false, promise)
  }

  override fun speakText(text: String, promise: Promise) {
    val s = prefs.readConfig().speech
    speakOnce(text, s.language, s.voiceName, s.rate, s.pitch, s.switchByScript, promise)
  }

  private fun speakOnce(
    text: String,
    language: String,
    voiceName: String,
    rate: Float,
    pitch: Float,
    switchByScript: Boolean,
    promise: Promise,
  ) {
    UiThreadUtil.runOnUiThread {
      val p = player()
      p.whenReady { ok ->
        if (!ok) {
          promise.resolve("not_ready")
          return@whenReady
        }
        val available = OcrConfig.SPEECH_LANGUAGES.filter { p.isLanguageUsable(it) }.toSet()
        if (!switchByScript && language !in available) {
          promise.resolve("voice_missing")
          return@whenReady
        }
        val segments = SpeechSegmenter.segment(text, language, switchByScript, available)
        var settled = false
        p.speak(
          segments,
          0,
          voiceName,
          rate,
          pitch,
          onProgress = { _, _ -> },
          onDone = {
            if (!settled) {
              settled = true
              promise.resolve("ok")
            }
          },
          onError = { reason ->
            if (!settled) {
              settled = true
              promise.resolve(if (reason == ReadingReason.VOICE_MISSING) "voice_missing" else "speech_failed")
            }
          },
          onCancelled = {
            if (!settled) {
              settled = true
              promise.resolve("stopped")
            }
          },
        )
      }
    }
  }

  /**
   * Plays a sample with exactly [voiceName] — no substitute voice. Refused
   * while an overlay reading session is speaking, so the two never overlap.
   * Resolves 'ok', 'stopped' (Stop or another preview), 'busy',
   * 'voice_missing', 'not_installed', 'speech_failed' or 'not_ready'.
   */
  override fun previewVoice(
    text: String,
    language: String,
    voiceName: String,
    rate: Double,
    pitch: Double,
    promise: Promise,
  ) {
    if (ScreenOcrBus.readingActive) {
      promise.resolve("busy")
      return
    }
    UiThreadUtil.runOnUiThread {
      val p = player()
      p.whenReady { ok ->
        if (!ok) {
          promise.resolve("not_ready")
          return@whenReady
        }
        val voice = p.voiceNamed(voiceName)
        when {
          voice == null || voice.locale.language != language -> promise.resolve("voice_missing")
          !p.isInstalled(voice) -> promise.resolve("not_installed")
          else -> speakOnce(text, language, voiceName, rate.toFloat(), pitch.toFloat(), false, promise)
        }
      }
    }
  }

  override fun stopSpeech() {
    UiThreadUtil.runOnUiThread { speech?.stop() }
  }

  override fun isScrollServiceEnabled(promise: Promise) {
    promise.resolve(ScrollAccessibilityService.isEnabled(reactApplicationContext))
  }

  override fun getPaginationTarget(promise: Promise) {
    val target = prefs.readTarget()
    if (target == null) {
      promise.resolve("")
      return
    }
    val problem = TargetValidator.validate(target, ScreenGeometryReader.current(reactApplicationContext))
    promise.resolve(target.toJson().put("problem", problem.id).toString())
  }

  // ── Gemini key (never returned to JS) ─────────────────────────────────

  private val keyStore by lazy { SecureKeyStore(reactApplicationContext) }
  private var gemini: GeminiClient? = null

  override fun setGeminiKey(apiKey: String, promise: Promise) {
    val trimmed = apiKey.trim()
    promise.resolve(trimmed.length in 10..512 && keyStore.save(trimmed))
  }

  override fun clearGeminiKey() {
    keyStore.clear()
  }

  override fun getGeminiKeyStatus(promise: Promise) {
    promise.resolve(JSONObject().put("hasKey", keyStore.hasKey).put("hint", keyStore.hint).toString())
  }

  override fun testGeminiKey(promise: Promise) {
    val key = keyStore.read()
    if (key == null) {
      promise.resolve("no_key")
      return
    }
    val client = gemini ?: GeminiClient().also { gemini = it }
    client.test(key, prefs.readConfig().translate) { result ->
      val report = JSONObject()
      result.fold(
        onSuccess = { report.put("outcome", "ok").put("sample", it.text.take(120)) },
        onFailure = {
          val failure = it as? TranslateException
          report
            .put("outcome", (failure?.error ?: TranslateError.SERVER).name.lowercase())
            .put("status", failure?.status ?: 0)
            .put("detail", failure?.detail.orEmpty())
        },
      )
      promise.resolve(report.toString())
    }
  }

  override fun listGeminiModels(promise: Promise) {
    val key = keyStore.read()
    if (key == null) {
      promise.resolve(JSONObject().put("outcome", "no_key").toString())
      return
    }
    val client = gemini ?: GeminiClient().also { gemini = it }
    client.listModels(key) { result ->
      val report = JSONObject()
      result.fold(
        onSuccess = { models ->
          val array = org.json.JSONArray()
          models.forEach { array.put(JSONObject().put("id", it.id).put("displayName", it.displayName)) }
          report.put("outcome", "ok").put("models", array)
        },
        onFailure = {
          val failure = it as? TranslateException
          report
            .put("outcome", (failure?.error ?: TranslateError.SERVER).name.lowercase())
            .put("status", failure?.status ?: 0)
            .put("detail", failure?.detail.orEmpty())
        },
      )
      promise.resolve(report.toString())
    }
  }

  override fun clearPaginationTarget() {
    prefs.clearTarget()
  }

  override fun startTargetCalibration(promise: Promise) {
    promise.resolve(
      if (OverlayCaptureService.startCalibration(reactApplicationContext)) "started" else "not_running",
    )
  }

  override fun openAccessibilitySettings() {
    startSettings(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
  }

  private fun startSettings(intent: Intent, fallback: Intent? = null) {
    try {
      reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    } catch (_: ActivityNotFoundException) {
      fallback?.let { reactApplicationContext.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
  }

  override fun onCaptureResult() = emit(EVENT_RESULT)

  override fun onStatusChanged() = emit(EVENT_STATUS)

  /** Payload-free nudges; JS pulls the data, so nothing is delivered twice. */
  private fun emit(event: String) {
    if (!reactApplicationContext.hasActiveReactInstance()) return
    reactApplicationContext.emitDeviceEvent(event, null)
  }

  companion object {
    const val NAME = NativeScreenOcrSpec.NAME
    private const val E_OVERLAY_PERMISSION = "overlay_permission"
    private const val E_NO_ACTIVITY = "no_activity"
    private const val EVENT_RESULT = "ScreenOcrResult"
    private const val EVENT_STATUS = "ScreenOcrStatus"
  }
}
