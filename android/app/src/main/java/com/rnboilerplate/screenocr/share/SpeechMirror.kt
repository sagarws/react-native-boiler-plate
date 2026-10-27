package com.rnboilerplate.screenocr.share

import android.content.Context
import com.rnboilerplate.screenocr.SpeechPlayer
import com.rnboilerplate.screenocr.SpeechSegment
import java.io.File

/**
 * Renders the segments being spoken to PCM with a second TTS client
 * ([SpeechPlayer.synthesize]), so the phone's own playback is untouched. A
 * segment's audio is handed to [send] when the phone starts speaking it, which
 * keeps the receiver in step with the phone. Renders at most [LOOKAHEAD]
 * segments ahead to bound memory. Main thread only.
 */
class SpeechMirror(
  private val context: Context,
  val preferGoogle: Boolean,
  private val send: (PcmClip) -> Unit,
) {
  private val player = SpeechPlayer(context, preferGoogle)
  private var generation = 0
  private var segments: List<SpeechSegment> = emptyList()
  private var voiceName = ""
  private var rate = 1f
  private var pitch = 1f
  private val clips = HashMap<Int, PcmClip>()
  private var next = 0
  private var current = 0
  private var rendering = false
  private var wanted: Int? = null

  fun begin(segments: List<SpeechSegment>, from: Int, voiceName: String, rate: Float, pitch: Float) {
    cancel()
    this.segments = segments
    this.voiceName = voiceName
    this.rate = rate
    this.pitch = pitch
    next = from
    current = from
    renderNext()
  }

  /** The phone began speaking segment [index]. */
  fun started(index: Int) {
    current = index
    clips.keys.removeAll { it < index }
    val clip = clips.remove(index)
    if (clip != null) send(clip) else wanted = index
    renderNext()
  }

  fun cancel() {
    generation++
    clips.clear()
    wanted = null
    rendering = false
    player.stop()
  }

  fun shutdown() {
    cancel()
    player.shutdown()
  }

  private fun renderNext() {
    if (rendering || next >= segments.size || next > current + LOOKAHEAD) return
    val index = next++
    val g = generation
    val file = File(context.cacheDir, "share-mirror-$index.wav")
    rendering = true
    val segment = segments[index]
    player.synthesize(segment.text, segment.language, voiceName, rate, pitch, file) { ok ->
      if (g != generation) {
        file.delete()
        return@synthesize
      }
      rendering = false
      val clip = if (ok && file.exists()) PcmClip.fromWav(file.readBytes()) else null
      file.delete()
      if (clip != null) {
        if (wanted == index) {
          wanted = null
          send(clip)
        } else if (index >= current) {
          clips[index] = clip
        }
      }
      renderNext()
    }
  }

  private companion object {
    const val LOOKAHEAD = 3
  }
}
