package com.rnboilerplate.screenocr

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import com.rnboilerplate.screenocr.share.AudioShareHub
import com.rnboilerplate.screenocr.share.SharedSpeech
import android.speech.tts.Voice
import android.util.Log
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

/**
 * Android `TextToSpeech`, with Google Speech Services preferred when it is
 * installed (never assumed: the installed engine list is checked, and the
 * system default is used otherwise).
 *
 * Voices are per language. For each language the configured voice is used
 * when installed; otherwise the engine's default voice **for that same
 * language**. If the language itself is missing or unsupported, speech fails
 * with [ReadingReason.VOICE_MISSING] rather than switching to an unrelated
 * voice. Offline use depends on the voice: those flagged as needing a network
 * are reported so the UI can say so.
 *
 * Android TTS has no pause; [SpeechPlayer] stops and the caller resumes from
 * the segment it was on. Callbacks arrive on the main thread.
 */
class SpeechPlayer(context: Context, private val preferGoogle: Boolean) {
  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val waiting = ArrayList<(Boolean) -> Unit>()
  private var ready: Boolean? = null
  private var session = 0
  private var listener: Listener? = null
  private var ids: List<String> = emptyList()
  /** synthesizeToFile requests in flight (used while sharing audio). */
  private val synthCallbacks = HashMap<String, (Boolean) -> Unit>()
  private var synthCount = 0
  /** Set while speaking through [SharedSpeech] (a Chrome receiver is listening). */
  private var shared: SharedSpeech? = null
  private val attributes =
    AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_ACCESSIBILITY)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()

  private interface Listener {
    fun onStart(index: Int)

    fun onDone(index: Int)

    fun onError(code: Int)

    /** Stopped or replaced by a newer request before it finished. */
    fun onCancelled()
  }

  /** Ends the current request's callbacks, telling its owner it was cancelled. */
  private fun cancelCurrent() {
    val previous = listener
    listener = null
    previous?.onCancelled()
  }

  val enginePackage: String
  private val tts: TextToSpeech

  init {
    enginePackage = if (preferGoogle && isGoogleInstalled(context)) GOOGLE_TTS else ""
    val onInit =
      TextToSpeech.OnInitListener { status ->
        main.post {
          ready = status == TextToSpeech.SUCCESS
          if (ready == true) {
            tts.setAudioAttributes(attributes)
            tts.setOnUtteranceProgressListener(progress)
          } else {
            Log.w(TAG, "TTS init failed: $status")
          }
          waiting.forEach { it(ready == true) }
          waiting.clear()
        }
      }
    tts =
      if (enginePackage.isEmpty()) TextToSpeech(context.applicationContext, onInit)
      else TextToSpeech(context.applicationContext, onInit, enginePackage)
  }

  private val progress =
    object : UtteranceProgressListener() {
      override fun onStart(utteranceId: String) = dispatch(utteranceId) { l, i -> l.onStart(i) }

      override fun onDone(utteranceId: String) {
        if (!finishSynth(utteranceId, true)) dispatch(utteranceId) { l, i -> l.onDone(i) }
      }

      @Deprecated("Deprecated in Java")
      override fun onError(utteranceId: String) {
        if (!finishSynth(utteranceId, false)) dispatch(utteranceId) { l, _ -> l.onError(-1) }
      }

      override fun onError(utteranceId: String, errorCode: Int) {
        if (!finishSynth(utteranceId, false)) dispatch(utteranceId) { l, _ -> l.onError(errorCode) }
      }

      override fun onStop(utteranceId: String, interrupted: Boolean) {
        finishSynth(utteranceId, false)
      }
    }

  /** Completes a synthesizeToFile request; false if [id] isn't one. */
  private fun finishSynth(id: String, ok: Boolean): Boolean {
    if (!id.startsWith("f")) return false
    main.post { synthCallbacks.remove(id)?.invoke(ok) }
    return true
  }

  /**
   * Renders [text] to a WAV [file] (no playback) with the same voice rules as
   * [speak]; [onDone] runs on main with success. For audio sharing.
   */
  fun synthesize(
    text: String,
    language: String,
    voiceName: String,
    rate: Float,
    pitch: Float,
    file: java.io.File,
    onDone: (Boolean) -> Unit,
  ) {
    whenReady { ok ->
      if (!ok || !applyLanguage(language, voiceName)) {
        onDone(false)
        return@whenReady
      }
      tts.setSpeechRate(rate)
      tts.setPitch(pitch)
      val id = "f${++synthCount}"
      synthCallbacks[id] = onDone
      if (tts.synthesizeToFile(text, Bundle(), file, id) != TextToSpeech.SUCCESS) {
        synthCallbacks.remove(id)
        onDone(false)
      }
    }
  }

  /** Routes engine callbacks (binder threads) to the current session on main. */
  private fun dispatch(id: String, block: (Listener, Int) -> Unit) {
    main.post {
      val current = listener ?: return@post
      val index = ids.indexOf(id)
      if (index >= 0) block(current, index)
    }
  }

  fun whenReady(callback: (Boolean) -> Unit) {
    val state = ready
    if (state != null) callback(state) else waiting += callback
  }

  val isReady: Boolean
    get() = ready == true

  fun defaultEngine(): String = tts.defaultEngine ?: ""

  fun installedEngines(): List<TextToSpeech.EngineInfo> = tts.engines

  fun localeFor(language: String): Locale =
    when (language) {
      "hi" -> Locale("hi", "IN")
      "gu" -> Locale("gu", "IN")
      else -> Locale("en", "IN")
    }

  /** LANG_AVAILABLE…LANG_NOT_SUPPORTED, trying en-IN then en-US for English. */
  fun languageStatus(language: String): Int {
    if (!isReady) return TextToSpeech.LANG_NOT_SUPPORTED
    val status = tts.isLanguageAvailable(localeFor(language))
    if (language == "en" && status < TextToSpeech.LANG_AVAILABLE) return tts.isLanguageAvailable(Locale.US)
    return status
  }

  fun isLanguageUsable(language: String): Boolean = languageStatus(language) >= TextToSpeech.LANG_AVAILABLE

  fun voices(): List<Voice> = if (isReady) tts.voices?.toList().orEmpty() else emptyList()

  private fun installed(voice: Voice) =
    TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in voice.features.orEmpty()

  /** Applies the voice for [language]; false when that language cannot be spoken. */
  private fun applyLanguage(language: String, voiceName: String): Boolean {
    if (!isLanguageUsable(language)) return false
    val chosen =
      voices().firstOrNull { it.name == voiceName && it.locale.language == language && installed(it) }
    if (chosen != null && tts.setVoice(chosen) == TextToSpeech.SUCCESS) return true
    val locale = localeFor(language)
    val result = tts.setLanguage(if (tts.isLanguageAvailable(locale) >= 0) locale else Locale.US)
    return result >= TextToSpeech.LANG_AVAILABLE
  }

  /**
   * Speaks [segments] from [from]; reports progress and completion of the
   * whole queue. Any earlier queue is flushed.
   */
  fun speak(
    segments: List<SpeechSegment>,
    from: Int,
    voiceName: String,
    rate: Float,
    pitch: Float,
    onProgress: (Int, Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
    onCancelled: () -> Unit = {},
  ) {
    whenReady { ok ->
      if (!ok) {
        onError(ReadingReason.SPEECH_FAILED)
        return@whenReady
      }
      // Only one request at a time: the previous one ends as cancelled.
      cancelCurrent()
      val token = ++session
      endShared()
      tts.stop()
      val queue = segments.drop(from)
      if (queue.isEmpty()) {
        onDone()
        return@whenReady
      }
      tts.setSpeechRate(rate)
      tts.setPitch(pitch)
      ids = segments.indices.map { "s$token-$it" }
      listener =
        object : Listener {
          override fun onStart(index: Int) = onProgress(index, segments.size)

          override fun onDone(index: Int) {
            if (index == segments.size - 1) {
              listener = null
              onDone()
            }
          }

          override fun onError(code: Int) {
            listener = null
            onError(ReadingReason.SPEECH_FAILED)
          }

          override fun onCancelled() = onCancelled()
        }
      if (AudioShareHub.isStreaming) {
        // Same voice rules as below, checked up front.
        queue.map { it.language }.distinct().firstOrNull { !isLanguageUsable(it) }?.let {
          listener = null
          onError(ReadingReason.VOICE_MISSING)
          return@whenReady
        }
        val current = listener
        shared =
          SharedSpeech(
            appContext.cacheDir,
            segments,
            from,
            attributes,
            PARAGRAPH_PAUSE_MS,
            render = { segment, file, done -> synthesize(segment.text, segment.language, voiceName, rate, pitch, file, done) },
            onStart = { index -> if (token == session && listener === current) current?.onStart(index) },
            onDone = {
              if (token == session && listener === current) {
                shared = null
                listener = null
                onDone()
              }
            },
            onFailed = {
              if (token == session && listener === current) {
                shared = null
                listener = null
                onError(ReadingReason.SPEECH_FAILED)
              }
            },
          ).also { it.start() }
        return@whenReady
      }
      var currentLanguage: String? = null
      for ((offset, segment) in queue.withIndex()) {
        val index = from + offset
        // The voice is captured per request, so switching between queued
        // utterances applies to the right sentences.
        if (segment.language != currentLanguage) {
          if (!applyLanguage(segment.language, voiceName)) {
            tts.stop()
            listener = null
            onError(ReadingReason.VOICE_MISSING)
            return@whenReady
          }
          currentLanguage = segment.language
        }
        val mode = if (offset == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD
        if (tts.speak(segment.text, mode, Bundle(), ids[index]) != TextToSpeech.SUCCESS) {
          tts.stop()
          listener = null
          onError(ReadingReason.SPEECH_FAILED)
          return@whenReady
        }
        // A short, natural pause between paragraphs (not after the last one).
        // Its id is not in `ids`, so its callbacks are ignored.
        if (segment.paragraphEnd && index < segments.size - 1) {
          tts.playSilentUtterance(PARAGRAPH_PAUSE_MS, TextToSpeech.QUEUE_ADD, "p$token-$index")
        }
      }
    }
  }

  fun stop() {
    session++
    endShared()
    cancelCurrent()
    if (isReady) tts.stop()
  }

  /** Stops shared playback and any rendering in flight. */
  private fun endShared() {
    shared?.cancel()
    shared = null
    synthCallbacks.values.toList().forEach { it(false) }
    synthCallbacks.clear()
  }

  /** The installed voice with this exact name, or null (never a substitute). */
  fun voiceNamed(name: String): Voice? = voices().firstOrNull { it.name == name }

  fun isInstalled(voice: Voice): Boolean = installed(voice)

  fun shutdown() {
    stop()
    tts.shutdown()
  }

  /** Engine, language and voice capabilities as JSON for the settings screen. */
  fun describe(): JSONObject {
    val languages = JSONObject()
    for (language in listOf("en", "hi", "gu")) {
      languages.put(
        language,
        when (languageStatus(language)) {
          TextToSpeech.LANG_AVAILABLE,
          TextToSpeech.LANG_COUNTRY_AVAILABLE,
          TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE -> "available"
          TextToSpeech.LANG_MISSING_DATA -> "missing_data"
          else -> "not_supported"
        },
      )
    }
    val voices = JSONArray()
    voices()
      .filter { it.locale.language in setOf("en", "hi", "gu") }
      .sortedWith(compareBy({ it.locale.language }, { it.locale.country }, { it.name }))
      .forEach { v ->
        voices.put(
          JSONObject()
            .put("name", v.name)
            .put("language", v.locale.language)
            .put("locale", v.locale.toLanguageTag())
            .put("networkRequired", v.isNetworkConnectionRequired)
            .put("installed", installed(v))
            .put("quality", v.quality),
        )
      }
    val engines = JSONArray()
    installedEngines().forEach { engines.put(JSONObject().put("name", it.name).put("label", it.label)) }
    return JSONObject()
      .put("ready", isReady)
      .put("activeEngine", if (enginePackage.isNotEmpty()) enginePackage else defaultEngine())
      .put("defaultEngine", defaultEngine())
      .put("googleInstalled", installedEngines().any { it.name == GOOGLE_TTS })
      .put("engines", engines)
      .put("languages", languages)
      .put("voices", voices)
  }

  companion object {
    private const val TAG = "ScreenOcrTts"
    const val GOOGLE_TTS = "com.google.android.tts"
    private const val PARAGRAPH_PAUSE_MS = 350L

    /** Installed TTS engine services (needs the TTS_SERVICE `<queries>` entry). */
    fun isGoogleInstalled(context: Context): Boolean =
      context.packageManager
        .queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0)
        .any { it.serviceInfo?.packageName == GOOGLE_TTS }
  }
}
