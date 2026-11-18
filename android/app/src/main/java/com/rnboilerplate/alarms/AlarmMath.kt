package com.rnboilerplate.alarms

import java.util.Calendar
import java.util.TimeZone

/**
 * When a reminder rings next (pure; unit tested). Reminders are stored as a
 * local wall-clock date + time, so "9:00 every day" stays 9:00 after a
 * time-zone or daylight-saving change — the instant is recomputed in the
 * device's current zone each time it's armed.
 *
 * Repeats keep the original day: monthly on the 31st rings on the last day
 * of shorter months; yearly on 29 Feb rings on 28 Feb in other years.
 */
object AlarmMath {
  val REPEATS = setOf("never", "daily", "weekly", "monthly", "yearly")
  private val DATE = Regex("^(\\d{4})-(\\d{2})-(\\d{2})$")
  private val TIME = Regex("^([01]\\d|2[0-3]):([0-5]\\d)$")

  data class Local(val year: Int, val month: Int, val day: Int, val hour: Int, val minute: Int)

  fun parse(date: String, time: String): Local? {
    val d = DATE.matchEntire(date) ?: return null
    val t = TIME.matchEntire(time) ?: return null
    val (y, m, day) = d.destructured
    val (h, min) = t.destructured
    val month = m.toInt()
    if (month !in 1..12 || day.toInt() !in 1..31) return null
    return Local(y.toInt(), month, day.toInt(), h.toInt(), min.toInt())
  }

  /** The instant of [l] in [zone]; a day past the month's end is clamped. */
  fun instant(l: Local, zone: TimeZone): Long {
    val c = Calendar.getInstance(zone)
    c.clear()
    c.set(Calendar.YEAR, l.year)
    c.set(Calendar.MONTH, l.month - 1)
    c.set(Calendar.DAY_OF_MONTH, 1)
    c.set(Calendar.DAY_OF_MONTH, minOf(l.day, c.getActualMaximum(Calendar.DAY_OF_MONTH)))
    c.set(Calendar.HOUR_OF_DAY, l.hour)
    c.set(Calendar.MINUTE, l.minute)
    return c.timeInMillis
  }

  /** The [n]th occurrence (0 = the first) of a repeating local time. */
  private fun occurrence(start: Local, repeat: String, n: Int): Local {
    val c = Calendar.getInstance(TimeZone.getTimeZone("UTC"))
    c.clear()
    c.set(start.year, start.month - 1, 1)
    when (repeat) {
      "daily", "weekly" -> {
        c.set(Calendar.DAY_OF_MONTH, start.day)
        c.add(Calendar.DAY_OF_MONTH, if (repeat == "daily") n else n * 7)
        return Local(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH), start.hour, start.minute)
      }
      "monthly" -> c.add(Calendar.MONTH, n)
      "yearly" -> c.add(Calendar.YEAR, n)
    }
    // Monthly / yearly keep the original day; `instant` clamps it.
    return Local(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, start.day, start.hour, start.minute)
  }

  /**
   * The first occurrence strictly after [now] (epoch ms), or null when a
   * one-off reminder has passed (or the input is invalid).
   */
  fun next(date: String, time: String, repeat: String, now: Long, zone: TimeZone = TimeZone.getDefault()): Long? {
    val start = parse(date, time) ?: return null
    if (repeat !in REPEATS) return null
    val first = instant(start, zone)
    if (first > now) return first
    if (repeat == "never") return null
    // Jump close to [now] first instead of stepping one occurrence at a time.
    val approxStep = when (repeat) {
      "daily" -> 86_400_000L
      "weekly" -> 7 * 86_400_000L
      "monthly" -> 28 * 86_400_000L
      else -> 365 * 86_400_000L
    }
    var n = maxOf(0, ((now - first) / approxStep).toInt() - 2)
    var guard = 0
    while (guard++ < 5000) {
      val at = instant(occurrence(start, repeat, n), zone)
      if (at > now) return at
      n++
    }
    return null
  }
}
