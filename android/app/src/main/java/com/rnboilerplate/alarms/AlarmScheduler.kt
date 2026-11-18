package com.rnboilerplate.alarms

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/**
 * Keeps Android's alarms equal to what JS asked for, per group. Entries are
 * stored (SharedPreferences) so they survive a reboot, an app update and a
 * clock / time-zone change — [rearmAll] recomputes every instant then.
 *
 * Duplicates are prevented two ways: one PendingIntent per key (re-arming
 * replaces it), and the instant last fired per key is remembered, so a late
 * or repeated delivery of the same occurrence is ignored.
 */
object AlarmScheduler {
  private const val PREFS = "alarms_store"
  private const val KEY_ENTRIES = "entries"
  private const val KEY_ARMED = "armed"
  private const val KEY_FIRED = "fired"
  const val ACTION_FIRE = "com.rnboilerplate.alarms.FIRE"
  const val EXTRA_KEY = "key"
  /** Android allows 500 alarms per app; stay well below. */
  private const val MAX = 300

  /** Notified (on the main thread) when an alarm fires: JS refreshes. */
  @Volatile var onFired: ((String) -> Unit)? = null

  private fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun entries(c: Context): List<AlarmEntry> = AlarmEntry.parseAll(prefs(c).getString(KEY_ENTRIES, "[]") ?: "[]")

  private fun longMap(c: Context, name: String): MutableMap<String, Long> {
    val o = try {
      JSONObject(prefs(c).getString(name, "{}") ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }
    return o.keys().asSequence().associateWith { o.optLong(it) }.toMutableMap()
  }

  private fun save(c: Context, list: List<AlarmEntry>, armed: Map<String, Long>, fired: Map<String, Long>) {
    val arr = JSONArray()
    list.forEach { arr.put(it.toJson()) }
    prefs(c).edit()
      .putString(KEY_ENTRIES, arr.toString())
      .putString(KEY_ARMED, JSONObject(armed as Map<*, *>).toString())
      .putString(KEY_FIRED, JSONObject(fired.filterKeys { k -> list.any { it.key == k } } as Map<*, *>).toString())
      .commit()
  }

  fun canScheduleExact(c: Context): Boolean {
    if (Build.VERSION.SDK_INT < 31) return true
    return c.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true
  }

  private fun pending(c: Context, key: String, flags: Int): PendingIntent? =
    PendingIntent.getBroadcast(
      c,
      key.hashCode(),
      Intent(c, AlarmReceiver::class.java)
        .setAction(ACTION_FIRE)
        // A distinct data URI per key keeps the PendingIntents apart.
        .setData(Uri.parse("akshar-alarm://fire/${Uri.encode(key)}"))
        .putExtra(EXTRA_KEY, key),
      flags or PendingIntent.FLAG_IMMUTABLE,
    )

  private fun cancelAlarm(c: Context, key: String) {
    val alarms = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    pending(c, key, PendingIntent.FLAG_NO_CREATE)?.let {
      alarms.cancel(it)
      it.cancel()
    }
  }

  /** Arms [e] for [at]. Returns true when exact. */
  private fun arm(c: Context, e: AlarmEntry, at: Long): Boolean {
    val alarms = c.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(c, e.key, PendingIntent.FLAG_UPDATE_CURRENT) ?: return false
    if (!canScheduleExact(c)) {
      // No exact-alarm permission: may be delayed while the phone is idle.
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      return false
    }
    return try {
      if (e.alert.priority) {
        // Alarm-clock alarms are the most reliable and show the clock icon.
        val show = c.packageManager.getLaunchIntentForPackage(c.packageName)?.let {
          PendingIntent.getActivity(c, 0, it, PendingIntent.FLAG_IMMUTABLE)
        }
        alarms.setAlarmClock(AlarmManager.AlarmClockInfo(at, show), pi)
      } else {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      }
      true
    } catch (_: SecurityException) {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      false
    }
  }

  data class SyncResult(val armed: Int, val exact: Boolean)

  /**
   * Replaces every alarm of [group] with [next] (snoozes of removed entries
   * are dropped too). Entries with nothing left to ring are not kept.
   */
  @Synchronized
  fun sync(c: Context, group: String, next: List<AlarmEntry>): SyncResult {
    val now = System.currentTimeMillis()
    val all = entries(c)
    val armed = longMap(c, KEY_ARMED)
    val fired = longMap(c, KEY_FIRED)
    val incoming = next.filter { it.group == group }.take(MAX)
    val keep = incoming.map { it.key }.toSet()
    val others = all.filter { e ->
      if (e.group == group) return@filter false
      // A snooze lives only while the alarm it snoozes still exists.
      if (e.group == "snooze") {
        val target = e.key.removePrefix("snooze:")
        if (target.startsWith("$group:") && target !in keep) return@filter false
      }
      true
    }
    for (old in all) if (old !in others) {
      cancelAlarm(c, old.key)
      armed.remove(old.key)
    }
    val kept = mutableListOf<AlarmEntry>()
    for (e in incoming) {
      val at = e.nextAfter(now) ?: continue
      kept.add(e)
      armed[e.key] = at
      arm(c, e, at)
    }
    // Others stay armed as they were.
    save(c, others + kept, armed, fired)
    return SyncResult(kept.size, canScheduleExact(c))
  }

  /** After a reboot, app update or clock / time-zone change. */
  @Synchronized
  fun rearmAll(c: Context) {
    val now = System.currentTimeMillis()
    val armed = longMap(c, KEY_ARMED)
    val fired = longMap(c, KEY_FIRED)
    val kept = mutableListOf<AlarmEntry>()
    for (e in entries(c)) {
      val at = e.nextAfter(now)
      if (at == null) {
        cancelAlarm(c, e.key)
        armed.remove(e.key)
        continue
      }
      kept.add(e)
      armed[e.key] = at
      arm(c, e, at)
    }
    save(c, kept, armed, fired)
  }

  /** Snoozes [e] for its snooze minutes (a "snooze:<key>" one-off). */
  @Synchronized
  fun snooze(c: Context, e: AlarmEntry) {
    val minutes = e.alert.snoozeMinutes.takeIf { it > 0 } ?: 5
    val at = System.currentTimeMillis() + minutes * 60_000L
    val key = if (e.group == "snooze") e.key else "snooze:${e.key}"
    val s = e.copy(key = key, at = at, date = "", time = "", repeat = "never")
    val list = entries(c).filter { it.key != key } + s
    val armed = longMap(c, KEY_ARMED).apply { put(key, at) }
    save(c, list, armed, longMap(c, KEY_FIRED))
    arm(c, s, at)
  }

  /**
   * An alarm fired: returns the entry to ring, or null when it's stale or
   * already rung. Re-arms a repeating entry; forgets a finished one.
   */
  @Synchronized
  fun onFire(c: Context, key: String): AlarmEntry? {
    val now = System.currentTimeMillis()
    val list = entries(c)
    val e = list.firstOrNull { it.key == key } ?: return null
    val armed = longMap(c, KEY_ARMED)
    val fired = longMap(c, KEY_FIRED)
    val due = armed[key] ?: return null
    if (fired[key] == due) return null
    if (due > now + EARLY_MS) {
      // Delivered early (clock changed): arm again for the real time.
      arm(c, e, due)
      return null
    }
    fired[key] = due
    val next = e.nextAfter(maxOf(now, due))
    val updated = if (next != null) {
      armed[key] = next
      arm(c, e, next)
      list
    } else {
      armed.remove(key)
      list.filter { it.key != key }
    }
    // A finished one-off is removed, so a duplicate delivery finds nothing.
    save(c, updated, armed, fired)
    return e
  }

  /** Every key with its next ring time (for JS). */
  fun armedJson(c: Context): String = JSONObject(longMap(c, KEY_ARMED) as Map<*, *>).toString()

  private const val EARLY_MS = 60_000L
}
