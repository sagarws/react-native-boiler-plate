package com.rnboilerplate.screenocr

/** Reading-pipeline states. */
enum class ReadingState {
  IDLE,
  CAPTURING,
  OCR_PROCESSING,
  SPEAKING,
  PAUSED,
  SCROLLING,
  WAITING_FOR_SCROLL,
  COMPLETE,
  STOPPED,
  ERROR;

  val isActive: Boolean
    get() = this != IDLE && this != COMPLETE && this != STOPPED && this != ERROR
}

/** Why a session ended or failed — drives the message the user sees. */
enum class ReadingReason {
  NONE,
  NO_TEXT,
  END_OF_PAGE,
  SECTION_LIMIT,
  CAPTURE_FAILED,
  OCR_FAILED,
  SPEECH_FAILED,
  VOICE_MISSING,
}

data class ReadingInfo(
  val section: Int,
  val segment: Int,
  val segmentCount: Int,
  val reason: ReadingReason = ReadingReason.NONE,
  /** True while waiting for the user to scroll (no accessibility scrolling). */
  val manual: Boolean = false,
)

/**
 * Everything the session needs from Android, behind an interface so the state
 * machine is a plain class covered by JVM tests. All calls and callbacks
 * happen on one thread (the main thread in the service).
 */
interface ReadingPorts {
  /** Captures the screen (hiding the overlay) and returns OCR text, or an error. */
  fun captureText(onOcr: () -> Unit, onResult: (Result<String>) -> Unit)

  /**
   * Speaks [text] from segment [fromSegment]. [onProgress] reports the segment
   * being spoken; [onDone] fires once the whole queue has finished.
   */
  fun speak(
    text: String,
    fromSegment: Int,
    onProgress: (segment: Int, count: Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
  )

  fun stopSpeech()

  /** Whether programmatic scrolling is currently available. */
  fun canScroll(): Boolean

  fun scroll(onResult: (scrolled: Boolean) -> Unit)

  fun schedule(delayMs: Long, block: () -> Unit)

  fun onStateChanged(state: ReadingState, info: ReadingInfo)
}

/**
 * A sequential read-aloud session over one or more screens.
 *
 * ```
 * IDLE → CAPTURING → OCR_PROCESSING → SPEAKING ─┬─► COMPLETE (speak-only mode)
 *                ▲                              └─► SCROLLING ─► CAPTURING …
 *                └──────── WAITING_FOR_SCROLL ◄──── (no auto-scroll: user scrolls, taps Continue)
 * any active state ─► PAUSED / STOPPED / ERROR
 * ```
 *
 * Invariants:
 * - one operation at a time — capture, OCR, speech and scroll never overlap;
 * - the next scroll starts only after the speech queue for the current
 *   section has finished (or the user skipped it);
 * - text already on the previous screen is not spoken again ([TextDedup]);
 * - the session ends after [ReadingConfig.maxNoNewText] screens in a row with
 *   nothing new, or after [ReadingConfig.maxSections] sections, so it cannot
 *   scroll forever;
 * - every async callback carries a generation number; callbacks from before a
 *   stop, pause or skip are ignored.
 */
class ReadingSession(
  private val autoScrollMode: Boolean,
  private val config: ReadingConfig,
  private val ports: ReadingPorts,
) {
  var state: ReadingState = ReadingState.IDLE
    private set

  /** Text of the section being spoken. */
  var currentText: String = ""
    private set

  private var previousScreen: List<String> = emptyList()
  private var section = 0
  private var segment = 0
  private var segmentCount = 0
  private var noNewText = 0
  private var generation = 0

  fun start() {
    if (state != ReadingState.IDLE) return
    capture()
  }

  private fun info(reason: ReadingReason = ReadingReason.NONE) =
    ReadingInfo(section, segment, segmentCount, reason, state == ReadingState.WAITING_FOR_SCROLL)

  private fun move(next: ReadingState, reason: ReadingReason = ReadingReason.NONE) {
    state = next
    ports.onStateChanged(next, info(reason))
  }

  private fun capture() {
    val gen = ++generation
    move(ReadingState.CAPTURING)
    ports.captureText(
      onOcr = { if (gen == generation) move(ReadingState.OCR_PROCESSING) },
      onResult = { result -> if (gen == generation) onCaptured(result) },
    )
  }

  private fun onCaptured(result: Result<String>) {
    val text =
      result.getOrElse {
        move(ReadingState.ERROR, if (section == 0) ReadingReason.CAPTURE_FAILED else ReadingReason.OCR_FAILED)
        return
      }
    val lines = ParagraphText.lines(text)
    // New text only, with its paragraph breaks intact so it is read paragraph by paragraph.
    val freshText =
      if (section == 0) ParagraphText.keepLines(text) { _, _ -> true } else TextDedup.newText(text, previousScreen)
    val fresh = ParagraphText.lines(freshText)
    previousScreen = lines

    if (fresh.isEmpty()) {
      if (section == 0) {
        move(ReadingState.COMPLETE, ReadingReason.NO_TEXT)
        return
      }
      noNewText++
      if (noNewText >= config.maxNoNewText) move(ReadingState.COMPLETE, ReadingReason.END_OF_PAGE)
      else advance()
      return
    }
    noNewText = 0
    section++
    currentText = freshText
    speakFrom(0)
  }

  private fun speakFrom(fromSegment: Int) {
    val gen = ++generation
    segment = fromSegment
    move(ReadingState.SPEAKING)
    ports.speak(
      currentText,
      fromSegment,
      onProgress = { index, count ->
        if (gen == generation) {
          segment = index
          segmentCount = count
          ports.onStateChanged(state, info())
        }
      },
      onDone = { if (gen == generation) onSectionSpoken() },
      onError = { reason -> if (gen == generation) move(ReadingState.ERROR, reason) },
    )
  }

  private fun onSectionSpoken() {
    if (!autoScrollMode) {
      move(ReadingState.COMPLETE)
      return
    }
    if (section >= config.maxSections) {
      move(ReadingState.COMPLETE, ReadingReason.SECTION_LIMIT)
      return
    }
    advance()
  }

  /** Brings the next part of the page on screen: auto-scroll, or wait for the user. */
  private fun advance() {
    if (config.autoScroll && ports.canScroll()) {
      val gen = ++generation
      move(ReadingState.SCROLLING)
      ports.scroll { scrolled ->
        if (gen != generation) return@scroll
        if (scrolled) {
          // Let fling and layout settle before the next screenshot.
          ports.schedule(SCROLL_SETTLE_MS) { if (gen == generation) capture() }
        } else {
          noNewText++
          if (noNewText >= config.maxNoNewText || !config.manualFallback) {
            move(ReadingState.COMPLETE, ReadingReason.END_OF_PAGE)
          } else {
            move(ReadingState.WAITING_FOR_SCROLL)
          }
        }
      }
    } else if (config.manualFallback) {
      ++generation
      move(ReadingState.WAITING_FOR_SCROLL)
    } else {
      move(ReadingState.COMPLETE, ReadingReason.END_OF_PAGE)
    }
  }

  /** Pauses speech (Android TTS cannot pause, so speech stops and resumes from the current segment). */
  fun pause() {
    if (state != ReadingState.SPEAKING) return
    ++generation
    ports.stopSpeech()
    move(ReadingState.PAUSED)
  }

  fun resume() {
    if (state != ReadingState.PAUSED) return
    speakFrom(segment)
  }

  fun togglePause() {
    if (state == ReadingState.PAUSED) resume() else pause()
  }

  /** Reads the current section again from its first segment. */
  fun restartSection() {
    if (currentText.isEmpty()) return
    if (state != ReadingState.SPEAKING && state != ReadingState.PAUSED && state != ReadingState.COMPLETE) return
    ports.stopSpeech()
    speakFrom(0)
  }

  /**
   * Skips the rest of the current section (auto-scroll mode), or continues
   * after the user has scrolled manually.
   */
  fun next() {
    when (state) {
      ReadingState.WAITING_FOR_SCROLL -> capture()
      ReadingState.SPEAKING, ReadingState.PAUSED ->
        if (autoScrollMode) {
          ++generation
          ports.stopSpeech()
          onSectionSpoken()
        }
      else -> Unit
    }
  }

  fun stop() {
    if (!state.isActive) return
    ++generation
    ports.stopSpeech()
    move(ReadingState.STOPPED)
  }

  private companion object {
    const val SCROLL_SETTLE_MS = 900L
  }
}
