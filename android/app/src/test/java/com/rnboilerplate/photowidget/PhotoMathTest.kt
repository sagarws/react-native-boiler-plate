package com.rnboilerplate.photowidget

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhotoMathTest {
  private val eps = 1e-3f

  @Test
  fun fitShowsTheWholePhotoLetterboxed() {
    // 2000×1000 photo in a 200×200 widget → 200×100, centred vertically.
    val l = PhotoMath.layout(2000, 1000, 200f, 200f, "fit")
    assertEquals(0f, l.src.left, eps)
    assertEquals(2000f, l.src.width, eps)
    assertEquals(200f, l.dst.width, eps)
    assertEquals(100f, l.dst.height, eps)
    assertEquals(50f, l.dst.top, eps)
  }

  @Test
  fun fillCoversAndCropsTheCentre() {
    val l = PhotoMath.layout(2000, 1000, 200f, 200f, "fill")
    // Square crop from the middle of the photo.
    assertEquals(1000f, l.src.width, eps)
    assertEquals(1000f, l.src.height, eps)
    assertEquals(500f, l.src.left, eps)
    assertEquals(200f, l.dst.width, eps)
  }

  @Test
  fun cropFollowsTheFocusPointAndZoomButStaysInsideThePhoto() {
    val left = PhotoMath.layout(2000, 1000, 200f, 200f, "crop", focusX = 0f, focusY = 0.5f)
    assertEquals(0f, left.src.left, eps)
    val zoomed = PhotoMath.layout(2000, 1000, 200f, 200f, "crop", focusX = 0.75f, focusY = 0.25f, zoom = 2f)
    assertEquals(500f, zoomed.src.width, eps)
    assertEquals(1250f, zoomed.src.left, eps)
    // Top edge clamps at 0 (focus 0.25 of 1000 = 250 → centre can't be above 250).
    assertEquals(0f, zoomed.src.top, eps)
    // Zoom is limited to 4×.
    assertEquals(250f, PhotoMath.layout(2000, 1000, 200f, 200f, "crop", zoom = 9f).src.width, eps)
  }

  @Test
  fun aChosenShapeIsCentredInTheWidget() {
    // 2×1 shape in a 300×300 widget → 300×150 frame at y = 75.
    val l = PhotoMath.layout(1000, 1000, 300f, 300f, "fill", frameW = 2, frameH = 1)
    assertEquals(300f, l.frame.width, eps)
    assertEquals(150f, l.frame.height, eps)
    assertEquals(75f, l.frame.top, eps)
    assertEquals(l.frame, l.dst)
  }

  @Test
  fun sampleSizeNeverDecodesBelowWhatIsShown() {
    assertEquals(4, PhotoMath.sampleSize(2000f, 2000f, 400f, 400f))
    assertEquals(1, PhotoMath.sampleSize(500f, 500f, 400f, 400f))
  }

  @Test
  fun validatesStoredConfigs() {
    val c = PhotoConfig.from(
      JSONObject().put("id", "abc").put("image", "/data/x.jpg").put("mode", "stretch")
        .put("zoom", 10).put("frameW", 3).put("frameH", 0),
    )!!
    assertEquals("fill", c.mode)
    assertEquals(4f, c.zoom, eps)
    // A half-set shape means "match the widget".
    assertEquals(0, c.frameW)
    assertNull(PhotoConfig.from(JSONObject().put("id", "../x").put("image", "/a.jpg")))
  }
}
