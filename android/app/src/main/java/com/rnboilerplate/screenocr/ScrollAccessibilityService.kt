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
 * Optional accessibility service used **only** to scroll the app being read
 * aloud in "Speak with auto-scroll" mode. An overlay cannot scroll another
 * app; Android allows it only through an accessibility service the user
 * turns on explicitly in system settings (never enabled by this app).
 *
 * It does not read, store or send screen content: it looks for the largest
 * visible scrollable container in the active window and asks it to scroll
 * forward, falling back to a swipe gesture (for apps that expose no
 * scrollable node). It receives no events it acts on.
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
