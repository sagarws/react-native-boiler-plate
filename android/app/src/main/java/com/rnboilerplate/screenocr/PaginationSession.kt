package com.rnboilerplate.screenocr

enum class PaginationState {
  IDLE,
  CAPTURING_SCREEN,
  RUNNING_OCR,
  SPEAKING_PAGE,
  PAUSED,
  CLICKING_NEXT_PAGE,
  WAITING_FOR_PAGE_CHANGE,
  VERIFYING_PAGE_CHANGE,
  /** Stopped advancing; the user chooses Retry once / Recalibrate / Stop (or Skip for an empty page). */
  NEEDS_ATTENTION,
  STOPPED,
  COMPLETED,
  ERROR;

  val isActive: Boolean
    get() = this != IDLE && this != STOPPED && this != COMPLETED && this != ERROR
}

enum class PaginationIssue {
  NONE,
  NO_TARGET,
  TARGET_INVALID,
  TARGET_NOT_FOUND,
  APP_CHANGED,
  NO_PERMISSION,
  CLICK_FAILED,
  PAGE_NOT_CHANGED,
  EMPTY_PAGE,
  CAPTURE_FAILED,
  OCR_FAILED,
  SPEECH_FAILED,
  VOICE_MISSING,
  PAGE_LIMIT,
  LAST_PAGE,
  TRANSLATE_FAILED,
}

enum class ClickOutcome {
  /** Clicked through the node's own accessibility action. */
  NODE,

  /** Tapped with an accessibility gesture at the calibrated point. */
  GESTURE,
  NO_PERMISSION,
  TARGET_INVALID,
  TARGET_NOT_FOUND,
  APP_CHANGED,
  FAILED;

  val clicked: Boolean
    get() = this == NODE || this == GESTURE
}

data class PaginationConfig(
  /** Wait after the click before the first verification capture. */
  val pageLoadDelayMs: Long = 1200,
  /** Give up waiting for a new page after this long (verification only — never re-clicks). */
  val verifyTimeoutMs: Long = 6000,
  /** Gap between verification captures. */
  val verifyIntervalMs: Long = 1500,
  val maxPages: Int = 50,
)

data class PaginationInfo(
  val page: Int,
  val issue: PaginationIssue = PaginationIssue.NONE,
  /** Retry once is still available for the current attention prompt. */
  val canRetry: Boolean = false,
)

/** Android side of the session (capture+OCR, speech, click, timers, UI). One thread. */
interface PaginationPorts {
  fun capture(onOcr: () -> Unit, onResult: (Result<PageSnapshot>) -> Unit)

  fun speak(
    text: String,
    fromSegment: Int,
    onProgress: (segment: Int, count: Int) -> Unit,
    onDone: () -> Unit,
    onError: (ReadingReason) -> Unit,
  )

  fun stopSpeech()

  fun clickNext(onResult: (ClickOutcome) -> Unit)

  fun schedule(delayMs: Long, block: () -> Unit)

  fun onStateChanged(state: PaginationState, info: PaginationInfo)
}

/**
 * Speak-with-pagination: read the page, click the pinned Next button once,
 * verify the page turned, read the new page, repeat.
 *
 * ```
 * IDLE → CAPTURING_SCREEN → RUNNING_OCR → SPEAKING_PAGE ──(speech done)──► CLICKING_NEXT_PAGE
 *          ▲                                                            │ one click
 *          │                                    WAITING_FOR_PAGE_CHANGE ◄┘
 *          │                                            │ delay
 *          └── new page (already captured) ◄── VERIFYING_PAGE_CHANGE ──(timeout)──► NEEDS_ATTENTION
 * ```
 *
 * Guarantees:
 * - Next is clicked only after the speech queue for the page has finished
 *   (or the user skipped), and **once** per page; verification re-captures
 *   until [PaginationConfig.verifyTimeoutMs] but never re-clicks. The only
 *   further click is an explicit Retry once (one per prompt).
 * - The page verified as new is the capture that gets spoken; the same page
 *   is never read twice, and a page that matches one already read (viewer
 *   wrapped round, end of document) ends the session.
 * - Stop, pause and skip bump a generation counter, so a late speech, click
 *   or timer callback can never trigger a click afterwards.
 */
class PaginationSession(private val config: PaginationConfig, private val ports: PaginationPorts) {
  var state: PaginationState = PaginationState.IDLE
    private set

  /** Text of the page being spoken. */
  var currentText: String = ""
    private set

  var page = 0
    private set

  private var generation = 0
  private var current: PageSnapshot? = null
  private val seen = ArrayList<PageSnapshot>()
  private var segment = 0
  private var issue = PaginationIssue.NONE
  private var retryAvailable = false
  private var elapsed = 0L
  private var pauseRequested = false
  private var clicks = 0

  /** Total clicks dispatched this session (for tests and diagnostics). */
  val clickCount: Int
    get() = clicks

  fun start() {
    if (state != PaginationState.IDLE) return
    val gen = ++generation
    move(PaginationState.CAPTURING_SCREEN)
    ports.capture(
      onOcr = { if (gen == generation) move(PaginationState.RUNNING_OCR) },
      onResult = { result -> if (gen == generation) onFirstPage(result) },
    )
  }

  private fun info() = PaginationInfo(page, issue, state == PaginationState.NEEDS_ATTENTION && retryAvailable)

  private fun move(next: PaginationState, why: PaginationIssue = PaginationIssue.NONE) {
    state = next
    issue = why
    ports.onStateChanged(next, info())
  }

  private fun onFirstPage(result: Result<PageSnapshot>) {
    val snapshot =
      result.getOrElse {
        move(PaginationState.ERROR, PaginationIssue.CAPTURE_FAILED)
        return
      }
    if (snapshot.text.isBlank()) {
      move(PaginationState.ERROR, PaginationIssue.EMPTY_PAGE)
      return
    }
    beginPage(snapshot, previousText = null)
  }

  private fun beginPage(snapshot: PageSnapshot, previousText: String?) {
    current = snapshot
    seen += snapshot
    if (seen.size > RECENT_PAGES) seen.removeAt(0)
    page++
    currentText = PageText.stripChrome(snapshot.text, previousText).ifBlank { snapshot.text }
    if (pauseRequested) {
      pauseRequested = false
      segment = 0
      ++generation
      move(PaginationState.PAUSED)
      return
    }
    speakFrom(0)
  }

  private fun speakFrom(from: Int) {
    val gen = ++generation
    segment = from
    move(PaginationState.SPEAKING_PAGE)
    ports.speak(
      currentText,
      from,
      onProgress = { index, _ -> if (gen == generation) segment = index },
      onDone = { if (gen == generation) onPageSpoken() },
      onError = { reason ->
        if (gen == generation) {
          move(
            PaginationState.ERROR,
            when (reason) {
              ReadingReason.VOICE_MISSING -> PaginationIssue.VOICE_MISSING
              ReadingReason.TRANSLATE_FAILED -> PaginationIssue.TRANSLATE_FAILED
              else -> PaginationIssue.SPEECH_FAILED
            },
          )
        }
      },
    )
  }

  private fun onPageSpoken() {
    if (page >= config.maxPages) {
      move(PaginationState.COMPLETED, PaginationIssue.PAGE_LIMIT)
      return
    }
    clickNextOnce(allowRetryAfter = true)
  }

  private fun clickNextOnce(allowRetryAfter: Boolean) {
    val gen = ++generation
    move(PaginationState.CLICKING_NEXT_PAGE)
    clicks++
    ports.clickNext { outcome ->
      if (gen != generation) return@clickNext
      if (!outcome.clicked) {
        retryAvailable = false
        move(
          PaginationState.NEEDS_ATTENTION,
          when (outcome) {
            ClickOutcome.NO_PERMISSION -> PaginationIssue.NO_PERMISSION
            ClickOutcome.TARGET_INVALID -> PaginationIssue.TARGET_INVALID
            ClickOutcome.TARGET_NOT_FOUND -> PaginationIssue.TARGET_NOT_FOUND
            ClickOutcome.APP_CHANGED -> PaginationIssue.APP_CHANGED
            else -> PaginationIssue.CLICK_FAILED
          },
        )
        return@clickNext
      }
      retryAvailable = allowRetryAfter
      elapsed = 0
      move(PaginationState.WAITING_FOR_PAGE_CHANGE)
      ports.schedule(config.pageLoadDelayMs) {
        if (gen == generation) {
          elapsed = config.pageLoadDelayMs
          verify(gen)
        }
      }
    }
  }

  private fun verify(gen: Int) {
    move(PaginationState.VERIFYING_PAGE_CHANGE)
    ports.capture(
      onOcr = {},
      onResult = { result -> if (gen == generation) onVerified(gen, result) },
    )
  }

  private fun onVerified(gen: Int, result: Result<PageSnapshot>) {
    val snapshot =
      result.getOrElse {
        move(PaginationState.ERROR, PaginationIssue.CAPTURE_FAILED)
        return
      }
    val previous = current
    if (previous != null && !PageChangeDetector.isNewPage(previous, snapshot)) {
      // Not turned yet: look again until the timeout, never click again.
      if (elapsed + config.verifyIntervalMs <= config.verifyTimeoutMs) {
        elapsed += config.verifyIntervalMs
        move(PaginationState.WAITING_FOR_PAGE_CHANGE)
        ports.schedule(config.verifyIntervalMs) { if (gen == generation) verify(gen) }
      } else {
        move(PaginationState.NEEDS_ATTENTION, PaginationIssue.PAGE_NOT_CHANGED)
      }
      return
    }
    if (PageChangeDetector.isRepeatOf(snapshot, seen)) {
      move(PaginationState.COMPLETED, PaginationIssue.LAST_PAGE)
      return
    }
    if (snapshot.text.isBlank()) {
      // A turned but unreadable page: the user decides whether to skip it.
      current = snapshot
      retryAvailable = false
      move(PaginationState.NEEDS_ATTENTION, PaginationIssue.EMPTY_PAGE)
      return
    }
    beginPage(snapshot, previousText = previous?.text)
  }

  /** Pauses speech, or holds before the next page is read if a turn is in progress. */
  fun pause() {
    when (state) {
      PaginationState.SPEAKING_PAGE -> {
        ++generation
        ports.stopSpeech()
        move(PaginationState.PAUSED)
      }
      PaginationState.CAPTURING_SCREEN,
      PaginationState.RUNNING_OCR,
      PaginationState.CLICKING_NEXT_PAGE,
      PaginationState.WAITING_FOR_PAGE_CHANGE,
      PaginationState.VERIFYING_PAGE_CHANGE -> pauseRequested = true
      else -> Unit
    }
  }

  fun resume() {
    if (state != PaginationState.PAUSED) return
    speakFrom(segment)
  }

  fun togglePause() {
    if (state == PaginationState.PAUSED) resume() else pause()
  }

  /** Reads the current page again from the start. */
  fun restartPage() {
    if (currentText.isBlank()) return
    if (state != PaginationState.SPEAKING_PAGE && state != PaginationState.PAUSED) return
    ports.stopSpeech()
    speakFrom(0)
  }

  /**
   * Speaking/paused: skip the rest of the page and turn now.
   * Needs attention: Retry once (page didn't change) or Skip (empty page).
   */
  fun next() {
    when (state) {
      PaginationState.SPEAKING_PAGE, PaginationState.PAUSED -> {
        ++generation
        ports.stopSpeech()
        onPageSpoken()
      }
      PaginationState.NEEDS_ATTENTION ->
        when {
          issue == PaginationIssue.EMPTY_PAGE -> clickNextOnce(allowRetryAfter = true)
          retryAvailable -> clickNextOnce(allowRetryAfter = false)
          else -> Unit
        }
      else -> Unit
    }
  }

  fun stop() {
    if (!state.isActive) return
    ++generation
    pauseRequested = false
    ports.stopSpeech()
    move(PaginationState.STOPPED)
  }

  private companion object {
    const val RECENT_PAGES = 5
  }
}
