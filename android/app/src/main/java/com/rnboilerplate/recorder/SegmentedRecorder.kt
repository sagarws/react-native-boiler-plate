package com.rnboilerplate.recorder

import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.view.Surface
import java.nio.ByteBuffer

/**
 * Continuous encoders, rotating files.
 *
 * One H.264 encoder (fed by the virtual display's surface) and one AAC
 * encoder run for the whole session; only the MP4 muxer changes at each
 * segment boundary. A new segment starts on the first key frame at or after
 * the boundary (a key frame is requested there), so there is no gap and no
 * re-encode between segments: every frame and audio sample lands in exactly
 * one file. Audio produced before that key frame's time finishes the old
 * file; the old file is closed as soon as audio passes it.
 *
 * Times are "session time": µs since start, minus paused intervals. Each
 * segment's samples are rebased to start at 0 so it plays on its own; its
 * session start time is reported (and stored) so the merger can restore
 * the exact timeline. Nothing is buffered beyond a few encoder packets —
 * memory use is constant regardless of length.
 *
 * Threads: "rec-video" drains the video encoder; "rec-audio" reads PCM,
 * encodes and drains audio. Muxer state is guarded by [lock].
 */
class SegmentedRecorder(
  private val storage: OutputStorage,
  private val sessionId: String,
  private val segmentsTree: String?,
  private val segmentDurationUs: Long,
  private val video: VideoPlan?,
  private val pcm: PcmSource?,
  private val audioQuality: AudioQuality?,
  private val listener: Listener,
) {
  interface Listener {
    fun onSegmentStarted(index: Int, uri: Uri, name: String, startUs: Long)

    /** [ok] false = the file has no playable media (e.g. no samples). */
    fun onSegmentFinished(index: Int, durationUs: Long, ok: Boolean)

    fun onFailed(code: String)

    /** Both encoders reached end of stream and every file is closed. */
    fun onStopped()
  }

  private class Segment(
    val index: Int,
    val uri: Uri,
    val pfd: ParcelFileDescriptor?,
    val muxer: MediaMuxer,
    val startUs: Long,
  ) {
    var videoTrack = -1
    var audioTrack = -1
    var lastUs = 0L
    var samples = 0
  }

  private val lock = Object()
  private val audioOnly = video == null
  private var videoCodec: MediaCodec? = null
  private var audioCodec: MediaCodec? = null
  var inputSurface: Surface? = null
    private set
  private var videoFormat: MediaFormat? = null
  private var audioFormat: MediaFormat? = null
  private var current: Segment? = null
  private var previous: Segment? = null
  private var nextIndex = 0
  private var baseUs = 0L
  private val pauses = mutableListOf<LongArray>() // [startMonoUs, endMonoUs or MAX]
  @Volatile private var stopping = false
  @Volatile private var failed = false
  private var syncRequested = false
  private var videoDone = video == null
  private var audioDone = pcm == null
  private var videoThread: Thread? = null
  private var audioThread: Thread? = null
  private val pending = ArrayDeque<Triple<Boolean, ByteArray, MediaCodec.BufferInfo>>()

  /** Session-time position of the newest sample, µs. */
  @Volatile var positionUs = 0L
    private set

  val segmentIndex: Int
    get() = synchronized(lock) { current?.index ?: 0 }

  fun prepare() {
    if (video != null) {
      val codec = MediaCodec.createEncoderByType(EncoderSetup.VIDEO_MIME)
      codec.configure(EncoderSetup.videoFormat(video), null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
      inputSurface = codec.createInputSurface()
      videoCodec = codec
    }
    if (pcm != null && audioQuality != null) {
      val codec = MediaCodec.createEncoderByType(EncoderSetup.AUDIO_MIME)
      codec.configure(
        EncoderSetup.audioFormat(audioQuality.copy(sampleRate = pcm.sampleRate, channels = pcm.channels)),
        null,
        null,
        MediaCodec.CONFIGURE_FLAG_ENCODE,
      )
      audioCodec = codec
    }
  }

  fun start() {
    baseUs = System.nanoTime() / 1000
    videoCodec?.let { codec ->
      codec.start()
      videoThread = Thread({ drainVideo(codec) }, "rec-video").also { it.start() }
    }
    audioCodec?.let { codec ->
      codec.start()
      audioThread = Thread({ runAudio(codec) }, "rec-audio").also { it.start() }
    }
  }

  // ── Pause ──

  fun pause() =
    synchronized(lock) {
      if (pauses.lastOrNull()?.get(1) == Long.MAX_VALUE) return
      pauses += longArrayOf(System.nanoTime() / 1000, Long.MAX_VALUE)
    }

  fun resume() =
    synchronized(lock) {
      val open = pauses.lastOrNull() ?: return
      if (open[1] != Long.MAX_VALUE) return
      open[1] = System.nanoTime() / 1000
      requestSyncFrame()
    }

  /** Session time for a monotonic µs timestamp, or null inside a pause. */
  private fun sessionUs(monoUs: Long): Long? {
    if (monoUs < baseUs) return null
    var paused = 0L
    for (p in pauses) {
      if (monoUs >= p[1]) paused += p[1] - p[0]
      else if (monoUs >= p[0]) return null
    }
    return monoUs - baseUs - paused
  }

  // ── Stop ──

  /** Idempotent: ends both streams; [Listener.onStopped] fires once files are closed. */
  fun stop() {
    if (stopping) return
    stopping = true
    try {
      videoCodec?.signalEndOfInputStream()
    } catch (_: Exception) {
      synchronized(lock) { videoDone = true }
    }
    synchronized(lock) { maybeFinish() }
  }

  private fun requestSyncFrame() {
    try {
      videoCodec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
    } catch (_: Exception) {
    }
  }

  // ── Encoder threads ──

  private fun drainVideo(codec: MediaCodec) {
    val info = MediaCodec.BufferInfo()
    try {
      while (true) {
        val i = codec.dequeueOutputBuffer(info, 10_000)
        when {
          i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> synchronized(lock) {
            videoFormat = codec.outputFormat
            flushPendingIfReady()
          }
          i >= 0 -> {
            val buf = codec.getOutputBuffer(i)
            val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
            if (buf != null && info.size > 0 && !config) {
              val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
              synchronized(lock) { onVideoSample(buf, info, key) }
            }
            codec.releaseOutputBuffer(i, false)
            if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
          }
          stopping && failed -> break
        }
      }
    } catch (e: Exception) {
      fail("video_encoder")
    } finally {
      synchronized(lock) {
        videoDone = true
        maybeFinish()
      }
    }
  }

  private fun runAudio(codec: MediaCodec) {
    val source = pcm ?: return
    val chunk = ShortArray(source.sampleRate / 50 * source.channels) // 20 ms
    val bytes = ByteBuffer.allocate(chunk.size * 2).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    val info = MediaCodec.BufferInfo()
    var eosQueued = false
    try {
      source.start()
      while (true) {
        if (!eosQueued) {
          if (stopping) {
            val inIndex = codec.dequeueInputBuffer(10_000)
            if (inIndex >= 0) {
              codec.queueInputBuffer(inIndex, 0, 0, positionUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
              eosQueued = true
            }
          } else {
            val pts = source.read(chunk)
            if (pts < 0) throw IllegalStateException("audio read failed")
            val session = synchronized(lock) { sessionUs(pts) }
            if (session != null) {
              bytes.clear()
              bytes.asShortBuffer().put(chunk)
              val inIndex = codec.dequeueInputBuffer(10_000)
              if (inIndex >= 0) {
                val input = codec.getInputBuffer(inIndex)!!
                input.clear()
                input.put(bytes.array(), 0, chunk.size * 2)
                // Encoder sees session time directly (pauses already removed).
                codec.queueInputBuffer(inIndex, 0, chunk.size * 2, session, 0)
              }
            }
          }
        }
        // Drain whatever is ready.
        while (true) {
          val o = codec.dequeueOutputBuffer(info, 0)
          if (o == MediaCodec.INFO_TRY_AGAIN_LATER) break
          if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
            synchronized(lock) {
              audioFormat = codec.outputFormat
              flushPendingIfReady()
            }
            continue
          }
          if (o < 0) continue
          val buf = codec.getOutputBuffer(o)
          val config = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (buf != null && info.size > 0 && !config) synchronized(lock) { onAudioSample(buf, info) }
          codec.releaseOutputBuffer(o, false)
          if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
        }
        if (eosQueued) Thread.sleep(5)
      }
    } catch (_: InterruptedException) {
    } catch (e: Exception) {
      // After Stop (or a revoked capture) a failed read is expected, not an error.
      if (!stopping) fail("audio_encoder")
    } finally {
      source.release()
      synchronized(lock) {
        audioDone = true
        maybeFinish()
      }
    }
  }

  // ── Muxing (all under lock) ──

  private fun formatsReady() = (audioOnly || videoFormat != null) && (pcm == null || audioFormat != null)

  private fun flushPendingIfReady() {
    if (!formatsReady() || current != null) return
    try {
      current = openSegment(0L)
    } catch (e: Exception) {
      fail("storage")
      return
    }
    while (pending.isNotEmpty()) {
      val (isVideo, data, info) = pending.removeFirst()
      val buf = ByteBuffer.wrap(data)
      info.offset = 0
      if (isVideo) writeVideo(buf, info, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0) else writeAudio(buf, info)
    }
  }

  private fun queuePending(isVideo: Boolean, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    if (pending.size > 240) pending.removeFirst()
    val data = ByteArray(info.size)
    buf.position(info.offset)
    buf.get(data, 0, info.size)
    val copy = MediaCodec.BufferInfo().apply { set(0, info.size, info.presentationTimeUs, info.flags) }
    pending.addLast(Triple(isVideo, data, copy))
  }

  private fun onVideoSample(buf: ByteBuffer, info: MediaCodec.BufferInfo, key: Boolean) {
    // Surface frames carry monotonic µs; convert to session time.
    val session = sessionUs(info.presentationTimeUs) ?: return
    info.presentationTimeUs = session
    if (current == null) {
      if (!key && pending.none { it.first }) {
        requestSyncFrame()
        return // The first file must start on a key frame.
      }
      queuePending(true, buf, info)
      flushPendingIfReady()
      return
    }
    writeVideo(buf, info, key)
  }

  private fun onAudioSample(buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    if (current == null) {
      queuePending(false, buf, info)
      flushPendingIfReady()
      return
    }
    writeAudio(buf, info)
  }

  private fun boundaryUs(index: Int) = if (segmentDurationUs <= 0) Long.MAX_VALUE else (index + 1) * segmentDurationUs

  private fun writeVideo(buf: ByteBuffer, info: MediaCodec.BufferInfo, key: Boolean) {
    var seg = current ?: return
    val t = info.presentationTimeUs
    if (t >= boundaryUs(seg.index) && !stopping) {
      if (key) {
        rotate(t)
        seg = current ?: return
      } else if (!syncRequested) {
        syncRequested = true
        requestSyncFrame()
      }
    }
    write(seg, true, buf, info)
  }

  private fun writeAudio(buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    val t = info.presentationTimeUs
    var seg = current ?: return
    if (audioOnly && t >= boundaryUs(seg.index) && !stopping) {
      rotate(t)
      seg = current ?: return
    }
    val prev = previous
    if (prev != null) {
      if (t < seg.startUs) {
        write(prev, false, buf, info)
        return
      }
      closeSegment(prev)
      previous = null
    }
    if (t < seg.startUs) return // Older than the file it would go in (first file only).
    write(seg, false, buf, info)
  }

  private fun write(seg: Segment, isVideo: Boolean, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
    val track = if (isVideo) seg.videoTrack else seg.audioTrack
    if (track < 0) return
    val session = info.presentationTimeUs
    val local = (session - seg.startUs).coerceAtLeast(0)
    val out = MediaCodec.BufferInfo().apply { set(info.offset, info.size, local, info.flags) }
    buf.position(info.offset)
    buf.limit(info.offset + info.size)
    try {
      seg.muxer.writeSampleData(track, buf, out)
      seg.samples++
      if (local > seg.lastUs) seg.lastUs = local
      if (session > positionUs) positionUs = session
    } catch (e: Exception) {
      fail("muxer")
    }
  }

  private fun rotate(atUs: Long) {
    syncRequested = false
    val old = current ?: return
    val next =
      try {
        openSegment(atUs)
      } catch (e: Exception) {
        fail("storage")
        return
      }
    previous?.let { closeSegment(it) }
    current = next
    if (audioOnly || pcm == null) closeSegment(old) else previous = old
  }

  private fun openSegment(startUs: Long): Segment {
    val index = nextIndex++
    val name = RecordingNames.segment(sessionId, index, audioOnly)
    val output = storage.create(OutputKind.SEGMENTS, segmentsTree, name, if (audioOnly) "audio/mp4" else "video/mp4")
    val (pfd, muxer) = openMuxer(storage, output.uri)
    val seg = Segment(index, output.uri, pfd, muxer, startUs)
    videoFormat?.let { if (!audioOnly) seg.videoTrack = muxer.addTrack(it) }
    audioFormat?.let { if (pcm != null) seg.audioTrack = muxer.addTrack(it) }
    muxer.start()
    listener.onSegmentStarted(index, output.uri, output.name, startUs)
    return seg
  }

  private fun closeSegment(seg: Segment) {
    var ok = seg.samples > 0
    try {
      seg.muxer.stop()
    } catch (_: Exception) {
      ok = false
    }
    try {
      seg.muxer.release()
    } catch (_: Exception) {
    }
    try {
      seg.pfd?.close()
    } catch (_: Exception) {
    }
    if (!ok) storage.delete(seg.uri)
    listener.onSegmentFinished(seg.index, seg.lastUs + frameUs(), ok)
  }

  private fun frameUs(): Long = video?.let { 1_000_000L / it.fps } ?: 20_000L

  private fun fail(code: String) {
    if (failed) return
    failed = true
    listener.onFailed(code)
    stop()
  }

  private var finished = false

  private fun maybeFinish() {
    if (finished || !stopping || !videoDone || !audioDone) return
    finished = true
    previous?.let { closeSegment(it) }
    previous = null
    current?.let { closeSegment(it) }
    current = null
    for (codec in listOfNotNull(videoCodec, audioCodec)) {
      try {
        codec.stop()
      } catch (_: Exception) {
      }
      codec.release()
    }
    inputSurface?.release()
    listener.onStopped()
  }

  companion object {
    /** MP4 muxer over a file path or (Android 8+) any writable descriptor. */
    fun openMuxer(storage: OutputStorage, uri: Uri): Pair<ParcelFileDescriptor?, MediaMuxer> {
      if (uri.scheme == "file") return null to MediaMuxer(uri.path!!, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
      check(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) { OutputStorage.E_DIR_ACCESS }
      val pfd = storage.openWrite(uri)
      return pfd to MediaMuxer(pfd.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
    }
  }
}
