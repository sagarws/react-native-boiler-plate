package com.rnboilerplate.alarms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import org.json.JSONObject

/** An armed alarm went off (only reachable through this app's own PendingIntents). */
class AlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != AlarmScheduler.ACTION_FIRE) return
    val key = intent.getStringExtra(AlarmScheduler.EXTRA_KEY) ?: return
    val entry = AlarmScheduler.onFire(context, key) ?: return
    AlarmAlert.deliver(context, entry)
    AlarmScheduler.onFired?.let { cb -> Handler(Looper.getMainLooper()).post { cb(key) } }
  }
}

/** Snooze / Dismiss from the notification or the alarm screen. */
class AlarmActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val entry = AlarmEntry.from(runCatching { JSONObject(intent.getStringExtra(AlarmAlert.EXTRA_ENTRY) ?: "") }.getOrNull())
      ?: return
    when (intent.action) {
      AlarmAlert.ACTION_SNOOZE -> {
        AlarmRingService.stop(context, entry.key)
        AlarmScheduler.snooze(context, entry)
      }
      AlarmAlert.ACTION_DISMISS -> AlarmRingService.stop(context, entry.key)
    }
    AlarmActivity.close(entry.key)
  }
}

/** Alarms don't survive a reboot or an app update; the clock or zone may change. */
class AlarmRestoreReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      -> AlarmScheduler.rearmAll(context)
    }
  }
}
