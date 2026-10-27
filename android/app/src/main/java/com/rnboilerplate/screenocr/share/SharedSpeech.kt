package com.rnboilerplate.screenocr.share

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import com.rnboilerplate.screenocr.SpeechSegment
import java.io.File

/**
 * Speech while a Chrome receiver is listening: each segment is rendered once
 * to PCM ([render], i.e. TextToSpeech.synthesizeToFile — faster than real
 * time), then played on the phone with an [AudioTrack] **and** sent to the
 * receiver, so both hear the same audio in step.
 *
 * (Rendering a second copy while the engine speaks doesn't work: the TTS
 * service handles one request at a time and a speaking request holds it for
 * the whole utterance.)
 *
 * Renders at most [LOOKAHEAD] segments ahead to bound memory. [cancel] stops
 * playback at once. Callbacks arrive on the main thread; [render] is called
 * on the main thread.
 */
class SharedSpeech(
  private val cacheDir: File,
  private val segments: List<SpeechSegment>,
  private val from: Int,
  private val attributes: AudioAttributes,
  private val paragraphPauseMs: Long,
  private val render: (segment: SpeechSegment, file: File, onDone: (Boolean) -> Unit) -> Unit,
  private val onStart: (Int) -> Unit,
  private val onDone: () -> Unit,
  private val onFailed: () -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private val lock = Object()
  private val ready = HashMap<Int, PcmClip>()
  @Volatile private var cancelled = false
  @Volatile private var playing = from
  private var nextRender = from
  private var rendering = false
  private var worker: Thread? = null

  fun start() {
    renderNext()
    worker = Thread({ play() }, "shared-speech").also { it.start() }
  }

  fun cancel() {
    cancelled = true
    synchronized(lock) { lock.notifyAll() }
    worker?.interrupt()
    AudioShareHub.flush()
  }

  // ── Rendering (main thread) ───────────────────────────────────────────

  private fun renderNext() {
    if (cancelled || rendering || nextRender >= segments.size || nextRender > playing + LOOKAHEAD) return
    val index = nextRender++
    rendering = true
    val file = File(cacheDir, "shared-speech-$index.wav")
    render(segments[index], file) { ok ->
      rendering = false
      val clip = if (ok && !cancelled && file.exists()) PcmClip.fromWav(file.readBytes()) else null
      file.delete()
      if (cancelled) return@render
      if (clip == null) {
        fail()
        return@render
      }
      synchronized(lock) {
        ready[index] = clip
        lock.notifyAll()
      }
      renderNext()
    }
  }

  private fun fail() {
    if (cancelled) return
    cancelled = true
    synchronized(lock) { lock.notifyAll() }
    onFailed()
  }

  // ── Playback (worker thread) ──────────────────────────────────────────

  private fun play() {
    var track: AudioTrack? = null
    var written = 0L
    try {
      for (index in from until segments.size) {
        val clip =
          synchronized(lock) {
            while (!cancelled && ready[index] == null) lock.wait()
            ready.remove(index)
          } ?: return
        if (cancelled) return
        playing = index
        main.post {
          if (!cancelled) {
            renderNext()
            onStart(index)
          }
        }
        val current = track
        if (current == null || current.sampleRate != clip.sampleRate || current.channelCount != clip.channels) {
          current?.release()
          track = newTrack(clip).also { it.play() }
          written = 0
        }
        val t = track ?: return
        AudioShareHub.sendClip(clip)
        written += write(t, clip.data) / (2 * clip.channels)
        if (segments[index].paragraphEnd && index < segments.size - 1) {
          val silence = ByteArray((clip.bytesPerSecond * paragraphPauseMs / 1000).toInt() and 0x7ffffffe)
          written += write(t, silence) / (2 * clip.channels)
        }
      }
      // Let the last audio play out before reporting completion.
      val t = track ?: return
      while (!cancelled && t.playbackHeadPosition.toLong() and 0xffffffffL < written) Thread.sleep(15)
      if (!cancelled) main.post { if (!cancelled) onDone() }
    } catch (_: InterruptedException) {
      // Cancelled.
    } catch (_: Exception) {
      main.post { fail() }
    } finally {
      track?.let {
        try {
          it.pause()
          it.flush()
        } catch (_: IllegalStateException) {
        }
        it.release()
      }
    }
  }

  /** Blocking write (paces to real time); bytes written, fewer when cancelled. */
  private fun write(track: AudioTrack, data: ByteArray): Int {
    var offset = 0
    while (offset < data.size && !cancelled) {
      val n = track.write(data, offset, minOf(CHUNK_BYTES, data.size - offset))
      if (n <= 0) throw IllegalStateException("AudioTrack write failed: $n")
      offset += n
    }
    return offset
  }

  private fun newTrack(clip: PcmClip): AudioTrack {
    val channelMask = if (clip.channels == 2) AudioFormat.CHANNEL_OUT_STEREO else AudioFormat.CHANNEL_OUT_MONO
    val minBuffer = AudioTrack.getMinBufferSize(clip.sampleRate, channelMask, AudioFormat.ENCODING_PCM_16BIT)
    return AudioTrack.Builder()
      .setAudioAttributes(attributes)
      .setAudioFormat(
        AudioFormat.Builder()
          .setSampleRate(clip.sampleRate)
          .setChannelMask(channelMask)
          .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
          .build(),
      )
      .setBufferSizeInBytes(maxOf(minBuffer, clip.bytesPerSecond / 5))
      .setTransferMode(AudioTrack.MODE_STREAM)
      .build()
  }

  private companion object {
    const val LOOKAHEAD = 3
    const val CHUNK_BYTES = 4096
  }
}
