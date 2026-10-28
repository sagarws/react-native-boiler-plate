package com.rnboilerplate.utility

import com.rnboilerplate.followup.Reminder
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale

class UtilityMathTest {
  @Test
  fun measuresLengthAndVerticalHeight() {
    val a = floatArrayOf(0f, 0f, 0f)
    val b = floatArrayOf(3f, 4f, 0f)
    assertEquals(5.0, MeasureMath.distance(a, b), 1e-6)
    // Height ignores horizontal offset: only the Y (up) difference counts.
    assertEquals(4.0, MeasureMath.vertical(a, b), 1e-6)
  }

  @Test
  fun projectsPointsAndRejectsOnesBehindTheCamera() {
    // Identity view-projection: NDC = world x/y; w = 1.
    val identity = FloatArray(16).also { for (i in 0..3) it[i * 5] = 1f }
    assertArrayEquals(floatArrayOf(50f, 50f), MeasureMath.project(identity, floatArrayOf(0f, 0f, 0f), 100, 100), 1e-4f)
    assertArrayEquals(floatArrayOf(100f, 0f), MeasureMath.project(identity, floatArrayOf(1f, 1f, 0f), 100, 100), 1e-4f)
    val behind = identity.clone().also { it[15] = -1f }
    assertNull(MeasureMath.project(behind, floatArrayOf(0f, 0f, 0f), 100, 100))
  }

  @Test
  fun formatsUnits() {
    Locale.setDefault(Locale.US)
    assertEquals("123.4 cm", MeasureMath.format(1.234, "cm"))
    assertEquals("1.23 m", MeasureMath.format(1.234, "m"))
    assertEquals("39.4 in", MeasureMath.format(1.0, "in"))
    assertEquals("3.28 ft", MeasureMath.format(1.0, "ft"))
  }

  @Test
  fun fitsPagesToA4KeepingAspect() {
    assertEquals(595 to 842, PageLayout.a4For(1000, 1400))
    assertEquals(842 to 595, PageLayout.a4For(1400, 1000))
    val r = PageLayout.fit(1000, 2000, 595, 842, 18f)
    val w = r[2] - r[0]
    val h = r[3] - r[1]
    assertEquals(0.5f, w / h, 1e-4f)
    assertEquals(842f - 36f, h, 1e-3f)
    assertEquals(595f / 2, (r[0] + r[2]) / 2, 1e-3f)
  }

  @Test
  fun downsamplesLargePagesAndSanitisesNames() {
    assertEquals(1, PageLayout.sampleSize(2000, 1500, 2400))
    assertEquals(2, PageLayout.sampleSize(4800, 3600, 2400))
    assertEquals(4, PageLayout.sampleSize(12000, 9000, 2400))
    assertEquals("Receipt May.pdf", PageLayout.safeName("Receipt/ May", "pdf"))
    assertEquals("scan.jpg", PageLayout.safeName("../..", "jpg"))
  }

  @Test
  fun toneStaysInRangeAndPulses() {
    for (t in listOf(0.0, 1.5, 3.0, 4.5, 5.99)) {
      val f = ToneShape.frequency("sweep", t)
      assertTrue(f in 100.0..400.0)
    }
    assertEquals(ToneShape.LOW_HZ, ToneShape.frequency("low", 10.0), 0.0)
    assertEquals(1.0, ToneShape.envelope("pulse", 1.3, 30.0), 1e-9)
    assertEquals(0.0, ToneShape.envelope("pulse", 1.8, 30.0), 1e-9)
    // Fades in and out (no click at the ends).
    assertEquals(0.0, ToneShape.envelope("low", 0.0, 30.0), 1e-9)
    assertEquals(0.0, ToneShape.envelope("low", 30.0, 30.0), 1e-9)
  }

  @Test
  fun compassAngleDeltaWrapsAround() {
    assertEquals(2.0, CompassSensor.angleDelta(359.0, 1.0), 1e-9)
    assertEquals(180.0, CompassSensor.angleDelta(0.0, 180.0), 1e-9)
  }

  @Test
  fun parsesOnlyWellFormedReminders() {
    val list = Reminder.parseAll(
      """[{"key":"due:abc-1","at":1700000000000,"title":"Call Asha","body":"Quote","contactId":"c1"},
          {"key":"due:abc-1","at":1700000000001,"title":"dup","body":"","contactId":"c1"},
          {"key":"bad key","at":1,"title":"x"},
          {"key":"bday:c2","at":0,"title":"x"},
          {"key":"over:x","at":5,"title":""}]""",
    )
    assertEquals(listOf("due:abc-1"), list.map { it.key })
    assertEquals("Call Asha", list[0].title)
    assertTrue(Reminder.parseAll("not json").isEmpty())
  }
}
