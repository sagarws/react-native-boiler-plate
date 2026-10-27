package com.rnboilerplate.screenocr

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaginationTargetTest {
  private val phone = ScreenGeometry(1080, 2340, 450, 0, insetTop = 96, insetBottom = 63)
  private val target = PaginationTarget(980, 2180, TargetAnchor.SCREEN, phone, calibratedAt = 1)

  @Test
  fun validOnTheSameGeometry() {
    assertEquals(TargetProblem.NONE, TargetValidator.validate(target, phone))
  }

  @Test
  fun rotationResizeAndDensityInvalidateTheTarget() {
    assertEquals(TargetProblem.ROTATED, TargetValidator.validate(target, phone.copy(rotation = 1, widthPx = 2340, heightPx = 1080)))
    assertEquals(TargetProblem.RESIZED, TargetValidator.validate(target, phone.copy(heightPx = 2400)))
    assertEquals(TargetProblem.DENSITY_CHANGED, TargetValidator.validate(target, phone.copy(densityDpi = 480)))
  }

  @Test
  fun aChangedNavigationBarMovesAFixedBottomToolbar() {
    assertEquals(TargetProblem.RESIZED, TargetValidator.validate(target, phone.copy(insetBottom = 144)))
    // A couple of pixels is noise, not a layout change.
    assertEquals(TargetProblem.NONE, TargetValidator.validate(target, phone.copy(insetBottom = 65)))
  }

  @Test
  fun contentRelativeTargetsNeedAnIdentifiableNode() {
    val content = target.copy(anchor = TargetAnchor.CONTENT)
    assertEquals(TargetProblem.NOT_IDENTIFIABLE, TargetValidator.validate(content, phone))
    val identified = content.copy(node = NodeIdentity(contentDescription = "Next page"))
    assertEquals(TargetProblem.NONE, TargetValidator.validate(identified, phone))
  }

  @Test
  fun contentRelativeTargetsIgnoreInsetChanges() {
    val identified = target.copy(anchor = TargetAnchor.CONTENT, node = NodeIdentity(viewId = "app:id/next"))
    assertEquals(TargetProblem.NONE, TargetValidator.validate(identified, phone.copy(insetBottom = 144)))
  }

  @Test
  fun jsonRoundTripKeepsEveryField() {
    val full =
      target.copy(
        anchor = TargetAnchor.CONTENT,
        node = NodeIdentity("app:id/next", "Next page", "", "android.widget.ImageButton", 120, 120),
        packageName = "com.example.reader",
      )
    val restored = PaginationTarget.fromJson(JSONObject(full.toJson().toString()))
    assertEquals(full, restored)
    assertEquals("physical_screen_px", full.toJson().getString("coordinateSpace"))
  }

  @Test
  fun malformedJsonGivesNoTarget() {
    assertNull(PaginationTarget.fromJson(JSONObject("{\"x\":1}")))
    assertNull(PaginationTarget.fromJson(null))
  }

  @Test
  fun nodeMatchingPrefersViewIdAndRejectsOtherButtons() {
    val pinned = NodeIdentity(viewId = "app:id/next", className = "android.widget.ImageButton", widthPx = 120, heightPx = 120)
    val same = pinned.copy(widthPx = 126)
    val previous = pinned.copy(viewId = "app:id/prev")
    assertTrue(NodeMatcher.score(same, pinned) >= NodeMatcher.MIN_SCORE)
    assertEquals(0, NodeMatcher.score(previous, pinned))
  }

  @Test
  fun nodeMatchingByDescriptionIsCaseInsensitive() {
    val pinned = NodeIdentity(contentDescription = "Next page")
    assertTrue(NodeMatcher.score(NodeIdentity(contentDescription = "next PAGE"), pinned) >= NodeMatcher.MIN_SCORE)
    assertEquals(0, NodeMatcher.score(NodeIdentity(contentDescription = "Previous page"), pinned))
  }
}
