package com.rnboilerplate.screenocr

import org.json.JSONObject
import kotlin.math.abs

/** How the pinned Next button is found again. */
enum class TargetAnchor(val id: String) {
  /** Same physical screen point every time (fixed toolbar / bottom bar). */
  SCREEN("screen"),

  /**
   * The button moves with content: re-located through its accessibility
   * identity (view id / description / text) before every click. Without an
   * identifiable node this mode cannot work and the target is rejected.
   */
  CONTENT("content");

  companion object {
    fun from(id: String?): TargetAnchor = entries.firstOrNull { it.id == id } ?: SCREEN
  }
}

/** Display geometry at a moment in time; a target is only valid on the same geometry. */
data class ScreenGeometry(
  val widthPx: Int,
  val heightPx: Int,
  val densityDpi: Int,
  /** Surface.ROTATION_0..270 */
  val rotation: Int,
  val insetTop: Int = 0,
  val insetBottom: Int = 0,
  val insetLeft: Int = 0,
  val insetRight: Int = 0,
)

/**
 * The accessibility identity of the node under the pin, when one could be
 * read. All fields optional; see [NodeMatcher] for how they are compared.
 */
data class NodeIdentity(
  val viewId: String = "",
  val contentDescription: String = "",
  val text: String = "",
  val className: String = "",
  val widthPx: Int = 0,
  val heightPx: Int = 0,
) {
  /** Enough to find the node again anywhere on screen. */
  val isIdentifiable: Boolean
    get() = viewId.isNotBlank() || contentDescription.isNotBlank() || text.isNotBlank()
}

/**
 * A user-pinned pagination control.
 *
 * Coordinates are **physical screen pixels in the display's current
 * rotation**, origin at the top-left of the full display (including system
 * bars) — the coordinate system `AccessibilityService.dispatchGesture` and
 * `AccessibilityNodeInfo.getBoundsInScreen` use. The geometry at calibration
 * is stored alongside, and the target is refused (recalibration requested)
 * whenever the current geometry differs, rather than guessing a transform.
 */
data class PaginationTarget(
  val x: Int,
  val y: Int,
  val anchor: TargetAnchor,
  val geometry: ScreenGeometry,
  val node: NodeIdentity? = null,
  /** Foreground app when pinned (from the accessibility service), or "". */
  val packageName: String = "",
  val calibratedAt: Long = 0,
) {
  fun toJson(): JSONObject {
    val json =
      JSONObject()
        .put("x", x)
        .put("y", y)
        .put("anchor", anchor.id)
        .put("coordinateSpace", "physical_screen_px")
        .put("packageName", packageName)
        .put("calibratedAt", calibratedAt)
        .put(
          "geometry",
          JSONObject()
            .put("widthPx", geometry.widthPx)
            .put("heightPx", geometry.heightPx)
            .put("densityDpi", geometry.densityDpi)
            .put("rotation", geometry.rotation)
            .put("insetTop", geometry.insetTop)
            .put("insetBottom", geometry.insetBottom)
            .put("insetLeft", geometry.insetLeft)
            .put("insetRight", geometry.insetRight),
        )
    node?.let {
      json.put(
        "node",
        JSONObject()
          .put("viewId", it.viewId)
          .put("contentDescription", it.contentDescription)
          .put("text", it.text)
          .put("className", it.className)
          .put("widthPx", it.widthPx)
          .put("heightPx", it.heightPx),
      )
    }
    return json
  }

  companion object {
    fun fromJson(json: JSONObject?): PaginationTarget? {
      json ?: return null
      val g = json.optJSONObject("geometry") ?: return null
      if (!json.has("x") || !json.has("y")) return null
      val n = json.optJSONObject("node")
      return PaginationTarget(
        x = json.optInt("x"),
        y = json.optInt("y"),
        anchor = TargetAnchor.from(json.optString("anchor")),
        geometry =
          ScreenGeometry(
            widthPx = g.optInt("widthPx"),
            heightPx = g.optInt("heightPx"),
            densityDpi = g.optInt("densityDpi"),
            rotation = g.optInt("rotation"),
            insetTop = g.optInt("insetTop"),
            insetBottom = g.optInt("insetBottom"),
            insetLeft = g.optInt("insetLeft"),
            insetRight = g.optInt("insetRight"),
          ),
        node =
          n?.let {
            NodeIdentity(
              viewId = it.optString("viewId"),
              contentDescription = it.optString("contentDescription"),
              text = it.optString("text"),
              className = it.optString("className"),
              widthPx = it.optInt("widthPx"),
              heightPx = it.optInt("heightPx"),
            )
          },
        packageName = json.optString("packageName"),
        calibratedAt = json.optLong("calibratedAt"),
      )
    }
  }
}

/** Why a saved target can't be used right now. */
enum class TargetProblem(val id: String) {
  NONE("none"),
  ROTATED("rotated"),
  RESIZED("resized"),
  DENSITY_CHANGED("density_changed"),
  OUT_OF_BOUNDS("out_of_bounds"),
  NOT_IDENTIFIABLE("not_identifiable"),
}

object TargetValidator {
  /** Insets may shift by a few px (e.g. gesture vs button navigation); beyond this the layout moved. */
  private const val INSET_TOLERANCE_PX = 4

  fun validate(target: PaginationTarget, now: ScreenGeometry): TargetProblem {
    val then = target.geometry
    if (then.rotation != now.rotation) return TargetProblem.ROTATED
    if (then.densityDpi != now.densityDpi) return TargetProblem.DENSITY_CHANGED
    if (then.widthPx != now.widthPx || then.heightPx != now.heightPx) return TargetProblem.RESIZED
    // A changed system-bar height (navigation mode switched, taskbar shown)
    // moves bottom toolbars, so a fixed point would be wrong.
    if (target.anchor == TargetAnchor.SCREEN &&
      (abs(then.insetTop - now.insetTop) > INSET_TOLERANCE_PX ||
        abs(then.insetBottom - now.insetBottom) > INSET_TOLERANCE_PX)
    ) {
      return TargetProblem.RESIZED
    }
    if (target.x !in 0 until now.widthPx || target.y !in 0 until now.heightPx) return TargetProblem.OUT_OF_BOUNDS
    if (target.anchor == TargetAnchor.CONTENT && target.node?.isIdentifiable != true) {
      return TargetProblem.NOT_IDENTIFIABLE
    }
    return TargetProblem.NONE
  }
}

/**
 * Scores how well an on-screen node matches the pinned [NodeIdentity].
 * Pure, so the matching rules are unit-tested; the accessibility service
 * feeds it candidates.
 */
object NodeMatcher {
  const val MIN_SCORE = 3

  fun score(candidate: NodeIdentity, pinned: NodeIdentity): Int {
    var score = 0
    if (pinned.viewId.isNotBlank()) {
      if (candidate.viewId == pinned.viewId) score += 4 else return 0
    }
    if (pinned.contentDescription.isNotBlank()) {
      if (candidate.contentDescription.equals(pinned.contentDescription, ignoreCase = true)) score += 3
      else if (pinned.viewId.isBlank()) return 0
    }
    if (pinned.text.isNotBlank()) {
      if (candidate.text.equals(pinned.text, ignoreCase = true)) score += 2
      else if (pinned.viewId.isBlank() && pinned.contentDescription.isBlank()) return 0
    }
    if (pinned.className.isNotBlank() && candidate.className == pinned.className) score += 1
    // Similar size (±30%) is a weak extra signal.
    if (pinned.widthPx > 0 && pinned.heightPx > 0 &&
      abs(candidate.widthPx - pinned.widthPx) <= pinned.widthPx * 0.3 &&
      abs(candidate.heightPx - pinned.heightPx) <= pinned.heightPx * 0.3
    ) {
      score += 1
    }
    return score
  }
}
