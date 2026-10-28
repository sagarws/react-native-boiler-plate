package com.rnboilerplate.lifewidget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import com.rnboilerplate.R

/**
 * Manage Life home-screen widget: today's targets with progress, and a "+"
 * button per task that queues a quick log (imported when the app opens).
 * Tapping a task or the title opens Manage Life → Today.
 */
class LifeWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, manager, ids)
  }

  override fun onEnabled(context: Context) = scheduleMidnight(context)

  override fun onDisabled(context: Context) {
    alarmManager(context).cancel(refreshIntent(context))
  }

  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ACTION_LOG -> handleLog(context, intent)
      ACTION_REFRESH, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED -> refresh(context)
      else -> super.onReceive(context, intent)
    }
  }

  private fun handleLog(context: Context, intent: Intent) {
    val store = LifeWidgetStore(context)
    // Only the widget's own buttons carry the token.
    if (intent.getStringExtra(EXTRA_TOKEN) != store.token()) return
    val taskId = intent.getStringExtra(EXTRA_TASK) ?: return
    val quantity = intent.getDoubleExtra(EXTRA_QTY, 0.0)
    val today = LifeWidgetModel.dayKey()
    if (!LifeWidgetModel.canLog(store.snapshot(), taskId, today, quantity)) return
    store.appendLog(taskId, today, quantity, System.currentTimeMillis())
    refresh(context)
  }

  companion object {
    const val ACTION_LOG = "com.rnboilerplate.lifewidget.LOG"
    const val ACTION_REFRESH = "com.rnboilerplate.lifewidget.REFRESH"
    private const val EXTRA_TASK = "task"
    private const val EXTRA_QTY = "qty"
    private const val EXTRA_TOKEN = "token"
    private const val OPEN_URI = "rnboilerplate://life/today"

    private val ROWS = intArrayOf(R.id.life_row_0, R.id.life_row_1, R.id.life_row_2, R.id.life_row_3)
    private val COLORS = intArrayOf(R.id.life_color_0, R.id.life_color_1, R.id.life_color_2, R.id.life_color_3)
    private val NAMES = intArrayOf(R.id.life_name_0, R.id.life_name_1, R.id.life_name_2, R.id.life_name_3)
    private val LINES = intArrayOf(R.id.life_line_0, R.id.life_line_1, R.id.life_line_2, R.id.life_line_3)
    private val BARS = intArrayOf(R.id.life_bar_0, R.id.life_bar_1, R.id.life_bar_2, R.id.life_bar_3)
    private val PLUS = intArrayOf(R.id.life_plus_0, R.id.life_plus_1, R.id.life_plus_2, R.id.life_plus_3)

    /** Redraws every placed widget (after a snapshot push or a quick log). */
    fun refresh(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      val ids = manager.getAppWidgetIds(ComponentName(context, LifeWidgetProvider::class.java))
      if (ids.isNotEmpty()) render(context, manager, ids)
    }

    private fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      val store = LifeWidgetStore(context)
      val model = LifeWidgetModel.build(store.snapshot(), store.logs(), LifeWidgetModel.dayKey())
      val token = store.token()
      val open = PendingIntent.getActivity(
        context,
        0,
        Intent(Intent.ACTION_VIEW, Uri.parse(OPEN_URI)).setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
      val views = RemoteViews(context.packageName, R.layout.life_widget)
      views.setTextViewText(R.id.life_title, model.title)
      views.setOnClickPendingIntent(R.id.life_header, open)
      for (i in ROWS.indices) {
        val row = model.rows.getOrNull(i)
        if (row == null) {
          views.setViewVisibility(ROWS[i], View.GONE)
          continue
        }
        views.setViewVisibility(ROWS[i], View.VISIBLE)
        views.setInt(COLORS[i], "setBackgroundColor", parseColor(row.color))
        views.setTextViewText(NAMES[i], row.name)
        views.setTextViewText(LINES[i], row.line)
        views.setProgressBar(BARS[i], 100, row.percent, false)
        views.setOnClickPendingIntent(ROWS[i], open)
        if (row.step > 0) {
          views.setViewVisibility(PLUS[i], View.VISIBLE)
          views.setTextViewText(PLUS[i], row.stepLabel)
          views.setContentDescription(PLUS[i], "${row.stepLabel} ${row.name}")
          val log = Intent(context, LifeWidgetProvider::class.java)
            .setAction(ACTION_LOG)
            .putExtra(EXTRA_TASK, row.taskId)
            .putExtra(EXTRA_QTY, row.step)
            .putExtra(EXTRA_TOKEN, token)
          views.setOnClickPendingIntent(
            PLUS[i],
            PendingIntent.getBroadcast(
              context,
              (row.taskId.hashCode() * 31) + i,
              log,
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            ),
          )
        } else {
          views.setViewVisibility(PLUS[i], View.GONE)
        }
      }
      views.setTextViewText(R.id.life_footer, model.footer)
      views.setViewVisibility(R.id.life_footer, if (model.footer.isEmpty()) View.GONE else View.VISIBLE)
      views.setOnClickPendingIntent(R.id.life_footer, open)
      manager.updateAppWidget(ids, views)
      scheduleMidnight(context)
    }

    private fun parseColor(hex: String): Int = runCatching { Color.parseColor(hex) }.getOrDefault(Color.GRAY)

    private fun alarmManager(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    private fun refreshIntent(context: Context): PendingIntent =
      PendingIntent.getBroadcast(
        context,
        1,
        Intent(context, LifeWidgetProvider::class.java).setAction(ACTION_REFRESH),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )

    /** Inexact wake-up just after local midnight so a new day's period shows. */
    private fun scheduleMidnight(context: Context) {
      alarmManager(context).set(AlarmManager.RTC, LifeWidgetModel.nextMidnightMillis(), refreshIntent(context))
    }
  }
}
