package com.rnboilerplate.recorder

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The recording session's explicit state machine. Every change goes through
 * [RecordingStateMachine.move], which refuses transitions that could corrupt a
 * session (a second start, stop during finalization, merge while writing).
 */
enum class RecordingState(val id: String) {
  IDLE("idle"),
  REQUESTING_PERMISSION("requesting_permission"),
  PREPARING("preparing"),
  RECORDING("recording"),
  PAUSED("paused"),
  FINALIZING_SEGMENT("finalizing_segment"),
  STARTING_NEXT_SEGMENT("starting_next_segment"),
  STOPPING("stopping"),
  MERGING("merging"),
  VERIFYING_OUTPUT("verifying_output"),
  COMPLETED("completed"),
  INTERRUPTED("interrupted"),
  FAILED("failed");

  /** A session is open: encoders or a merge may be holding files. */
  val busy: Boolean
    get() = this !in setOf(IDLE, COMPLETED, INTERRUPTED, FAILED)

  /** Media is being captured (Stop is meaningful). */
  val capturing: Boolean
    get() = this in setOf(RECORDING, PAUSED, FINALIZING_SEGMENT, STARTING_NEXT_SEGMENT)
}

class RecordingStateMachine(initial: RecordingState = RecordingState.IDLE) {
  var state: RecordingState = initial
    private set

  /** Moves to [next] if allowed; returns false (state unchanged) otherwise. */
  fun move(next: RecordingState): Boolean {
    if (!allowed(state, next)) return false
    state = next
    return true
  }

  fun canStart(): Boolean = !state.busy

  companion object {
    private val transitions: Map<RecordingState, Set<RecordingState>> =
      run {
        mapOf(
          RecordingState.IDLE to setOf(RecordingState.REQUESTING_PERMISSION, RecordingState.PREPARING, RecordingState.MERGING),
          RecordingState.COMPLETED to setOf(RecordingState.REQUESTING_PERMISSION, RecordingState.PREPARING, RecordingState.IDLE, RecordingState.MERGING),
          RecordingState.INTERRUPTED to setOf(RecordingState.REQUESTING_PERMISSION, RecordingState.PREPARING, RecordingState.IDLE, RecordingState.MERGING),
          RecordingState.FAILED to setOf(RecordingState.REQUESTING_PERMISSION, RecordingState.PREPARING, RecordingState.IDLE, RecordingState.MERGING),
          RecordingState.REQUESTING_PERMISSION to setOf(RecordingState.PREPARING, RecordingState.IDLE, RecordingState.FAILED),
          RecordingState.PREPARING to setOf(RecordingState.RECORDING, RecordingState.FAILED, RecordingState.IDLE),
          RecordingState.RECORDING to setOf(
            RecordingState.PAUSED,
            RecordingState.FINALIZING_SEGMENT,
            RecordingState.STOPPING,
            RecordingState.INTERRUPTED,
            RecordingState.FAILED,
          ),
          RecordingState.PAUSED to setOf(RecordingState.RECORDING, RecordingState.STOPPING, RecordingState.INTERRUPTED, RecordingState.FAILED),
          RecordingState.FINALIZING_SEGMENT to setOf(RecordingState.STARTING_NEXT_SEGMENT, RecordingState.INTERRUPTED, RecordingState.FAILED),
          RecordingState.STARTING_NEXT_SEGMENT to setOf(RecordingState.RECORDING, RecordingState.INTERRUPTED, RecordingState.FAILED),
          RecordingState.STOPPING to setOf(RecordingState.MERGING, RecordingState.COMPLETED, RecordingState.INTERRUPTED, RecordingState.FAILED),
          RecordingState.MERGING to setOf(RecordingState.VERIFYING_OUTPUT, RecordingState.FAILED, RecordingState.INTERRUPTED),
          RecordingState.VERIFYING_OUTPUT to setOf(RecordingState.COMPLETED, RecordingState.FAILED),
        )
      }

    fun allowed(from: RecordingState, to: RecordingState): Boolean = transitions[from]?.contains(to) == true
  }
}

/**
 * Predictable, collision-free names from the device-local time, e.g.
 * Screenshot_2026-10-30_10-30-15.png, Session_20261030_103015_Segment_001.mp4.
 */
object RecordingNames {
  private fun stamp(at: Date, pattern: String) = SimpleDateFormat(pattern, Locale.US).format(at)

  fun screenshot(at: Date) = "Screenshot_${stamp(at, "yyyy-MM-dd_HH-mm-ss")}.png"

  fun editedScreenshot(at: Date) = "Screenshot_${stamp(at, "yyyy-MM-dd_HH-mm-ss")}_Edited.png"

  fun screen(at: Date, merged: Boolean) =
    "ScreenRecording_${stamp(at, "yyyy-MM-dd_HH-mm-ss")}${if (merged) "_Final" else ""}.mp4"

  fun voice(at: Date, merged: Boolean) =
    "VoiceRecording_${stamp(at, "yyyy-MM-dd_HH-mm-ss")}${if (merged) "_Final" else ""}.m4a"

  fun sessionId(at: Date) = "Session_${stamp(at, "yyyyMMdd_HHmmss")}"

  fun segment(sessionId: String, index: Int, audioOnly: Boolean) =
    "${sessionId}_Segment_${(index + 1).toString().padStart(3, '0')}.${if (audioOnly) "m4a" else "mp4"}"

  /** "name.ext" → "name (2).ext" … until [taken] says no. */
  fun unique(name: String, taken: (String) -> Boolean): String {
    if (!taken(name)) return name
    val dot = name.lastIndexOf('.')
    val base = if (dot > 0) name.substring(0, dot) else name
    val ext = if (dot > 0) name.substring(dot) else ""
    var i = 2
    while (taken("$base ($i)$ext")) i++
    return "$base ($i)$ext"
  }

  /** User-supplied rename: strips path separators and control characters, keeps the extension. */
  fun sanitizeRename(input: String, extension: String): String? {
    // No separators or reserved characters, and no leading dots (hidden files).
    val cleaned = input.replace(Regex("[\\\\/:*?\"<>|\\p{Cntrl}]"), "").trim().trimStart('.').trim().take(120)
    if (cleaned.isEmpty()) return null
    val ext = if (extension.isEmpty()) "" else ".$extension"
    return if (ext.isNotEmpty() && cleaned.endsWith(ext, ignoreCase = true)) cleaned else "$cleaned$ext"
  }
}
