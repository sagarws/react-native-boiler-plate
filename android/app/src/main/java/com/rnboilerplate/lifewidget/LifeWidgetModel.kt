package com.rnboilerplate.lifewidget

import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Pure logic for the Manage Life widget (no Android types, so it is unit
 * tested). The app pushes a snapshot of today's tasks with their current and
 * upcoming periods; quick logs made on the widget are queued until the app
 * opens and imports them. A row's progress = the snapshot's completed amount
 * + queued logs in the same period.
 */
object LifeWidgetModel {
  const val MAX_ROWS = 4

  data class Row(
    val taskId: String,
    val name: String,
    val line: String,
    val percent: Int,
    val met: Boolean,
    val color: String,
    /** Amount the "+" button adds; 0 when logging isn't possible today. */
    val step: Double,
    val stepLabel: String,
  )

  data class View(val title: String, val rows: List<Row>, val footer: String)

  private fun labels(snapshot: JSONObject?) = snapshot?.optJSONObject("labels") ?: JSONObject()

  fun format(n: Double, locale: Locale = Locale.getDefault()): String =
    NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }.format(n)

  /** The task's period containing [today], or null. Days are "YYYY-MM-DD". */
  fun periodOn(task: JSONObject, today: String): JSONObject? {
    val periods = task.optJSONArray("periods") ?: return null
    for (i in 0 until periods.length()) {
      val p = periods.optJSONObject(i) ?: continue
      if (p.optString("s") <= today && today <= p.optString("e")) return p
    }
    return null
  }

  fun queued(logs: JSONArray, taskId: String, start: String, end: String): Double {
    var sum = 0.0
    for (i in 0 until logs.length()) {
      val l = logs.optJSONObject(i) ?: continue
      val day = l.optString("day")
      if (l.optString("task") == taskId && day >= start && day <= end) sum += l.optDouble("q", 0.0)
    }
    return sum
  }

  fun findTask(snapshot: JSONObject?, taskId: String): JSONObject? {
    val tasks = snapshot?.optJSONArray("tasks") ?: return null
    for (i in 0 until tasks.length()) {
      val t = tasks.optJSONObject(i) ?: continue
      if (t.optString("id") == taskId) return t
    }
    return null
  }

  /** True when a quick log for [taskId] on [today] is allowed. */
  fun canLog(snapshot: JSONObject?, taskId: String, today: String, quantity: Double): Boolean {
    if (!(quantity > 0 && quantity <= 1_000_000)) return false
    val task = findTask(snapshot, taskId) ?: return false
    return periodOn(task, today) != null
  }

  fun build(snapshot: JSONObject?, logs: JSONArray, today: String, locale: Locale = Locale.getDefault()): View {
    val l = labels(snapshot)
    val title = l.optString("title", "Today's targets")
    val tasks = snapshot?.optJSONArray("tasks") ?: JSONArray()
    val rows = ArrayList<Row>()
    for (i in 0 until tasks.length()) {
      val t = tasks.optJSONObject(i) ?: continue
      rows += row(t, logs, today, l, locale)
    }
    val shown = rows.take(MAX_ROWS)
    val footer = when {
      snapshot == null -> l.optString("setup", "Open Akshar → Manage Life to add tasks.")
      rows.isEmpty() -> l.optString("empty", "No targets for today.")
      rows.size > MAX_ROWS -> l.optString("more", "+%d more in the app").replace("%d", (rows.size - MAX_ROWS).toString())
      else -> ""
    }
    return View(title, shown, footer)
  }

  private fun row(t: JSONObject, logs: JSONArray, today: String, l: JSONObject, locale: Locale): Row {
    val id = t.optString("id")
    val name = t.optString("name")
    val unit = t.optString("unit")
    val color = t.optString("color", "#7C3AED")
    val period = periodOn(t, today)
      ?: return Row(id, name, l.optString("stale", "Open Akshar to update"), 0, false, color, 0.0, "")
    val start = period.optString("s")
    val end = period.optString("e")
    val target = period.optDouble("t", 0.0)
    val done = period.optDouble("c", 0.0) + queued(logs, id, start, end)
    val met = target > 0 && done >= target
    val percent = if (target > 0) ((done / target) * 100).toInt().coerceIn(0, 100) else 0
    val amounts = "${format(done, locale)} / ${format(target, locale)} $unit".trim()
    val status = when {
      met -> l.optString("met", "Target met")
      end == today -> l.optString("endsToday", "Ends today")
      else -> l.optString("endsOn", "Ends %s").replace("%s", shortDay(end, locale))
    }
    val step = t.optDouble("step", 0.0).takeIf { it > 0 } ?: target
    return Row(id, name, "$amounts · $status", percent, met, color, step, "+${format(step, locale)}")
  }

  /** "Sun 1 Nov" style label for a "YYYY-MM-DD" day. */
  fun shortDay(day: String, locale: Locale): String =
    try {
      val parsed = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { isLenient = false }.parse(day)
      SimpleDateFormat("EEE d MMM", locale).format(parsed!!)
    } catch (_: Exception) {
      day
    }

  /** Local calendar day as "YYYY-MM-DD" (same format as the app's DayKey). */
  fun dayKey(calendar: Calendar = Calendar.getInstance()): String =
    String.format(
      Locale.US,
      "%04d-%02d-%02d",
      calendar.get(Calendar.YEAR),
      calendar.get(Calendar.MONTH) + 1,
      calendar.get(Calendar.DAY_OF_MONTH),
    )

  /** Epoch millis of 00:01 tomorrow, local time. */
  fun nextMidnightMillis(now: Calendar = Calendar.getInstance()): Long =
    (now.clone() as Calendar).apply {
      add(Calendar.DAY_OF_MONTH, 1)
      set(Calendar.HOUR_OF_DAY, 0)
      set(Calendar.MINUTE, 1)
      set(Calendar.SECOND, 0)
      set(Calendar.MILLISECOND, 0)
    }.timeInMillis
}
