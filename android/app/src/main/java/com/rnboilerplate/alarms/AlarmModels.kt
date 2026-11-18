package com.rnboilerplate.alarms

import org.json.JSONArray
import org.json.JSONObject

/**
 * How an alarm alerts. Texts and choices come from JS; everything is
 * re-validated here.
 *
 * mode: sound | vibrate | both | silent | priority
 * - priority = sound + vibration at full volume, alarm-clock scheduling and
 *   a lock-screen alarm screen where Android allows full-screen alerts. It
 *   does not override Do Not Disturb beyond what the alarm stream allows.
 */
data class AlertConfig(
  val mode: String,
  /** Ringtone content URI; '' = the phone's default alarm sound. */
  val ringtone: String,
  /** 0–100, relative to the phone's alarm volume. */
  val volume: Int,
  /** default | short | long | heartbeat */
  val vibration: String,
  /** 0 = no snooze. */
  val snoozeMinutes: Int,
  /** Auto-stop after this many seconds. */
  val ringSeconds: Int,
) {
  val sound get() = mode == "sound" || mode == "both" || mode == "priority"
  val vibrate get() = mode == "vibrate" || mode == "both" || mode == "priority"
  val priority get() = mode == "priority"

  fun toJson(): JSONObject =
    JSONObject()
      .put("mode", mode)
      .put("ringtone", ringtone)
      .put("volume", volume)
      .put("vibration", vibration)
      .put("snoozeMinutes", snoozeMinutes)
      .put("ringSeconds", ringSeconds)

  companion object {
    val MODES = setOf("sound", "vibrate", "both", "silent", "priority")
    val VIBRATIONS = setOf("default", "short", "long", "heartbeat")

    fun from(o: JSONObject?): AlertConfig {
      val mode = o?.optString("mode").takeIf { it in MODES } ?: "both"
      val ringtone = o?.optString("ringtone").orEmpty().takeIf { it.startsWith("content://") || it.startsWith("android.resource://") }.orEmpty()
      return AlertConfig(
        mode = mode,
        ringtone = ringtone,
        volume = (o?.optInt("volume", 80) ?: 80).coerceIn(0, 100),
        vibration = o?.optString("vibration").takeIf { it in VIBRATIONS } ?: "default",
        snoozeMinutes = (o?.optInt("snoozeMinutes", 5) ?: 5).coerceIn(0, 60),
        ringSeconds = (o?.optInt("ringSeconds", 60) ?: 60).coerceIn(5, 300),
      )
    }

    /** Vibration timings (off/on ms), repeated from index 0. */
    fun pattern(name: String): LongArray =
      when (name) {
        "short" -> longArrayOf(0, 200, 300, 200, 1300)
        "long" -> longArrayOf(0, 1200, 800)
        "heartbeat" -> longArrayOf(0, 120, 120, 120, 900)
        else -> longArrayOf(0, 600, 600)
      }
  }
}

/**
 * One scheduled alarm. [key] = "<group>:<id>" (group: reminder | timer |
 * snooze). Either a fixed instant ([at], timers / snoozes) or a local
 * wall-clock [date] + [time] with a [repeat] (reminders).
 */
data class AlarmEntry(
  val key: String,
  val title: String,
  val body: String,
  val at: Long,
  val date: String,
  val time: String,
  val repeat: String,
  val alert: AlertConfig,
  /** Deep link opened from the notification. */
  val link: String,
) {
  val group: String get() = key.substringBefore(':')
  val wallClock: Boolean get() = at <= 0L

  /** The next instant to ring after [now], or null when nothing is left. */
  fun nextAfter(now: Long): Long? =
    if (wallClock) AlarmMath.next(date, time, repeat, now) else at.takeIf { it > now }

  fun toJson(): JSONObject =
    JSONObject()
      .put("key", key)
      .put("title", title)
      .put("body", body)
      .put("at", at)
      .put("date", date)
      .put("time", time)
      .put("repeat", repeat)
      .put("alert", alert.toJson())
      .put("link", link)

  companion object {
    private val KEY_RE = Regex("^(reminder|timer|snooze):[A-Za-z0-9:_-]{1,120}$")
    private val LINK_RE = Regex("^rnboilerplate://[a-z0-9/_-]{0,80}$")

    fun from(o: JSONObject?): AlarmEntry? {
      o ?: return null
      val key = o.optString("key")
      val title = o.optString("title").take(120)
      if (!KEY_RE.matches(key) || title.isBlank()) return null
      val at = o.optLong("at", 0L)
      val date = o.optString("date")
      val time = o.optString("time")
      val repeat = o.optString("repeat").takeIf { it in AlarmMath.REPEATS } ?: "never"
      if (at <= 0L && AlarmMath.parse(date, time) == null) return null
      return AlarmEntry(
        key = key,
        title = title,
        body = o.optString("body").take(300),
        at = at.coerceAtLeast(0L),
        date = date,
        time = time,
        repeat = repeat,
        alert = AlertConfig.from(o.optJSONObject("alert")),
        link = o.optString("link").takeIf { LINK_RE.matches(it) } ?: "",
      )
    }

    fun parseAll(json: String): List<AlarmEntry> {
      val arr = try {
        JSONArray(json)
      } catch (_: Exception) {
        return emptyList()
      }
      return (0 until arr.length()).mapNotNull { from(arr.optJSONObject(it)) }.distinctBy { it.key }
    }
  }
}
