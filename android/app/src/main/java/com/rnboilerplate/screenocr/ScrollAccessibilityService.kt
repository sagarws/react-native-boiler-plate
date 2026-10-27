package com.rnboilerplate.screenocr

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.graphics.Rect
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.lang.ref.WeakReference

/**
 * Optional accessibility service used **only** for the two read-aloud modes
 * that move the page: scrolling ("Speak with auto-scroll") and pressing the
 * user-pinned Next button ("Speak with pagination"). An overlay cannot
 * scroll or tap inside another app; Android allows it only through an
 * accessibility service the user turns on explicitly in system settings
 * (never enabled by this app).
 *
 * It does not read, store or send screen content. It inspects the active
 * window only to find the scrollable container or the pinned button (by its
 * view id / description / text), and receives no events it acts on.
 */
class ScrollAccessibilityService : AccessibilityService() {
  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = WeakReference(this)
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    if (instance?.get() === this) instance = null
    super.onDestroy()
  }

  /** Package of the app in the foreground, or "" if unknown. */
  fun activePackage(): String = rootInActiveWindow?.packageName?.toString().orEmpty()

  private fun identity(node: AccessibilityNodeInfo): NodeIdentity {
    val bounds = Rect().also { node.getBoundsInScreen(it) }
    return NodeIdentity(
      viewId = node.viewIdResourceName.orEmpty(),
      contentDescription = node.contentDescription?.toString().orEmpty(),
      text = node.text?.toString().orEmpty().take(MAX_TEXT),
      className = node.className?.toString().orEmpty(),
      widthPx = bounds.width(),
      heightPx = bounds.height(),
    )
  }

  /** Breadth-first walk of the active window, bounded. */
  private fun nodes(): Sequence<AccessibilityNodeInfo> = sequence {
    val root = rootInActiveWindow ?: return@sequence
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue += root
    var visited = 0
    while (queue.isNotEmpty() && visited < MAX_NODES) {
      val node = queue.removeFirst()
      visited++
      yield(node)
      for (i in 0 until node.childCount) node.getChild(i)?.let { queue += it }
    }
  }

  /** The smallest visible clickable node containing the point (the button under the pin). */
  private fun clickableAt(x: Int, y: Int): AccessibilityNodeInfo? {
    val bounds = Rect()
    return nodes()
      .filter { it.isVisibleToUser && (it.isClickable || it.isFocusable) }
      .filter { node -> node.getBoundsInScreen(bounds).let { bounds.contains(x, y) } }
      .minByOrNull { node -> node.getBoundsInScreen(bounds).let { bounds.width().toLong() * bounds.height() } }
  }

  /** Identity of the control under a pinned point, for calibration; null when none is readable. */
  fun identifyAt(x: Int, y: Int): NodeIdentity? =
    clickableAt(x, y)?.let(::identity)?.takeIf { it.isIdentifiable || it.widthPx > 0 }

  /**
   * Presses the pinned Next button, in order of preference:
   * 1. the matching node's own click action (exact, works when the app
   *    exposes the button to accessibility);
   * 2. a short tap gesture at the pinned point (fixed targets) or at the
   *    re-located node's centre (content-relative targets).
   * A content-relative target whose node cannot be found is not tapped at
   * the old point — that is how the wrong control gets pressed.
   */
  fun clickTarget(target: PaginationTarget, onResult: (ClickOutcome) -> Unit) {
    if (target.packageName.isNotEmpty()) {
      val active = activePackage()
      if (active.isNotEmpty() && active != target.packageName) {
        onResult(ClickOutcome.APP_CHANGED)
        return
      }
    }
    val pinned = target.node
    val node: AccessibilityNodeInfo? =
      when {
        pinned == null -> null
        target.anchor == TargetAnchor.CONTENT ->
          nodes()
            .filter { it.isVisibleToUser }
            .map { it to NodeMatcher.score(identity(it), pinned) }
            .filter { it.second >= NodeMatcher.MIN_SCORE }
            .maxByOrNull { it.second }
            ?.first
        else ->
          clickableAt(target.x, target.y)?.takeIf {
            !pinned.isIdentifiable || NodeMatcher.score(identity(it), pinned) >= NodeMatcher.MIN_SCORE
          }
      }
    if (target.anchor == TargetAnchor.CONTENT && node == null) {
      onResult(ClickOutcome.TARGET_NOT_FOUND)
      return
    }
    if (node != null) {
      val clickable = generateSequence(node) { it.parent }.take(4).firstOrNull { it.isClickable }
      if (clickable != null && clickable.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
        onResult(ClickOutcome.NODE)
        return
      }
    }
    val point =
      node?.let { Rect().also { r -> it.getBoundsInScreen(r) }.let { r -> r.centerX() to r.centerY() } }
        ?: (target.x to target.y)
    tap(point.first.toFloat(), point.second.toFloat(), onResult)
  }

  private fun tap(x: Float, y: Float, onResult: (ClickOutcome) -> Unit) {
    val gesture =
      GestureDescription.Builder()
        .addStroke(GestureDescription.StrokeDescription(Path().apply { moveTo(x, y) }, 0, TAP_MS))
        .build()
    val dispatched =
      dispatchGesture(
        gesture,
        object : GestureResultCallback() {
          override fun onCompleted(gestureDescription: GestureDescription?) = onResult(ClickOutcome.GESTURE)

          override fun onCancelled(gestureDescription: GestureDescription?) = onResult(ClickOutcome.FAILED)
        },
        null,
      )
    if (!dispatched) onResult(ClickOutcome.FAILED)
  }

  /** Scrolls the foreground app forward; [onResult] reports whether anything was asked to move. */
  fun scrollForward(onResult: (Boolean) -> Unit) {
    val target = largestScrollable(rootInActiveWindow)
    if (target != null && target.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD)) {
      onResult(true)
      return
    }
    swipeUp(onResult)
  }

  private fun largestScrollable(root: AccessibilityNodeInfo?): AccessibilityNodeInfo? {
    root ?: return null
    var best: AccessibilityNodeInfo? = null
    var bestArea = 0L
    val bounds = Rect()
    val queue = ArrayDeque<AccessibilityNodeInfo>()
    queue += root
    var visited = 0
    while (queue.isNotEmpty() && visited < MAX_NODES) {
      val node = queue.removeFirst()
      visited++
      if (node.isScrollable && node.isVisibleToUser) {
        node.getBoundsInScreen(bounds)
        val area = bounds.width().toLong() * bounds.height().toLong()
        if (area > bestArea) {
          best = node
          bestArea = area
        }
      }
      for (i in 0 until node.childCount) node.getChild(i)?.let { queue += it }
    }
    return best
  }

  /** A slow vertical swipe over the middle of the screen (~45% of its height). */
  private fun swipeUp(onResult: (Boolean) -> Unit) {
    val metrics = resources.displayMetrics
    val x = metrics.widthPixels / 2f
    val path =
      Path().apply {
        moveTo(x, metrics.heightPixels * 0.72f)
        lineTo(x, metrics.heightPixels * 0.27f)
      }
    val gesture =
      GestureDescription.Builder()
        .addStroke(GestureDescription.StrokeDescription(path, 0, SWIPE_MS))
        .build()
    val dispatched =
      dispatchGesture(
        gesture,
        object : GestureResultCallback() {
          override fun onCompleted(gestureDescription: GestureDescription?) = onResult(true)

          override fun onCancelled(gestureDescription: GestureDescription?) = onResult(false)
        },
        null,
      )
    if (!dispatched) onResult(false)
  }

  companion object {
    private const val MAX_NODES = 400
    private const val SWIPE_MS = 450L
    private const val TAP_MS = 60L
    private const val MAX_TEXT = 80

    @Volatile private var instance: WeakReference<ScrollAccessibilityService>? = null

    /** The running service, if the user has enabled it. */
    fun running(): ScrollAccessibilityService? = instance?.get()

    /** Enabled in system settings (the service may still be binding). */
    fun isEnabled(context: Context): Boolean {
      val enabled =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES)
          ?: return false
      val me = ComponentName(context, ScrollAccessibilityService::class.java)
      return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }
}
