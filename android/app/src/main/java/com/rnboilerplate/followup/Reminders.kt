package com.rnboilerplate.followup

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rnboilerplate.R
import org.json.JSONArray
import org.json.JSONObject

/** One scheduled Follow Up notification (texts already translated by JS). */
data class Reminder(
  val key: String,
  val at: Long,
  val title: String,
  val body: String,
  val contactId: String,
) {
  fun toJson(): JSONObject =
    JSONObject().put("key", key).put("at", at).put("title", title).put("body", body).put("contactId", contactId)

  companion object {
    private val KEY_RE = Regex("^[a-z]+:[A-Za-z0-9-]{1,60}$")

    /** Parses one entry; null when malformed. */
    fun from(o: JSONObject?): Reminder? {
      o ?: return null
      val key = o.optString("key")
      val at = o.optLong("at", -1)
      val title = o.optString("title").take(200)
      if (!KEY_RE.matches(key) || at <= 0 || title.isBlank()) return null
      return Reminder(key, at, title, o.optString("body").take(500), o.optString("contactId").take(60))
    }

    fun parseAll(json: String): List<Reminder> {
      val arr = try {
        JSONArray(json)
      } catch (_: Exception) {
        return emptyList()
      }
      return (0 until arr.length()).mapNotNull { from(arr.optJSONObject(it)) }.distinctBy { it.key }
    }
  }
}

/**
 * Keeps Android's alarms equal to the set JS asks for. The set is stored so
 * it survives a reboot (re-armed by [ReminderBootReceiver]); each sync
 * cancels everything previously armed first, so there are never stale or
 * duplicate reminders.
 */
object ReminderScheduler {
  private const val PREFS = "followup_reminders"
  private const val KEY_SET = "set"
  /** Android limits an app to 500 alarms. */
  private const val MAX = 200
  const val CHANNEL = "followup_reminders"
  const val ACTION_FIRE = "com.rnboilerplate.followup.REMINDER"
  const val EXTRA_KEY = "key"

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun stored(context: Context): List<Reminder> =
    Reminder.parseAll(prefs(context).getString(KEY_SET, "[]") ?: "[]")

  private fun store(context: Context, list: List<Reminder>) {
    val arr = JSONArray()
    list.forEach { arr.put(it.toJson()) }
    prefs(context).edit().putString(KEY_SET, arr.toString()).commit()
  }

  fun notificationsAllowed(context: Context): Boolean {
    if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false
    return Build.VERSION.SDK_INT < 33 ||
      ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
      PackageManager.PERMISSION_GRANTED
  }

  private fun pending(context: Context, key: String, flags: Int): PendingIntent? {
    val intent =
      Intent(context, ReminderReceiver::class.java)
        .setAction(ACTION_FIRE)
        // A distinct data URI per reminder keeps their PendingIntents apart.
        .setData(Uri.parse("akshar-followup://reminder/$key"))
        .putExtra(EXTRA_KEY, key)
    return PendingIntent.getBroadcast(context, key.hashCode(), intent, flags or PendingIntent.FLAG_IMMUTABLE)
  }

  /** Replaces all reminders with [next]. Returns how many were armed. */
  @Synchronized
  fun sync(context: Context, next: List<Reminder>): Int {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    for (old in stored(context)) {
      pending(context, old.key, PendingIntent.FLAG_NO_CREATE)?.let {
        alarms.cancel(it)
        it.cancel()
      }
    }
    val now = System.currentTimeMillis()
    val armed = next.filter { it.at > now }.sortedBy { it.at }.take(MAX)
    for (r in armed) arm(context, alarms, r)
    store(context, armed)
    return armed.size
  }

  /** After a reboot or app update: arms the stored reminders that are still ahead. */
  @Synchronized
  fun rearm(context: Context) {
    val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val now = System.currentTimeMillis()
    val ahead = stored(context).filter { it.at > now }
    ahead.forEach { arm(context, alarms, it) }
    store(context, ahead)
  }

  private fun arm(context: Context, alarms: AlarmManager, r: Reminder) {
    val pi = pending(context, r.key, PendingIntent.FLAG_UPDATE_CURRENT) ?: return
    // Inexact while idle: no exact-alarm permission is needed, but in Doze it
    // may arrive a few minutes late (said in the settings footer).
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, r.at, pi)
  }

  /** Posts the notification for [key] and forgets it. */
  @Synchronized
  fun fire(context: Context, key: String) {
    val list = stored(context)
    val r = list.firstOrNull { it.key == key } ?: return
    store(context, list.filter { it.key != key })
    if (!notificationsAllowed(context)) return
    ensureChannel(context)
    val open =
      Intent(Intent.ACTION_VIEW, Uri.parse("rnboilerplate://followup/contact/${Uri.encode(r.contactId)}"))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    val tap =
      PendingIntent.getActivity(
        context,
        key.hashCode(),
        open,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
    // The lock screen shows only a generic line, never the contact's name.
    val public =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_bell)
        .setContentTitle(context.getString(R.string.followup_reminder_public))
        .build()
    val notification =
      NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.ic_bell)
        .setContentTitle(r.title)
        .setContentText(r.body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(r.body))
        .setCategory(NotificationCompat.CATEGORY_REMINDER)
        .setPriority(NotificationCompat.PRIORITY_DEFAULT)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(public)
        .setContentIntent(tap)
        .setAutoCancel(true)
        .build()
    try {
      NotificationManagerCompat.from(context).notify(key.hashCode(), notification)
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
        context.getString(R.string.followup_channel_name),
        NotificationManager.IMPORTANCE_DEFAULT,
      ).apply { description = context.getString(R.string.followup_channel_description) },
    )
  }
}

/** Fires one reminder (only reachable through this app's own PendingIntents). */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ReminderScheduler.ACTION_FIRE) return
    val key = intent.getStringExtra(ReminderScheduler.EXTRA_KEY) ?: return
    ReminderScheduler.fire(context, key)
  }
}

/** Alarms don't survive a reboot or an app update, so this re-arms them. */
class ReminderBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> ReminderScheduler.rearm(context)
    }
  }
}
