package com.rnboilerplate.screenocr

enum class TranslateState {
  IDLE,
  CAPTURING,
  RUNNING_OCR,
  TRANSLATING,
  SPEAKING,
  PAUSED,
  COMPLETE,
  STOPPED,
  ERROR;

  val isActive: Boolean
    get() = this != IDLE && this != COMPLETE && this != STOPPED && this != ERROR
}

enum class TranslateIssue {
  NONE,
  NO_TEXT,
  CAPTURE_FAILED,
  TRANSLATE_FAILED,
  SPEECH_FAILED,
  VOICE_MISSING,
}

data class TranslateInfo(
  val issue: TranslateIssue = TranslateIssue.NONE,
  val error: TranslateError? = null,
  val detectedLanguage: String = "",
)

/** Android side of a translate-and-speak session. One thread. */
interface TranslatePorts {
  fun capture(onOcr: () -> Unit, onResult: (Result<String>) -> Unit)

  /** Translates; must report exactly once unless [cancelTranslation] was called first. */
  fun translate(text: String, onResult: (Result<TranslationResult>) -> Unit)

  fun cancelTranslation()

  fun speak(
    text: String,
    fromSegment: Int,
    onProgress: (segment: Int, count: Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
  )

  fun stopSpeech()

  fun onStateChanged(state: TranslateState, info: TranslateInfo)
}

/**
 * Speak with Translation:
 * ```
 * IDLE → CAPTURING → RUNNING_OCR → TRANSLATING → SPEAKING → COMPLETE
 * any active state → PAUSED (speaking) / STOPPED / ERROR
 * ```
 * Speech starts only after the translation has arrived; Stop cancels the
 * in-flight request, and a generation counter discards any late result so
 * nothing is spoken after Stop.
 */
class TranslateSession(private val ports: TranslatePorts) {
  var state: TranslateState = TranslateState.IDLE
    private set

  var originalText: String = ""
    private set

  var translatedText: String = ""
    private set

  var detectedLanguage: String = ""
    private set

  private var generation = 0
  private var segment = 0
  private var pauseRequested = false

  private fun move(next: TranslateState, issue: TranslateIssue = TranslateIssue.NONE, error: TranslateError? = null) {
    state = next
    ports.onStateChanged(next, TranslateInfo(issue, error, detectedLanguage))
  }

  fun start() {
    if (state != TranslateState.IDLE) return
    val gen = ++generation
    move(TranslateState.CAPTURING)
    ports.capture(
      onOcr = { if (gen == generation) move(TranslateState.RUNNING_OCR) },
      onResult = { result -> if (gen == generation) onCaptured(gen, result) },
    )
  }

  private fun onCaptured(gen: Int, result: Result<String>) {
    val text =
      result.getOrElse {
        move(TranslateState.ERROR, TranslateIssue.CAPTURE_FAILED)
        return
      }
    if (text.isBlank()) {
      move(TranslateState.COMPLETE, TranslateIssue.NO_TEXT)
      return
    }
    originalText = text
    move(TranslateState.TRANSLATING)
    ports.translate(text) { translated -> if (gen == generation) onTranslated(translated) }
  }

  private fun onTranslated(result: Result<TranslationResult>) {
    val translation =
      result.getOrElse { error ->
        move(TranslateState.ERROR, TranslateIssue.TRANSLATE_FAILED, (error as? TranslateException)?.error ?: TranslateError.SERVER)
        return
      }
    translatedText = translation.text
    detectedLanguage = translation.detectedLanguage
    if (pauseRequested) {
      pauseRequested = false
      segment = 0
      ++generation
      move(TranslateState.PAUSED)
      return
    }
    speakFrom(0)
  }

  private fun speakFrom(from: Int) {
    val gen = ++generation
    segment = from
    move(TranslateState.SPEAKING)
    ports.speak(
      translatedText,
      from,
      onProgress = { index, _ -> if (gen == generation) segment = index },
      onDone = { if (gen == generation) move(TranslateState.COMPLETE) },
      onError = { reason ->
        if (gen == generation) {
          move(
            TranslateState.ERROR,
            if (reason == ReadingReason.VOICE_MISSING) TranslateIssue.VOICE_MISSING else TranslateIssue.SPEECH_FAILED,
          )
        }
      },
    )
  }

  fun pause() {
    when (state) {
      TranslateState.SPEAKING -> {
        ++generation
        ports.stopSpeech()
        move(TranslateState.PAUSED)
      }
      TranslateState.CAPTURING, TranslateState.RUNNING_OCR, TranslateState.TRANSLATING -> pauseRequested = true
      else -> Unit
    }
  }

  fun resume() {
    if (state != TranslateState.PAUSED) return
    speakFrom(segment)
  }

  fun togglePause() {
    if (state == TranslateState.PAUSED) resume() else pause()
  }

  fun restart() {
    if (translatedText.isBlank()) return
    if (state != TranslateState.SPEAKING && state != TranslateState.PAUSED && state != TranslateState.COMPLETE) return
    ports.stopSpeech()
    speakFrom(0)
  }

  fun stop() {
    if (!state.isActive) return
    ++generation
    pauseRequested = false
    ports.cancelTranslation()
    ports.stopSpeech()
    move(TranslateState.STOPPED)
  }
}
