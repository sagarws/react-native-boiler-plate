package com.rnboilerplate.lifewidget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Calendar
import java.util.Locale

class LifeWidgetModelTest {
  private val snapshot = JSONObject(
    """
    {"v":1,"labels":{"title":"Today's targets","met":"Target met","endsToday":"Ends today",
     "endsOn":"Ends %s","stale":"Open Akshar to update","more":"+%d more in the app","empty":"None"},
     "tasks":[
      {"id":"walk","name":"Walk","unit":"steps","color":"#14B8A6","step":1100,
       "periods":[{"s":"2026-10-28","e":"2026-10-28","t":4400,"c":2200},
                  {"s":"2026-10-29","e":"2026-10-29","t":4400,"c":0}]},
      {"id":"read","name":"Read","unit":"pages","color":"#7C3AED","step":25,
       "periods":[{"s":"2026-10-26","e":"2026-11-01","t":100,"c":30}]}
     ]}
    """,
  )

  private fun log(task: String, day: String, q: Double) =
    JSONObject().put("id", "$task$day$q").put("task", task).put("day", day).put("q", q).put("at", 0)

  @Test
  fun showsProgressIncludingQueuedLogs() {
    val logs = JSONArray().put(log("walk", "2026-10-28", 1100.0)).put(log("walk", "2026-10-28", 1100.0))
    val view = LifeWidgetModel.build(snapshot, logs, "2026-10-28", Locale.US)
    assertEquals("Today's targets", view.title)
    val walk = view.rows[0]
    assertEquals("4,400 / 4,400 steps · Target met", walk.line)
    assertEquals(100, walk.percent)
    assertTrue(walk.met)
    assertEquals("+1,100", walk.stepLabel)
    val read = view.rows[1]
    assertEquals("30 / 100 pages · Ends Sun 1 Nov", read.line)
    assertEquals(30, read.percent)
    assertEquals("", view.footer)
  }

  @Test
  fun rollsOverToTheNextPeriodWithoutTheApp() {
    // Yesterday's queued log doesn't count towards today.
    val logs = JSONArray().put(log("walk", "2026-10-28", 500.0))
    val walk = LifeWidgetModel.build(snapshot, logs, "2026-10-29", Locale.US).rows[0]
    assertEquals("0 / 4,400 steps · Ends today", walk.line)
    assertEquals(0, walk.percent)
  }

  @Test
  fun asksToOpenTheAppWhenNoPeriodIsKnown() {
    val walk = LifeWidgetModel.build(snapshot, JSONArray(), "2026-11-20", Locale.US).rows[0]
    assertEquals("Open Akshar to update", walk.line)
    assertEquals(0.0, walk.step, 0.0)
  }

  @Test
  fun limitsRowsAndValidatesQuickLogs() {
    val tasks = snapshot.getJSONArray("tasks")
    for (i in 0 until 4) tasks.put(JSONObject(tasks.getJSONObject(0).toString()).put("id", "x$i"))
    val view = LifeWidgetModel.build(snapshot, JSONArray(), "2026-10-28", Locale.US)
    assertEquals(LifeWidgetModel.MAX_ROWS, view.rows.size)
    assertEquals("+2 more in the app", view.footer)

    assertTrue(LifeWidgetModel.canLog(snapshot, "walk", "2026-10-28", 1100.0))
    assertFalse(LifeWidgetModel.canLog(snapshot, "walk", "2026-10-28", 0.0))
    assertFalse(LifeWidgetModel.canLog(snapshot, "unknown", "2026-10-28", 5.0))
    assertFalse(LifeWidgetModel.canLog(snapshot, "walk", "2026-12-01", 5.0))
    assertFalse(LifeWidgetModel.canLog(null, "walk", "2026-10-28", 5.0))
  }

  @Test
  fun buildsLocalDayKeysAndTheNextMidnight() {
    val cal = Calendar.getInstance().apply { set(2026, Calendar.DECEMBER, 31, 23, 50, 0) }
    assertEquals("2026-12-31", LifeWidgetModel.dayKey(cal))
    val next = Calendar.getInstance().apply { timeInMillis = LifeWidgetModel.nextMidnightMillis(cal) }
    assertEquals("2027-01-01", LifeWidgetModel.dayKey(next))
    assertEquals(0, next.get(Calendar.HOUR_OF_DAY))
    assertEquals(1, next.get(Calendar.MINUTE))
  }
}
