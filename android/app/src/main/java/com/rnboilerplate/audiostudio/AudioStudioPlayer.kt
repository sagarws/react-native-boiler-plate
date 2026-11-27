package com.rnboilerplate.audiostudio

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArraySet

/**
 * The one ExoPlayer of 8D Audio Studio, shared by [AudioStudioModule] (JS
 * commands) and [AudioStudioService] (MediaSession, notification). Built
 * lazily; every member must be used on the main thread.
 *
 * Queue indices exchanged with JS are positions in the *play order*: the
 * playlist order normally, the shuffle order ([ListShuffleOrder]) when
 * shuffled. The `state` event reports the queue in that same order.
 *
 * "Crossfade" is a volume fade, not an overlapping mix: the tail of a song
 * fades out, the next one fades in, and pause / resume fade (capped at
 * [MAX_PAUSE_FADE_MS] so the buttons stay responsive).
 */
@OptIn(UnstableApi::class)
object AudioStudioPlayer {
  private const val TAG = "AudioStudio"
  private const val STATE_DEBOUNCE_MS = 100L
  private const val FADE_TICK_MS = 50L
  private const val MAX_PAUSE_FADE_MS = 1000L
  private const val MIN_SPEED = 0.5f
  private const val MAX_SPEED = 2f

  private val main = Handler(Looper.getMainLooper())
  private val listeners = CopyOnWriteArraySet<(String, JSONObject) -> Unit>()

  private var exo: ExoPlayer? = null
  private var forwarding: Player? = null

  /** Set by the running [AudioStudioService]; stops it (and releases the session). */
  var stopService: (() -> Unit)? = null
  var serviceRunning = false

  private var sleepAt: Long? = null
  private var sleepEndOfTrack = false
  private var fadeMs = 0L
  private var rampRunnable: Runnable? = null
  private var pausing = false
  private var lastTrackId: String? = null

  // ── events ──

  fun addListener(listener: (String, JSONObject) -> Unit) = listeners.add(listener)

  fun removeListener(listener: (String, JSONObject) -> Unit) = listeners.remove(listener)

  private fun emit(type: String, body: JSONObject) = listeners.forEach { it(type, body) }

  private val emitState = Runnable { emit("state", state()) }

  private fun scheduleState() {
    main.removeCallbacks(emitState)
    main.postDelayed(emitState, STATE_DEBOUNCE_MS)
  }

  // ── player ──

  fun obtain(context: Context): ExoPlayer {
    exo?.let { return it }
    val ctx = context.applicationContext
    val player =
      ExoPlayer
        .Builder(ctx, SpatialRenderersFactory(ctx))
        .setAudioAttributes(
          AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),
          true,
        ).setHandleAudioBecomingNoisy(true)
        .setWakeMode(C.WAKE_MODE_LOCAL)
        .build()
    player.setShuffleOrder(ListShuffleOrder.identity(0))
    player.addListener(playerListener)
    // An end-of-track sleep timer set before the first queue applies to it.
    if (sleepEndOfTrack && sleepAt == null) player.pauseAtEndOfMediaItems = true
    exo = player
    forwarding = FadingPlayer(player)
    return player
  }

  /** What the MediaSession drives: the player, with play / pause routed through the fades. */
  fun sessionPlayer(context: Context): Player {
    obtain(context)
    return forwarding!!
  }

  /** Releases the player (queue cleared, or the task closed while paused). */
  fun release() {
    cancelSleep()
    cancelRamp()
    main.removeCallbacks(fadeTick)
    pausing = false
    lastTrackId = null
    exo?.run {
      removeListener(playerListener)
      release()
    }
    exo = null
    forwarding = null
    SpatialDsp.state = FloatArray(SpatialDsp.state.size)
    main.removeCallbacks(emitState)
    emit("state", state())
  }

  private fun ensureService(context: Context) {
    if (serviceRunning) return
    try {
      context.startService(Intent(context, AudioStudioService::class.java))
    } catch (e: IllegalStateException) {
      // Background start not allowed; the session starts with the next foreground command.
      Log.w(TAG, "service start deferred: ${e.message}")
    }
  }

  // ── queue ──

  fun setQueue(context: Context, songsJson: String, startIndex: Int, positionMs: Long, play: Boolean) {
    val items = parseSongs(songsJson)
    if (items.isEmpty()) {
      clearQueue()
      return
    }
    val p = obtain(context)
    val start = startIndex.coerceIn(0, items.size - 1)
    p.setMediaItems(items, start, positionMs.coerceAtLeast(0))
    p.setShuffleOrder(if (p.shuffleModeEnabled) ListShuffleOrder.shuffled(items.size, start) else ListShuffleOrder.identity(items.size))
    p.prepare()
    ensureService(context)
    if (play) play() else p.pause()
    scheduleState()
  }

  fun addToQueue(context: Context, songsJson: String, index: Int) {
    val items = parseSongs(songsJson)
    if (items.isEmpty()) return
    val p = exo
    if (p == null || p.mediaItemCount == 0) {
      setQueue(context, songsJson, 0, 0, false)
      return
    }
    val order = playOrder(p)
    val current = order.indexOf(p.currentMediaItemIndex)
    val target =
      when (index) {
        -1 -> order.size
        -2 -> if (current >= 0) current + 1 else order.size
        else -> index.coerceIn(0, order.size)
      }
    if (!p.shuffleModeEnabled) {
      p.addMediaItems(target, items)
    } else {
      // Append to the playlist, then place the new items at `target` in the shuffle order.
      val first = p.mediaItemCount
      p.addMediaItems(items)
      val next = order.toMutableList().apply { addAll(target, List(items.size) { first + it }) }
      p.setShuffleOrder(ListShuffleOrder(next.toIntArray()))
    }
    if (p.playbackState == Player.STATE_IDLE) p.prepare()
    ensureService(context)
    scheduleState()
  }

  fun removeFromQueue(index: Int) {
    val p = exo ?: return
    val order = playOrder(p)
    if (index !in order.indices) return
    if (order.size == 1) {
      clearQueue()
      return
    }
    p.removeMediaItem(order[index])
    scheduleState()
  }

  fun moveQueueItem(from: Int, to: Int) {
    val p = exo ?: return
    val order = playOrder(p)
    if (from !in order.indices || to !in order.indices || from == to) return
    if (!p.shuffleModeEnabled) {
      p.moveMediaItem(from, to)
    } else {
      val next = order.toMutableList().apply { add(to, removeAt(from)) }
      p.setShuffleOrder(ListShuffleOrder(next.toIntArray()))
    }
    scheduleState()
  }

  fun clearQueue() {
    val p = exo
    if (p != null) {
      cancelRamp()
      p.stop()
      p.clearMediaItems()
    }
    val stop = stopService
    if (stop != null) stop() else release()
  }

  fun skipTo(context: Context, index: Int) {
    val p = exo ?: return
    val order = playOrder(p)
    if (index !in order.indices) return
    p.seekTo(order[index], 0)
    resumeIfIdle(p)
    ensureService(context)
  }

  fun seekTo(positionMs: Long) {
    exo?.seekTo(positionMs.coerceAtLeast(0))
  }

  fun next() {
    exo?.seekToNextMediaItem()
  }

  fun previous() {
    exo?.seekToPrevious()
  }

  // ── transport (fades) ──

  fun play(context: Context) {
    ensureService(context)
    play()
  }

  private fun play() {
    val p = exo ?: return
    if (p.mediaItemCount == 0) return
    resumeIfIdle(p)
    if (p.playbackState == Player.STATE_ENDED) p.seekToDefaultPosition(p.currentMediaItemIndex)
    cancelRamp()
    pausing = false
    val ms = pauseFadeMs()
    if (ms > 0 && !p.isPlaying) {
      p.volume = 0f
      p.play()
      ramp(1f, ms)
    } else {
      p.volume = 1f
      p.play()
    }
  }

  fun pause() {
    val p = exo ?: return
    val ms = pauseFadeMs()
    if (ms <= 0 || !p.isPlaying || pausing) {
      if (!pausing) p.pause()
      return
    }
    pausing = true
    ramp(0f, ms) {
      pausing = false
      p.pause()
    }
  }

  /** Immediate pause, no fade (the service is going away). */
  fun pauseNow() {
    cancelRamp()
    pausing = false
    exo?.run {
      pause()
      volume = 1f
    }
  }

  private fun resumeIfIdle(p: ExoPlayer) {
    if (p.playbackState == Player.STATE_IDLE && p.mediaItemCount > 0) p.prepare()
  }

  private fun pauseFadeMs() = minOf(fadeMs, MAX_PAUSE_FADE_MS)

  // ── modes ──

  fun setRepeatMode(mode: String) {
    exo?.repeatMode =
      when (mode) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
      }
  }

  fun setShuffle(context: Context, enabled: Boolean) {
    // The listener installs a fresh order (current song first) when it turns on.
    obtain(context).shuffleModeEnabled = enabled
  }

  fun setSpeed(speed: Float) {
    exo?.playbackParameters = PlaybackParameters(speed.coerceIn(MIN_SPEED, MAX_SPEED), 1f)
  }

  fun setCrossfade(ms: Long) {
    fadeMs = ms.coerceAtLeast(0)
    main.removeCallbacks(fadeTick)
    if (fadeMs == 0L) {
      cancelRamp()
      if (!pausing) exo?.volume = 1f
    } else if (exo?.isPlaying == true) {
      main.post(fadeTick)
    }
  }

  // ── sleep timer ──

  private val sleepRunnable =
    Runnable {
      sleepAt = null
      if (sleepEndOfTrack) {
        exo?.pauseAtEndOfMediaItems = true
      } else {
        pause()
      }
      scheduleState()
    }

  /**
   * minutes > 0: pause after that long (with endOfTrack, finish the song that
   * is playing then). minutes = 0 + endOfTrack: pause when the current song
   * ends. minutes = 0 alone cancels.
   */
  fun setSleepTimer(minutes: Double, endOfTrack: Boolean) {
    cancelSleep()
    sleepEndOfTrack = endOfTrack
    if (minutes > 0) {
      val delay = (minutes * 60_000).toLong()
      sleepAt = System.currentTimeMillis() + delay
      main.postDelayed(sleepRunnable, delay)
    } else if (endOfTrack) {
      exo?.pauseAtEndOfMediaItems = true
    }
    scheduleState()
  }

  private fun cancelSleep() {
    main.removeCallbacks(sleepRunnable)
    sleepAt = null
    sleepEndOfTrack = false
    exo?.pauseAtEndOfMediaItems = false
  }

  // ── state ──

  /** Playlist indices in the order they will play. */
  private fun playOrder(p: Player): List<Int> {
    val timeline = p.currentTimeline
    if (timeline.isEmpty) return emptyList()
    val shuffle = p.shuffleModeEnabled
    val out = ArrayList<Int>(timeline.windowCount)
    var i = timeline.getFirstWindowIndex(shuffle)
    while (i != C.INDEX_UNSET && out.size < timeline.windowCount) {
      out.add(i)
      i = timeline.getNextWindowIndex(i, Player.REPEAT_MODE_OFF, shuffle)
    }
    return out
  }

  fun state(): JSONObject {
    val p = exo
    val json = JSONObject()
    val queue = JSONArray()
    var index = -1
    if (p != null) {
      val order = playOrder(p)
      order.forEach { queue.put(p.getMediaItemAt(it).mediaId) }
      index = order.indexOf(p.currentMediaItemIndex)
    }
    json.put("queue", queue)
    json.put("index", index)
    val state = p?.playbackState ?: Player.STATE_IDLE
    json.put("playing", p != null && p.playWhenReady && !pausing && state != Player.STATE_IDLE && state != Player.STATE_ENDED)
    json.put("buffering", state == Player.STATE_BUFFERING)
    json.put("positionMs", if (p != null && index >= 0) p.currentPosition else 0L)
    json.put("durationMs", p?.duration?.takeIf { it != C.TIME_UNSET && index >= 0 } ?: 0L)
    json.put(
      "repeat",
      when (p?.repeatMode) {
        Player.REPEAT_MODE_ONE -> "one"
        Player.REPEAT_MODE_ALL -> "all"
        else -> "off"
      },
    )
    json.put("shuffle", p?.shuffleModeEnabled == true)
    json.put("speed", (p?.playbackParameters?.speed ?: 1f).toDouble())
    json.put("sleepAt", sleepAt ?: JSONObject.NULL)
    json.put("sleepEndOfTrack", sleepEndOfTrack)
    json.put("error", p?.playerError?.let { "${it.errorCodeName}: ${it.message.orEmpty()}" } ?: JSONObject.NULL)
    return json
  }

  private val playerListener =
    object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        scheduleState()
        val id = player.currentMediaItem?.mediaId
        if (player.isPlaying && id != null && id != lastTrackId) {
          lastTrackId = id
          emit("track", JSONObject().put("id", id))
        }
      }

      override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
        // A new song (or a repeat) counts as played again once it is playing.
        lastTrackId = null
        val p = exo ?: return
        if (fadeMs > 0 && p.playWhenReady && !pausing && reason != Player.MEDIA_ITEM_TRANSITION_REASON_PLAYLIST_CHANGED) {
          cancelRamp()
          p.volume = 0f
          ramp(1f, fadeMs)
        }
      }

      override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
        if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) endOfTrackSleepDone()
      }

      override fun onPlaybackStateChanged(playbackState: Int) {
        if (playbackState == Player.STATE_ENDED && exo?.pauseAtEndOfMediaItems == true) endOfTrackSleepDone()
      }

      override fun onIsPlayingChanged(isPlaying: Boolean) {
        main.removeCallbacks(fadeTick)
        if (isPlaying && fadeMs > 0) main.post(fadeTick)
      }

      override fun onShuffleModeEnabledChanged(shuffleModeEnabled: Boolean) {
        val p = exo ?: return
        if (shuffleModeEnabled && p.mediaItemCount > 0) {
          p.setShuffleOrder(ListShuffleOrder.shuffled(p.mediaItemCount, p.currentMediaItemIndex))
        }
      }
    }

  private fun endOfTrackSleepDone() {
    if (!sleepEndOfTrack) return
    sleepEndOfTrack = false
    exo?.pauseAtEndOfMediaItems = false
    scheduleState()
  }

  // ── volume fades ──

  /** Song-tail fade-out while playing; volume back to 1 elsewhere. */
  private val fadeTick: Runnable =
    object : Runnable {
      override fun run() {
        val p = exo ?: return
        if (fadeMs <= 0 || !p.isPlaying) return
        if (rampRunnable == null && !pausing) {
          val duration = p.duration
          val target =
            if (duration == C.TIME_UNSET) {
              1f
            } else {
              val remaining = (duration - p.currentPosition) / p.playbackParameters.speed
              (remaining / fadeMs).coerceIn(0f, 1f)
            }
          if (p.volume != target) p.volume = target
        }
        main.postDelayed(this, FADE_TICK_MS)
      }
    }

  private fun ramp(to: Float, durationMs: Long, done: (() -> Unit)? = null) {
    val p = exo ?: return
    cancelRamp()
    val from = p.volume
    val start = SystemClock.uptimeMillis()
    val step =
      object : Runnable {
        override fun run() {
          val player = exo ?: return
          val t = ((SystemClock.uptimeMillis() - start).toFloat() / durationMs).coerceIn(0f, 1f)
          player.volume = from + (to - from) * t
          if (t < 1f) {
            main.postDelayed(this, FADE_TICK_MS / 2)
          } else {
            rampRunnable = null
            done?.invoke()
          }
        }
      }
    rampRunnable = step
    main.post(step)
  }

  private fun cancelRamp() {
    rampRunnable?.let { main.removeCallbacks(it) }
    rampRunnable = null
  }

  // ── songs ──

  private fun parseSongs(json: String): List<MediaItem> {
    val array = runCatching { JSONArray(json) }.getOrNull() ?: return emptyList()
    val out = ArrayList<MediaItem>(array.length())
    for (i in 0 until array.length()) {
      val song = array.optJSONObject(i) ?: continue
      val id = song.optString("id")
      val uri = song.optString("uri")
      if (id.isEmpty() || uri.isEmpty()) continue
      val art = if (song.isNull("artUri")) null else song.optString("artUri").takeIf { it.isNotEmpty() }
      val metadata =
        MediaMetadata
          .Builder()
          .setTitle(song.optString("title"))
          .setArtist(song.optString("artist").takeIf { it.isNotEmpty() })
          .setAlbumTitle(song.optString("album").takeIf { it.isNotEmpty() })
          .setGenre(song.optString("genre").takeIf { it.isNotEmpty() })
          .setArtworkUri(art?.let(Uri::parse))
          .setDurationMs(song.optLong("durationMs").takeIf { it > 0 })
          .setIsPlayable(true)
          .setIsBrowsable(false)
          .build()
      out.add(MediaItem.Builder().setMediaId(id).setUri(uri).setMediaMetadata(metadata).build())
    }
    return out
  }

  /** Session-facing player: notification / headset play & pause get the same fades as the app's buttons. */
  private class FadingPlayer(player: Player) : ForwardingPlayer(player) {
    override fun play() = AudioStudioPlayer.play()

    override fun pause() = AudioStudioPlayer.pause()

    override fun setPlayWhenReady(playWhenReady: Boolean) = if (playWhenReady) play() else pause()
  }
}
