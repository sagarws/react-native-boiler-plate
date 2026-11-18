package com.rnboilerplate.alarms

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.TypedValue
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import com.rnboilerplate.R
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.text.DateFormat
import java.util.Date

/**
 * The lock-screen alarm screen for high-priority alarms: title, time,
 * Snooze and Dismiss. Shown through a full-screen notification intent, which
 * Android 14+ only allows when the user hasn't revoked it for this app.
 */
class AlarmActivity : Activity() {
  private var entry: AlarmEntry? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    entry = AlarmEntry.from(runCatching { JSONObject(intent.getStringExtra(EXTRA_ENTRY) ?: "") }.getOrNull())
    val e = entry ?: return finish()
    if (Build.VERSION.SDK_INT >= 27) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      (getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    current = WeakReference(this)
    setContentView(build(e))
  }

  override fun onDestroy() {
    if (current?.get() === this) current = null
    super.onDestroy()
  }

  private fun dp(v: Float) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt()

  private fun button(text: String, primary: Boolean, onClick: () -> Unit) =
    TextView(this).apply {
      this.text = text
      setTextColor(Color.WHITE)
      textSize = 18f
      gravity = Gravity.CENTER
      minHeight = dp(56f)
      setPadding(dp(24f), dp(14f), dp(24f), dp(14f))
      background = GradientDrawable().apply {
        cornerRadius = dp(28f).toFloat()
        setColor(if (primary) 0xFF7C3AED.toInt() else 0x33FFFFFF)
      }
      isClickable = true
      isFocusable = true
      setOnClickListener { onClick() }
    }

  private fun build(e: AlarmEntry) =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(0xFF11101A.toInt())
      setPadding(dp(32f), dp(48f), dp(32f), dp(48f))
      addView(TextView(context).apply {
        text = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date())
        setTextColor(Color.WHITE)
        textSize = 56f
        gravity = Gravity.CENTER
      })
      addView(TextView(context).apply {
        text = e.title
        setTextColor(Color.WHITE)
        textSize = 24f
        gravity = Gravity.CENTER
        setPadding(0, dp(16f), 0, dp(8f))
      })
      addView(TextView(context).apply {
        text = e.body
        setTextColor(0xFFA9A3B8.toInt())
        textSize = 16f
        gravity = Gravity.CENTER
      })
      val gap = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        .apply { topMargin = dp(16f) }
      if (e.alert.snoozeMinutes > 0) {
        addView(button(getString(R.string.alarms_snooze, e.alert.snoozeMinutes), false) {
          AlarmRingService.stop(this@AlarmActivity, e.key)
          AlarmScheduler.snooze(this@AlarmActivity, e)
          finish()
        }, LinearLayout.LayoutParams(gap).apply { topMargin = dp(48f) })
      }
      addView(button(getString(R.string.alarms_dismiss), true) {
        AlarmRingService.stop(this@AlarmActivity, e.key)
        finish()
      }, gap)
    }

  companion object {
    const val EXTRA_ENTRY = "entry"
    private var current: WeakReference<AlarmActivity>? = null

    fun canFullScreen(context: Context): Boolean {
      if (Build.VERSION.SDK_INT < 34) return true
      return context.getSystemService(NotificationManager::class.java)?.canUseFullScreenIntent() == true
    }

    fun pending(context: Context, e: AlarmEntry): PendingIntent =
      PendingIntent.getActivity(
        context,
        AlarmAlert.notificationId(e.key),
        intent(context, e),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )

    private fun intent(context: Context, e: AlarmEntry) =
      Intent(context, AlarmActivity::class.java)
        .putExtra(EXTRA_ENTRY, e.toJson().toString())
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION)

    /** Brings the screen up directly when the app may (it's in front, or full-screen is allowed). */
    fun show(context: Context, e: AlarmEntry) {
      if (!canFullScreen(context)) return
      try {
        context.startActivity(intent(context, e))
      } catch (_: Exception) {
        // Background activity start not allowed: the full-screen notification covers it.
      }
    }

    fun close(key: String) {
      val a = current?.get() ?: return
      if (a.entry?.key == key) a.runOnUiThread { a.finish() }
    }
  }
}
