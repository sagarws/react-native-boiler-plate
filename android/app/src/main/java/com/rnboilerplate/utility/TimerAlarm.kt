package com.rnboilerplate.utility

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rnboilerplate.R

/**
 * The countdown timer's "time's up" alert: one alarm (the app has a single
 * timer), so it fires even when the app is closed. Exact when Android lets
 * the app schedule exact alarms; otherwise inexact, which Doze may delay —
 * the timer screen says so and links to the setting. Texts come from JS,
 * already translated.
 */
object TimerAlarm {
  private const val PREFS = "utility_timer"
  private const val ACTION_FIRE = "com.rnboilerplate.utility.TIMER"
  private const val CHANNEL = "utility_timer"
  private const val NOTIFICATION_ID = 0x7155
  private const val REQUEST = 0x7156

  private fun pending(context: Context, flags: Int): PendingIntent? =
    PendingIntent.getBroadcast(
      context,
      REQUEST,
      Intent(context, TimerAlarmReceiver::class.java).setAction(ACTION_FIRE),
      flags or PendingIntent.FLAG_IMMUTABLE,
    )

  fun canScheduleExact(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 31) return true
    val alarms = context.getSystemService(AlarmManager::class.java) ?: return false
    return alarms.canScheduleExactAlarms()
  }

  /** Arms (or re-arms) the alarm for [at]. Returns 'exact' or 'inexact'. */
  fun schedule(context: Context, at: Long, title: String, body: String): String {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .putString("title", title.take(120))
      .putString("body", body.take(300))
      .apply()
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(context, PendingIntent.FLAG_UPDATE_CURRENT) ?: return "inexact"
    alarms.cancel(pi)
    return if (canScheduleExact(context)) {
      try {
        alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        "exact"
      } catch (_: SecurityException) {
        alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        "inexact"
      }
    } else {
      alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
      "inexact"
    }
  }

  /** Cancels a pending alarm and clears a shown "time's up" notification. */
  fun cancel(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    pending(context, PendingIntent.FLAG_NO_CREATE)?.let {
      alarms.cancel(it)
      it.cancel()
    }
    NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
  }

  /** The system screen where the user allows exact alarms (Android 12+). */
  fun exactAlarmSettings(context: Context): Intent? {
    if (Build.VERSION.SDK_INT < 31) return null
    return Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM)
      .setData(android.net.Uri.parse("package:${context.packageName}"))
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
  }

  private fun notificationsAllowed(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
  }

  fun fire(context: Context) {
    if (!notificationsAllowed(context)) return
    ensureChannel(context)
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    val tap = open?.let {
      PendingIntent.getActivity(context, REQUEST, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
    val notification = NotificationCompat.Builder(context, CHANNEL)
      .setSmallIcon(R.drawable.ic_bell)
      .setContentTitle(prefs.getString("title", null) ?: context.getString(R.string.utility_timer_channel_name))
      .setContentText(prefs.getString("body", null) ?: "")
      .setCategory(NotificationCompat.CATEGORY_ALARM)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
      .setVibrate(longArrayOf(0, 600, 400, 600, 400, 600))
      .setAutoCancel(true)
      .apply { tap?.let { setContentIntent(it) } }
      .build()
    try {
      NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
    } catch (_: SecurityException) {
      // Permission revoked between the check and the post: nothing to show.
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < 26) return
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    if (manager.getNotificationChannel(CHANNEL) != null) return
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL,
        context.getString(R.string.utility_timer_channel_name),
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = context.getString(R.string.utility_timer_channel_description)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 600, 400, 600, 400, 600)
        setSound(
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
          AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).build(),
        )
      },
    )
  }
}

/** Fires the timer alert (only reachable through this app's own PendingIntent). */
class TimerAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action == "com.rnboilerplate.utility.TIMER") TimerAlarm.fire(context)
  }
}
