package com.rnboilerplate.photowidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.RemoteViews
import com.rnboilerplate.R
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * The photo home-screen widget. Each placed widget shows one photo widget
 * setting; it's re-rendered at its real size whenever the launcher resizes
 * it (drag the corner handles) and whenever its settings change in the app.
 * Tapping a widget opens its settings; one without a photo opens the picker.
 */
class PhotoWidgetProvider : AppWidgetProvider() {

  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    renderAsync(context, ids)
  }

  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
    renderAsync(context, intArrayOf(id))
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    PhotoWidgetStore(context).unbind(ids)
  }

  private fun renderAsync(context: Context, ids: IntArray) {
    val app = context.applicationContext
    val pending = goAsync()
    worker.execute {
      try {
        ids.forEach { render(app, it) }
      } finally {
        pending.finish()
      }
    }
  }

  companion object {
    private val worker = Executors.newSingleThreadExecutor()

    fun allIds(context: Context): IntArray =
      AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, PhotoWidgetProvider::class.java))

    /** Re-renders every placed widget showing [configId] (all when null), off the main thread. */
    fun refresh(context: Context, configId: String? = null) {
      val app = context.applicationContext
      worker.execute {
        val store = PhotoWidgetStore(app)
        val bindings = store.bindings()
        allIds(app).filter { configId == null || bindings[it] == configId }.forEach { render(app, it) }
      }
    }

    /** The widget's current size in px (portrait: min width × max height, as launchers report). */
    private fun sizePx(context: Context, id: Int): Pair<Int, Int> {
      val o = AppWidgetManager.getInstance(context).getAppWidgetOptions(id)
      val portrait = context.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
      val wDp = o.getInt(if (portrait) AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH else AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, 0)
      val hDp = o.getInt(if (portrait) AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT else AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0)
      val d = context.resources.displayMetrics.density
      return ((if (wDp > 0) wDp else 110) * d).roundToInt() to ((if (hDp > 0) hDp else 110) * d).roundToInt()
    }

    fun render(context: Context, id: Int) {
      val manager = AppWidgetManager.getInstance(context)
      val store = PhotoWidgetStore(context)
      val config = store.bindings()[id]?.let { store.config(it) }
      val views = RemoteViews(context.packageName, R.layout.photo_widget)
      val (w, h) = sizePx(context, id)
      val bitmap = config?.let {
        try {
          PhotoImages.render(it, w, h, context.resources.displayMetrics.density)
        } catch (_: OutOfMemoryError) {
          null
        } catch (_: Exception) {
          null
        }
      }
      if (bitmap != null) {
        views.setImageViewBitmap(R.id.photo_widget_image, bitmap)
        views.setViewVisibility(R.id.photo_widget_image, View.VISIBLE)
        views.setViewVisibility(R.id.photo_widget_empty, View.GONE)
        views.setContentDescription(R.id.photo_widget_image, config.name.ifBlank { context.getString(R.string.photo_widget_label) })
        val open = Intent(Intent.ACTION_VIEW, Uri.parse("rnboilerplate://photo-widgets/${config.id}"))
          .setPackage(context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        views.setOnClickPendingIntent(
          R.id.photo_widget_root,
          PendingIntent.getActivity(context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      } else {
        views.setViewVisibility(R.id.photo_widget_image, View.GONE)
        views.setViewVisibility(R.id.photo_widget_empty, View.VISIBLE)
        val choose = Intent(context, PhotoWidgetConfigureActivity::class.java)
          .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
          .setData(Uri.parse("akshar-photo-widget://configure/$id"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        views.setOnClickPendingIntent(
          R.id.photo_widget_root,
          PendingIntent.getActivity(context, id, choose, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
        )
      }
      manager.updateAppWidget(id, views)
    }
  }
}
