package com.rnboilerplate.alarms

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Calendar
import java.util.TimeZone

class AlarmMathTest {
  private val kolkata = TimeZone.getTimeZone("Asia/Kolkata")
  private val ny = TimeZone.getTimeZone("America/New_York")

  private fun at(zone: TimeZone, y: Int, m: Int, d: Int, h: Int = 0, min: Int = 0): Long =
    Calendar.getInstance(zone).apply {
      clear()
      set(y, m - 1, d, h, min)
    }.timeInMillis

  private fun local(zone: TimeZone, ms: Long): String {
    val c = Calendar.getInstance(zone).apply { timeInMillis = ms }
    return "%04d-%02d-%02d %02d:%02d".format(
      c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH),
      c.get(Calendar.HOUR_OF_DAY), c.get(Calendar.MINUTE),
    )
  }

  @Test
  fun oneOffRingsOnceThenNever() {
    val now = at(kolkata, 2026, 11, 18, 10)
    assertEquals("2026-11-20 09:30", local(kolkata, AlarmMath.next("2026-11-20", "09:30", "never", now, kolkata)!!))
    assertNull(AlarmMath.next("2026-11-17", "09:30", "never", now, kolkata))
  }

  @Test
  fun dailyAndWeeklyMoveToTheNextOneAfterNow() {
    val now = at(kolkata, 2026, 11, 18, 10)
    assertEquals("2026-11-19 09:00", local(kolkata, AlarmMath.next("2026-01-01", "09:00", "daily", now, kolkata)!!))
    assertEquals("2026-11-18 11:00", local(kolkata, AlarmMath.next("2026-01-01", "11:00", "daily", now, kolkata)!!))
    // 2026-11-02 is a Monday → next Monday after Wed 18 Nov is 23 Nov.
    assertEquals("2026-11-23 08:00", local(kolkata, AlarmMath.next("2026-11-02", "08:00", "weekly", now, kolkata)!!))
  }

  @Test
  fun monthlyKeepsTheDayAndClampsShortMonths() {
    val now = at(kolkata, 2027, 2, 1)
    assertEquals("2027-02-28 07:00", local(kolkata, AlarmMath.next("2027-01-31", "07:00", "monthly", now, kolkata)!!))
    // After February it goes back to the 31st.
    val march = at(kolkata, 2027, 3, 1)
    assertEquals("2027-03-31 07:00", local(kolkata, AlarmMath.next("2027-01-31", "07:00", "monthly", march, kolkata)!!))
  }

  @Test
  fun yearlyBirthdayIncludingLeapDay() {
    val now = at(kolkata, 2026, 11, 18)
    assertEquals("2027-05-04 08:00", local(kolkata, AlarmMath.next("1990-05-04", "08:00", "yearly", now, kolkata)!!))
    assertEquals("2027-02-28 08:00", local(kolkata, AlarmMath.next("2000-02-29", "08:00", "yearly", now, kolkata)!!))
    val in2028 = at(kolkata, 2028, 1, 1)
    assertEquals("2028-02-29 08:00", local(kolkata, AlarmMath.next("2000-02-29", "08:00", "yearly", in2028, kolkata)!!))
  }

  @Test
  fun keepsTheWallClockTimeAcrossDaylightSaving() {
    // US DST ends 1 Nov 2026: 9:00 stays 9:00 local on both sides.
    val before = at(ny, 2026, 10, 31, 12)
    val next = AlarmMath.next("2026-10-01", "09:00", "daily", before, ny)!!
    assertEquals("2026-11-01 09:00", local(ny, next))
    assertEquals("2026-11-02 09:00", local(ny, AlarmMath.next("2026-10-01", "09:00", "daily", next, ny)!!))
  }

  @Test
  fun rejectsBadInput() {
    assertNull(AlarmMath.next("2026-13-01", "09:00", "daily", 0, kolkata))
    assertNull(AlarmMath.next("2026-11-01", "24:00", "daily", 0, kolkata))
    assertNull(AlarmMath.next("2026-11-01", "09:00", "hourly", 0, kolkata))
  }

  @Test
  fun parsesAndValidatesEntries() {
    val good = JSONObject()
      .put("key", "reminder:abc")
      .put("title", "Mum's birthday")
      .put("date", "1960-05-04")
      .put("time", "08:00")
      .put("repeat", "yearly")
      .put("alert", JSONObject().put("mode", "priority").put("volume", 250).put("ringtone", "file:///sdcard/x.mp3"))
      .put("link", "javascript:alert(1)")
    val bad = JSONObject().put("key", "../evil").put("title", "x").put("at", 5)
    val list = AlarmEntry.parseAll(JSONArray().put(good).put(bad).toString())
    assertEquals(1, list.size)
    val e = list[0]
    assertEquals(100, e.alert.volume)
    // Only content:// ringtones and our own deep links are accepted.
    assertEquals("", e.alert.ringtone)
    assertEquals("", e.link)
    assertEquals("reminder", e.group)
    assertNotNull(e.nextAfter(at(kolkata, 2026, 11, 18)))
    val timer = AlarmEntry.from(JSONObject().put("key", "timer:t1").put("title", "Tea").put("at", 5_000L))!!
    assertEquals(5_000L, timer.nextAfter(1_000L))
    assertNull(timer.nextAfter(6_000L))
  }
}
